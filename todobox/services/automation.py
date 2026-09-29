"""Automation: ToDoBox Rules applied when a ToDo is created, and ToDoBox Recurring Tasks."""

import frappe
from frappe import _
from frappe.query_builder.functions import Count, IfNull
from frappe.utils import add_days, add_months, cint, getdate, now_datetime, today

from todobox.services import rule_conditions
from todobox.services.common import (
	RECURRING_DOCTYPE,
	RULE_DOCTYPE,
	TEMPLATE_DOCTYPE,
	is_system_manager,
	join_tags,
	loads,
	split_csv,
)
from todobox.services.todos import create_todos, get_todo

RULES_CACHE_KEY = "todobox_rules_v2"

RULE_FIELDS = [
	"name", "rule_name", "enabled", "reference_doctype", "match", "conditions",
	"set_priority", "add_label", "hits", "last_applied",
]
RECURRING_FIELDS = [
	"name", "title", "enabled", "assign_by", "allocated_to", "role", "frequency", "next_run", "due_after_days",
	"task_template", "priority", "labels", "subject", "description", "runs", "last_run", "last_todo", "owner",
]
FREQUENCIES = ("Daily", "Weekly", "Monthly", "Quarterly", "Yearly")


def can_manage_rules(user=None):
	return is_system_manager(user)


def _ensure_rules_manager():
	if not can_manage_rules():
		frappe.throw(_("Only a System Manager can change automation rules"), frappe.PermissionError)


# ------------------------------------------------------------------ rules engine
def clear_rules_cache():
	frappe.cache.delete_value(RULES_CACHE_KEY)


def _active_rules():
	"""Enabled rules with their conditions already parsed, cached until a rule changes (controller hooks)."""
	rules = frappe.cache.get_value(RULES_CACHE_KEY)
	if rules is None:
		rules = frappe.get_all(RULE_DOCTYPE, filters={"enabled": 1}, fields=RULE_FIELDS, order_by="creation asc")
		for r in rules:
			r.conditions = rule_conditions.parse(r.conditions)
		frappe.cache.set_value(RULES_CACHE_KEY, rules)
	return rules


def _labels(doc):
	return split_csv(doc.get("labels"))


def apply_rules(doc, method=None):
	"""ToDo before_insert: apply every enabled rule whose conditions all match."""
	if doc.flags.get("ignore_todo_rules") or not frappe.db.table_exists(RULE_DOCTYPE):
		return
	rules = _active_rules()
	if not rules:
		return
	meta = frappe.get_meta("ToDo")
	fired, reference = [], rule_conditions.ReferenceLoader(doc)
	for rule in rules:
		try:
			if not rule_conditions.rule_matches(rule, doc, reference):
				continue
		except Exception:
			frappe.log_error(title=f"ToDoBox Rule {rule.name}: conditions failed")
			continue
		if rule.set_priority:
			doc.priority = rule.set_priority
		if rule.add_label and meta.has_field("labels"):
			doc.labels = join_tags(_labels(doc) + split_csv(rule.add_label))
		fired.append(rule)

	if not fired:
		return
	if meta.has_field("rule_applied"):
		doc.rule_applied = ", ".join(r.rule_name for r in fired)
	rule_table = frappe.qb.DocType(RULE_DOCTYPE)
	(
		frappe.qb.update(rule_table)
		.set(rule_table.hits, IfNull(rule_table.hits, 0) + 1)
		.set(rule_table.last_applied, now_datetime())
		.where(rule_table.name.isin([r.name for r in fired]))
	).run()


# ------------------------------------------------------------------ recurring tasks
def next_date(current, frequency):
	current = getdate(current)
	if frequency == "Daily":
		return add_days(current, 1)
	if frequency == "Weekly":
		return add_days(current, 7)
	if frequency == "Quarterly":
		return add_months(current, 3)
	if frequency == "Yearly":
		return add_months(current, 12)
	return add_months(current, 1)


def _recurring_recipients(rec):
	"""The users a run assigns to: the chosen user, or (no user set) every enabled System User with the role."""
	if rec.allocated_to:
		return [rec.allocated_to]
	if not rec.role:
		return []
	holders = frappe.get_all(
		"Has Role", filters={"role": rec.role, "parenttype": "User"}, pluck="parent", distinct=True
	)
	if not holders:
		return []
	return frappe.get_all(
		"User",
		filters={
			"name": ["in", list(set(holders) - {"Guest", "Administrator"}) or [""]],
			"enabled": 1,
			"user_type": "System User",
		},
		pluck="name",
		order_by="full_name asc, name asc",
	)


