"""Server logic around Frappe Workflow: Workflow Action enrichment, receipt and completion times, Workflow
Trace, the progress bar and the Desk sidebar endpoints.
"""

import frappe
from frappe import _
from frappe.model.workflow import (
	get_workflow_name,
	get_workflow_safe_globals,
	get_workflow_state_field,
	has_approval_access,
	is_transition_condition_satisfied,
)
from frappe.utils import cint, format_datetime, get_datetime, get_fullname, now_datetime, time_diff_in_seconds
from frappe.utils.user import get_users_with_role

from todobox.services.wf_rules import enforce_user_rule, user_fields, user_rule_passes

ACTION = "Workflow Action"
PERMITTED_USER = "Workflow Action Permitted User"
PERMITTED_ROLE = "Workflow Action Permitted Role"
CHUNK = 500


def _active_workflow(doc):
	"""The document's workflow name, or None when the document events have nothing to do."""
	if (
		frappe.flags.in_install
		or frappe.flags.in_migrate
		or frappe.flags.in_patch
		or frappe.flags.in_fixtures
	):
		return None
	return get_workflow_name(doc.doctype) or None


# ------------------------------------------------------------------ document events
def before_transition(doc, method=None):
	"""doc_events "*" validate / before_cancel / before_update_after_submit."""
	if not _active_workflow(doc):
		return
	enforce_user_rule(doc)
	if not doc.is_new():
		doc.flags.todobox_open_actions = frappe.get_all(
			ACTION, filters={"reference_doctype": doc.doctype, "reference_name": doc.name, "status": "Open"}, pluck="name"
		)


def after_transition(doc, method=None):
	"""doc_events "*" on_update / on_update_after_submit / on_cancel; Frappe's process_workflow_actions has
	already run. A submit fires on_update only here, so each state change is handled once."""
	workflow = _active_workflow(doc)
	if not workflow:
		return

	# again after the write: Document._validate may set the state on a plain submit, after before_transition
	enforce_user_rule(doc)

	field = get_workflow_state_field(workflow)
	state = doc.get(field)
	if not state:
		return

	_stamp_completed_actions(doc)
	try:
		create_workflow_trace(doc, state)
	except Exception:
		frappe.log_error(title="ToDoBox: workflow trace failed")

	if doc.has_value_changed(field) and doc.flags.todobox_enriched_state != state:
		doc.flags.todobox_enriched_state = state
		try:
			enrich_workflow_action(doc, workflow, state)
		except Exception:
			frappe.log_error(title="ToDoBox: workflow action enrichment failed")


def _stamp_completed_actions(doc):
	"""Rows this save completed. Older rows completed without these values keep them empty rather than
	getting today's date."""
	opened = doc.flags.pop("todobox_open_actions", None)
	if not opened or not frappe.get_meta(ACTION).has_field("completed_on"):
		return
	now = now_datetime()
	for row in frappe.get_all(
		ACTION,
		filters={"name": ("in", opened), "status": "Completed", "completed_on": ("is", "not set")},
		fields=["name", "creation"],
	):
		frappe.db.set_value(
			ACTION,
			row.name,
			{"completed_on": now, "duration": max(0, int(time_diff_in_seconds(now, row.creation)))},
			update_modified=False,
		)


# ------------------------------------------------------------------ Workflow Action
def _next_transitions(workflow, state, doc) -> list:
	"""In the order of the workflow definition, so the first one is the same on every call."""
	wf = frappe.get_cached_doc("Workflow", workflow)
	optional = {s.state for s in wf.states if cint(s.is_optional_state)}
	rows = sorted((t for t in wf.transitions if t.state == state), key=lambda t: t.idx)
	return [t for t in rows if t.next_state not in optional and is_transition_condition_satisfied(t, doc)]