def _create_from_recurring(rec):
	"""Creates the ToDo(s) for one run as the task's owner — one per recipient (the user, or each
	enabled user with the role), due on the run date. Returns the ToDo names (empty: nobody to assign)."""
	recipients = _recurring_recipients(rec)
	if not recipients:
		return []
	tpl = frappe.get_doc(TEMPLATE_DOCTYPE, rec.task_template) if rec.task_template and frappe.db.exists(TEMPLATE_DOCTYPE, rec.task_template) else None
	subject = (rec.subject or "").strip() or (tpl.subject if tpl else "") or rec.title
	body = (rec.description or "").strip() or ((tpl.description or "") if tpl else "")
	checklist = [row.step for row in tpl.checklist] if tpl else []

	previous_user = frappe.session.user
	owner = rec.owner if rec.owner and frappe.db.exists("User", rec.owner) else previous_user
	try:
		if owner != previous_user:
			frappe.set_user(owner)
		res = create_todos(
			to=recipients,
			subject=subject,
			body=body,
			priority=rec.priority or (tpl.priority if tpl else "Medium") or "Medium",
			date=today(),
			labels=list(dict.fromkeys([_("Recurring"), *split_csv(rec.labels)])),
			checklist=checklist,
			template=tpl.name if tpl else None,
		)
	finally:
		if frappe.session.user != previous_user:
			frappe.set_user(previous_user)

	names = [n for n in ((res or {}).get("names") or []) if n]
	frappe.db.set_value(
		RECURRING_DOCTYPE, rec.name,
		{"runs": cint(rec.runs) + 1, "last_run": now_datetime(), "last_todo": names[0] if names else None},
		update_modified=False,
	)
	return names


def run_due_recurring():
	"""Scheduler (daily): creates the tasks whose next run is today or earlier, then moves the date forward."""
	if not frappe.db.table_exists(RECURRING_DOCTYPE):
		return
	for rec in frappe.get_all(
		RECURRING_DOCTYPE, filters={"enabled": 1, "next_run": ["<=", today()]}, fields=RECURRING_FIELDS
	):
		try:
			_create_from_recurring(rec)
			nxt = getdate(rec.next_run)
			while nxt <= getdate(today()):
				nxt = next_date(nxt, rec.frequency)
			frappe.db.set_value(RECURRING_DOCTYPE, rec.name, "next_run", nxt, update_modified=False)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"ToDoBox Recurring Task {rec.name} failed")


# ------------------------------------------------------------------ UI endpoints
def _rule_dict(r):
	return {
		"id": r.name, "label": r.rule_name, "active": bool(r.enabled),
		"reference_doctype": r.reference_doctype or "", "match": r.match or "All",
		"conditions": rule_conditions.parse(r.conditions),
		"field_labels": rule_conditions.field_labels(r.conditions),
		"set_priority": r.set_priority or "", "add_label": r.add_label or "", "add_labels": split_csv(r.add_label),
		"hits": cint(r.hits), "last_applied": str(r.last_applied) if r.last_applied else None,
	}


def _recurring_dict(r):
	return {
		"id": r.name, "label": r.title, "active": bool(r.enabled),
		"assign_by": "User" if r.allocated_to else "Role", "to": r.allocated_to or "", "role": r.role or "",
		"frequency": r.frequency, "next": str(r.next_run) if r.next_run else "",
		"template": r.task_template or "", "priority": r.priority or "Medium", "labels": split_csv(r.labels),
		"subject": r.subject or "", "description": r.description or "",
		"runs": cint(r.runs), "last_run": str(r.last_run) if r.last_run else None, "last_todo": r.last_todo,
		"owner": r.owner,
	}


def _recurring_filters():
	return {} if can_manage_rules() else {"owner": frappe.session.user}


def _get_recurring(name):
	doc = frappe.get_doc(RECURRING_DOCTYPE, name)
	if not can_manage_rules() and doc.owner != frappe.session.user:
		frappe.throw(_("You can only change your own recurring tasks"), frappe.PermissionError)
	return doc


AUTOMATIC_ROLES = ("Guest", "All", "Administrator", "Desk User")


def _role_options():
	"""Roles a recurring task can target: enabled roles held by at least one enabled System User."""
	has_role = frappe.qb.DocType("Has Role")
	user = frappe.qb.DocType("User")
	role = frappe.qb.DocType("Role")
	count = Count(has_role.parent).distinct()
	rows = (
		frappe.qb.from_(has_role)
		.join(user).on(user.name == has_role.parent)
		.join(role).on(role.name == has_role.role)
		.select(has_role.role, count.as_("users"))
		.where(
			(has_role.parenttype == "User")
			& (user.enabled == 1)
			& (user.user_type == "System User")
			& user.name.notin(["Guest", "Administrator"])
			& has_role.role.notin(AUTOMATIC_ROLES)
			& (IfNull(role.disabled, 0) == 0)
		)
		.groupby(has_role.role)
		.orderby(has_role.role)
	).run(as_dict=True)
	return [{"name": r.role, "users": cint(r.users)} for r in rows]


@frappe.whitelist()
def get_automation():
	return {
		"can_manage_rules": can_manage_rules(),
		"rules": [_rule_dict(r) for r in frappe.get_all(RULE_DOCTYPE, fields=RULE_FIELDS, order_by="creation asc")],
		"roles": _role_options(),
		"recurring": [
			_recurring_dict(r)
			for r in frappe.get_all(RECURRING_DOCTYPE, filters=_recurring_filters(), fields=RECURRING_FIELDS, order_by="next_run asc, creation asc")
		],
	}


@frappe.whitelist()
def save_rule(data):
	_ensure_rules_manager()
	data = loads(data, {}) or {}
	doc = frappe.get_doc(RULE_DOCTYPE, data["id"]) if data.get("id") else frappe.new_doc(RULE_DOCTYPE)
	reference_doctype = data.get("reference_doctype") or None
	conditions = rule_conditions.parse(data.get("conditions"))
	if not conditions and any(data.get(k) for k in ("min_amount", "priority_is", "label_contains")):
		# v0.1 API payload (fixed conditions)
		conditions = rule_conditions.legacy_to_conditions(
			reference_doctype, data.get("min_amount"), data.get("priority_is"), data.get("label_contains")
		)
	doc.update({
		"rule_name": (data.get("label") or "").strip(),
		"enabled": 1 if data.get("active", True) else 0,
		"reference_doctype": reference_doctype,
		"match": "Any" if data.get("match") == "Any" else "All",
		"conditions": frappe.as_json(conditions, indent=None) if conditions else None,
		"set_priority": data.get("set_priority") or "",
		"add_label": join_tags(data.get("add_labels") if data.get("add_labels") is not None else data.get("add_label")),
	})
	if doc.is_new():
		doc.insert()
	else:
		doc.save()
	return _rule_dict(doc)


@frappe.whitelist()
def get_rule_fields(doctype="ToDo"):
	"""Fields a rule condition can test: the ToDo's, or the reference DocType's (name, label, fieldtype, options)."""
	_ensure_rules_manager()
	if not doctype or not frappe.db.exists("DocType", doctype):
		frappe.throw(_("DocType {0} not found").format(doctype), frappe.DoesNotExistError)
	return rule_conditions.filterable_fields(doctype)


@frappe.whitelist()
def toggle_rule(name):
	_ensure_rules_manager()
	doc = frappe.get_doc(RULE_DOCTYPE, name)
	doc.enabled = 0 if doc.enabled else 1
	doc.save()
	return _rule_dict(doc)


@frappe.whitelist()
def delete_rule(name):
	_ensure_rules_manager()
	frappe.delete_doc(RULE_DOCTYPE, name)
	return {"ok": 1}


@frappe.whitelist()
def save_recurring(data):
	data = loads(data, {}) or {}
	doc = _get_recurring(data["id"]) if data.get("id") else frappe.new_doc(RECURRING_DOCTYPE)
	frequency = data.get("frequency") if data.get("frequency") in FREQUENCIES else "Monthly"
	# next_run is not taken from the client: the controller derives it from the frequency
	doc.update({
		"title": (data.get("label") or "").strip(),
		"enabled": 1 if data.get("active", True) else 0,
		"allocated_to": data.get("to") or None,
		"role": data.get("role") or None,
		"frequency": frequency,
		"task_template": data.get("template") or None,
		"priority": data.get("priority") if data.get("priority") in ("High", "Medium", "Low") else "Medium",
		"subject": (data.get("subject") or "").strip(),
		"description": data.get("description") or "",
		"labels": join_tags(data.get("labels")),
	})
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return _recurring_dict(doc)


@frappe.whitelist()
def toggle_recurring(name):
	doc = _get_recurring(name)
	doc.enabled = 0 if doc.enabled else 1
	doc.save(ignore_permissions=True)
	return _recurring_dict(doc)


@frappe.whitelist()
def delete_recurring(name):
	_get_recurring(name)
	frappe.delete_doc(RECURRING_DOCTYPE, name, ignore_permissions=True)
	return {"ok": 1}


@frappe.whitelist()
def run_recurring_now(name):
	"""Creates the task(s) immediately; the schedule (next run) is left unchanged."""
	doc = _get_recurring(name)
	names = _create_from_recurring(doc)
	frappe.db.commit()
	todo = names[0] if names else None
	return {
		"name": todo, "names": names, "count": len(names),
		"todo": get_todo(todo) if todo else None,
		"recurring": _recurring_dict(frappe.get_doc(RECURRING_DOCTYPE, name)),
	}