def _permitted_users(doc, transitions) -> list[str]:
	"""Empty when no transition names users: the action is then open to its roles."""
	if not any(user_fields(t) for t in transitions):
		return []

	users = set()
	for t in transitions:
		fields = user_fields(t)
		# an "or" rule whose condition holds (these transitions passed it) lets the whole role in
		if not fields or (t.condition and not cint(t.todobox_use_and_condition)):
			users |= {
				u
				for u in get_users_with_role(t.allowed)
				if has_approval_access(u, doc, t) and frappe.has_permission(doc.doctype, "read", doc=doc, user=u)
			}
			continue
		values = [doc.get(f) for f in fields]
		if cint(t.todobox_use_and_condition_between_users):
			if all(values) and len(set(values)) == 1:
				users.add(values[0])
		else:
			users |= {v for v in values if v}
	return sorted(u for u in users if frappe.db.exists("User", u))


def enrich_workflow_action(doc, workflow, state):
	transitions = _next_transitions(workflow, state, doc)
	if not transitions:
		return
	open_action = frappe.get_all(
		ACTION,
		filters={
			"reference_doctype": doc.doctype,
			"reference_name": doc.name,
			"workflow_state": state,
			"status": "Open",
		},
		order_by="creation desc",
		limit=1,
		pluck="name",
	)
	if not open_action:
		return

	action = frappe.get_doc(ACTION, open_action[0])
	action.next_state = transitions[0].next_state
	action.next_action = transitions[0].action
	action.set("permitted_roles", [])
	for role in sorted({t.allowed for t in transitions}):
		action.append("permitted_roles", {"role": role})
	users = _permitted_users(doc, transitions)
	action.set("todobox_permitted_users", [])
	for user in users:
		action.append("todobox_permitted_users", {"user": user})
	action.todobox_permitted_users_count = len(users)
	action.flags.ignore_version = True
	action.flags.ignore_links = True
	action.save(ignore_permissions=True)


# ------------------------------------------------------------------ receipt
def _unreceived_actions(doctype, name, user) -> list[str]:
	"""Open rows waiting on this user: named on the row or, when it names nobody, through a permitted role."""
	workflow = get_workflow_name(doctype)
	if not workflow:
		return []
	# not an Open row of a state the document has left: Frappe does not close it when a state is re-entered
	state = frappe.db.get_value(doctype, name, get_workflow_state_field(workflow))
	rows = frappe.get_all(
		ACTION,
		filters={
			"reference_doctype": doctype,
			"reference_name": name,
			"workflow_state": state,
			"status": "Open",
			"received_on": ("is", "not set"),
		},
		pluck="name",
	)
	if not rows:
		return []
	named = {}
	for row in frappe.get_all(PERMITTED_USER, filters={"parent": ("in", rows)}, fields=["parent", "user"]):
		named.setdefault(row.parent, set()).add(row.user)
	# Administrator holds every role: opening a document does not make it the recipient
	roles = set(frappe.get_roles(user)) if user != "Administrator" else set()
	by_role = {
		row.parent
		for row in frappe.get_all(PERMITTED_ROLE, filters={"parent": ("in", rows)}, fields=["parent", "role"])
		if row.role in roles
	}
	return [r for r in rows if (user in named[r] if r in named else r in by_role)]


def _stamp_received(doctype, name, user) -> int:
	names = _unreceived_actions(doctype, name, user)
	now = now_datetime()
	for action in names:
		frappe.db.set_value(ACTION, action, "received_on", now, update_modified=False)
	return len(names)


def enqueue_workflow_receipt(doc, method=None):
	"""doc_events "*" onload: only when there is something to stamp for this user."""
	user = frappe.session.user
	if user == "Guest" or doc.is_new() or not _active_workflow(doc):
		return
	if not frappe.get_meta(ACTION).has_field("received_on") or not _unreceived_actions(doc.doctype, doc.name, user):
		return
	frappe.enqueue(
		"todobox.services.wf_engine.update_received_on",
		queue="short",
		job_id=f"todobox_wf_receipt::{doc.doctype}::{doc.name}::{user}",
		deduplicate=True,
		ref_doctype=doc.doctype,
		ref_name=doc.name,
		user=user,
	)


def update_received_on(ref_doctype, ref_name, user):
	_stamp_received(ref_doctype, ref_name, user)


@frappe.whitelist(methods=["POST"])
def mark_received(doctype, name) -> int:
	"""Explicit "I opened this": for a real open, never for a hover prefetch."""
	frappe.get_doc(doctype, name).check_permission("read")
	return _stamp_received(doctype, name, frappe.session.user)


# ------------------------------------------------------------------ Workflow Trace
def _employee_details(user):
	"""ERPNext is optional."""
	if not frappe.db.table_exists("Employee") or not frappe.get_meta("Employee").has_field("user_id"):
		return {}
	return (
		frappe.db.get_value("Employee", {"user_id": user}, ["employee_name", "designation"], as_dict=True) or {}
	)


def create_workflow_trace(doc, state):
	if not doc.meta.has_field("todobox_wf_trace"):
		return
	rows = doc.get("todobox_wf_trace") or []
	if rows and rows[-1].workflow_state == state:
		return

	since = rows[-1].date if rows else doc.creation
	employee = _employee_details(doc.modified_by)
	seconds = max(0, int(time_diff_in_seconds(get_datetime(doc.modified), get_datetime(since))))
	# in the document, not just in the table: a later save of this object would delete an unknown row
	row = doc.append(
		"todobox_wf_trace",
		{
			"workflow_state": state,
			"user": doc.modified_by,
			"user_name": get_fullname(doc.modified_by),
			"employee_name": employee.get("employee_name"),
			"designation": employee.get("designation"),
			"date": doc.modified,
			"duration": seconds,
			"duration_seconds": seconds,
		},
	)
	row.docstatus = doc.docstatus
	row.db_insert()


# ------------------------------------------------------------------ progress bar
def _read_doc(doctype, name):
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")
	return doc


def _state_condition_holds(state, doc) -> bool:
	try:
		return bool(
			frappe.safe_eval(state.todobox_statusbar_condition, get_workflow_safe_globals(), {"doc": doc.as_dict()})
		)
	except Exception:
		frappe.log_error(title=f"ToDoBox: progress condition failed for state {state.state}")
		return False


@frappe.whitelist()
def valid_states(doctype, name):
	"""The workflow states to show on the document's status bar: [states, workflow]."""
	doc = _read_doc(doctype, name)
	workflow_name = get_workflow_name(doctype)
	if not workflow_name:
		return [], {}

	workflow = frappe.get_cached_doc("Workflow", workflow_name)
	states = []
	for idx, state in enumerate(workflow.states or [], start=1):
		if not cint(state.get("show_in_statusbar")):
			continue
		if state.get("todobox_statusbar_condition") and not _state_condition_holds(state, doc):
			continue
		states.append(
			{
				"state": state.state,
				"status_no": cint(state.get("status_no")) or idx,
				"style": state.get("style"),
				"show_in_statusbar": 1,
			}
		)
	states.sort(key=lambda row: row["status_no"])
	return states, {"name": workflow.name, "show_status_bar": cint(workflow.get("show_status_bar"))}


@frappe.whitelist()
def get_all_possible_next_actions(doctype, name):
	return next_actions_of(_read_doc(doctype, name))


def next_actions_of(doc) -> dict:
	"""Every way out of the document's current state, whoever may take it: {action: {state, next_state,
	users | roles}}. The caller has checked read access."""
	workflow = get_workflow_name(doc.doctype)
	if not workflow:
		return {}

	state = doc.get(get_workflow_state_field(workflow))
	result = {}
	for t in frappe.get_cached_doc("Workflow", workflow).transitions:
		if t.state != state or not is_transition_condition_satisfied(t, doc):
			continue
		entry = result.setdefault(t.action, {"state": t.state, "next_state": t.next_state})
		fields = user_fields(t)
		if fields:
			users = entry.setdefault("users", [])
			users += [u for u in (get_fullname(doc.get(f)) for f in fields if doc.get(f)) if u not in users]
		else:
			roles = entry.setdefault("roles", [])
			if t.allowed not in roles:
				roles.append(t.allowed)
	return result


@frappe.whitelist()
def get_document_workflow_timeline(doctype, name, limit=200):
	return timeline_of(_read_doc(doctype, name), limit)


def timeline_of(doc, limit=200) -> list:
	"""The document's Workflow Actions, oldest first. An Open row of a state the document has left is not
	shown: Frappe does not close it when a state is re-entered. The caller has checked read access."""
	limit = min(max(cint(limit) or 200, 1), 1000)
	workflow = get_workflow_name(doc.doctype)
	current = doc.get(get_workflow_state_field(workflow)) if workflow else None

	timeline = []
	for row in frappe.get_all(
		ACTION,
		filters={"reference_doctype": doc.doctype, "reference_name": doc.name},
		fields=[
			"name",
			"status",
			"workflow_state",
			"next_state",
			"next_action",
			"user",
			"completed_by",
			"completed_by_role",
			"received_on",
			"completed_on",
			"duration",
			"creation",
			"owner",
		],
		order_by="creation asc",
		limit=limit,
	):
		if row.status == "Open" and row.workflow_state != current:
			continue
		# next_state and next_action are what was expected when the row opened: another action may have been
		# taken since, so they describe only a row still open
		is_open = row.status == "Open"
		actor = "-" if is_open else (row.completed_by or row.user or row.owner or "-")
		if is_open and row.next_action:
			event = _("Action: {0}", context="ToDoBox").format(_(row.next_action))
		elif is_open and row.next_state:
			event = _("Move to: {0}", context="ToDoBox").format(_(row.next_state))
		else:
			event = _(row.workflow_state) if row.workflow_state else _("Workflow Action", context="ToDoBox")

		details = []
		if is_open and row.next_state:
			details.append(_("To: {0}").format(_(row.next_state)))
		if row.status:
			details.append(_("Status: {0}", context="ToDoBox").format(_(row.status)))
		if row.duration:
			details.append(_("Duration: {0}", context="ToDoBox").format(frappe.utils.format_duration(row.duration)))

		timeline.append(
			{
				"name": row.name,
				"event": event,
				"workflow_state": row.workflow_state or "-",
				"user": actor,
				"user_name": get_fullname(actor) if actor != "-" else "-",
				"date": row.completed_on or row.received_on or row.creation,
				"date_text": format_datetime(row.completed_on or row.received_on or row.creation),
				"received_text": format_datetime(row.received_on) if row.received_on else "",
				"duration": row.duration or "",
				"details": " • ".join(details),
			}
		)
	return timeline


# ------------------------------------------------------------------ sidebar
def _readable_references(doctype, names, company) -> dict:
	"""{name: row with owner and state} of the documents the user can read, without those of another company.
	Anything that cannot be checked is left out."""
	if not frappe.db.exists("DocType", doctype) or not frappe.has_permission(doctype, "read"):
		return {}
	has_company = frappe.get_meta(doctype).has_field("company")
	workflow = get_workflow_name(doctype)
	state_field = get_workflow_state_field(workflow) if workflow else None
	if not state_field:
		return {}
	fields = ["name", "owner", f"{state_field} as state"] + (["company"] if has_company else [])
	result = {}
	names = list(names)
	try:
		for i in range(0, len(names), CHUNK):
			for row in frappe.get_list(
				doctype, filters={"name": ("in", names[i : i + CHUNK])}, fields=fields, limit_page_length=0
			):
				if not (has_company and company and row.company and row.company != company):
					result[row.name] = row
	except Exception:
		frappe.log_error(title=f"ToDoBox: workflow sidebar could not read {doctype}")
		return {}
	return result


def _permitted_users_of(action_names) -> dict:
	result = {}
	for i in range(0, len(action_names), CHUNK):
		for row in frappe.get_all(
			PERMITTED_USER, filters={"parent": ("in", action_names[i : i + CHUNK])}, fields=["parent", "user"]
		):
			result.setdefault(row.parent, set()).add(row.user)
	return result


def _available_actions(row, owner, transitions, user, loaded) -> list[str]:
	"""The actions this user can really take on the document."""
	actions = []
	for t in transitions:
		if t.action in actions:
			continue
		if t.condition or user_fields(t):
			key = (row.reference_doctype, row.reference_name)
			try:
				doc = loaded.get(key) or frappe.get_doc(*key)
				loaded[key] = doc
				if not is_transition_condition_satisfied(t, doc) or not user_rule_passes(doc, t):
					continue
			except Exception:
				frappe.log_error(title=f"ToDoBox: workflow sidebar could not evaluate {key[0]} {key[1]}")
				continue
		if has_approval_access(user, {"owner": owner}, t):
			actions.append(t.action)
	return actions


@frappe.whitelist()
def get_sidebar_workflow_actions(limit=20):
	"""Open Workflow Actions the user can act on, newest first: {items, total, count}. `total` counts
	all of them; `items` holds the first `limit`."""
	limit = min(max(cint(limit) or 20, 1), 50)
	user = frappe.session.user
	empty = {"items": [], "total": 0, "count": 0}
	if user == "Guest":
		return empty

	meta = frappe.get_meta(ACTION)
	has_users = meta.has_field("todobox_permitted_users_count") and frappe.db.table_exists(PERMITTED_USER)
	fields = ["name", "reference_doctype", "reference_name", "workflow_state", "modified", "creation"]
	if has_users:
		fields.append("todobox_permitted_users_count")
	rows = [
		r
		for r in frappe.get_list(
			ACTION, filters={"status": "Open"}, fields=fields, order_by="modified desc", limit_page_length=0
		)
		if r.reference_doctype and r.reference_name and r.workflow_state
	]

	if has_users:
		listed = _permitted_users_of([r.name for r in rows if cint(r.todobox_permitted_users_count)])
		rows = [
			r for r in rows if not cint(r.todobox_permitted_users_count) or user in listed.get(r.name, ())
		]

	company = frappe.defaults.get_user_default("company")
	by_doctype = {}
	for r in rows:
		by_doctype.setdefault(r.reference_doctype, set()).add(r.reference_name)
	readable = {dt: _readable_references(dt, names, company) for dt, names in by_doctype.items()}

	roles = set(frappe.get_roles())
	transitions_of = {}
	for dt in by_doctype:
		workflow = get_workflow_name(dt)
		if workflow:
			states = transitions_of.setdefault(dt, {})
			for t in sorted(frappe.get_cached_doc("Workflow", workflow).transitions, key=lambda t: t.idx):
				if t.allowed in roles:
					states.setdefault(t.state, []).append(t)

	items, total, loaded = [], 0, {}
	for r in rows:
		ref = readable.get(r.reference_doctype, {}).get(r.reference_name)
		transitions = transitions_of.get(r.reference_doctype, {}).get(r.workflow_state)
		# an Open row of a state the document has left: Frappe does not close it when a state is re-entered
		if not ref or ref.state != r.workflow_state or not transitions:
			continue
		actions = _available_actions(r, ref.owner, transitions, user, loaded)
		if not actions:
			continue
		total += 1
		if len(items) < limit:
			items.append(
				{
					"name": r.name,
					"reference_doctype": r.reference_doctype,
					"reference_name": r.reference_name,
					"workflow_state": r.workflow_state,
					"modified": r.modified,
					"creation": r.creation,
					"owner": ref.owner,
					"actions": actions,
				}
			)
	return {"items": items, "total": total, "count": total}
