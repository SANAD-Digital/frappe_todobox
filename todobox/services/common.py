"""Shared constants and helpers: DocType names, ToDo column checks, avatars, team and task permissions."""

import hashlib
import json

import frappe
from frappe import _

# ------------------------------------------------------------------ DocTypes
RULE_DOCTYPE = "ToDoBox Rule"
RECURRING_DOCTYPE = "ToDoBox Recurring Task"
TEMPLATE_DOCTYPE = "ToDoBox Task Template"
CHECKLIST_ITEM_DOCTYPE = "ToDoBox Checklist Item"
CHECKLIST_STEP_DOCTYPE = "ToDoBox Checklist Step"
SAVED_VIEW_DOCTYPE = "ToDoBox Saved View"

# ToDo Table MultiSelect holding the checklist (ToDoBox Checklist Item rows)
CHECKLIST_FIELD = "checklist_items"

# msgctxt used by the shipped translations (locale/*.po) for UI words that need a context
TRANSLATION_CONTEXT = "ToDo Tool"

# Priority/date/subject/checklist structure: only the task creator may change these
MANAGER_ONLY_FIELDS = ("priority", "date", "subject", "description", "task_content", "custom_checklist")

AVATAR_COLORS = ("#3f4ea8", "#8a5a2b", "#2f6f5e", "#7a3b6b", "#4a5568", "#a14a4a", "#3b6ea1", "#976420", "#6a4fa6")


def loads(data, default=None):
	"""Accepts a JSON string (from a form post) or an already parsed value."""
	if isinstance(data, str):
		return json.loads(data) if data.strip() else default
	return data if data is not None else default


def todo_has(column):
	"""True when the ToDo table has this column (custom fields from ToDoBox or other apps)."""
	return column in frappe.db.get_table_columns("ToDo")


def is_system_manager(user=None):
	return "System Manager" in frappe.get_roles(user or frappe.session.user)


def generate_initials(name):
	if not name:
		return "؟"
	parts = name.strip().split()
	if len(parts) >= 2:
		return (parts[0][0] + parts[1][0]).upper()
	return name[:2].upper()


def generate_color(text):
	val = int(hashlib.md5((text or "").encode("utf-8")).hexdigest(), 16)
	return AVATAR_COLORS[val % len(AVATAR_COLORS)]


def get_direct_reports(user):
	"""user_ids of employees who report to the given user via Employee.reports_to."""
	if not frappe.db.exists("DocType", "Employee"):
		return []
	emp_names = frappe.get_all("Employee", filters={"user_id": user}, pluck="name")
	if not emp_names:
		return []
	report_users = frappe.get_all(
		"Employee",
		filters={"reports_to": ["in", emp_names], "user_id": ["is", "set"]},
		pluck="user_id",
	)
	return [u for u in report_users if u and u != user]


def split_csv(value):
	return [x.strip() for x in str(value or "").split(",") if x.strip()]


def join_tags(value):
	"""Tags (a list or comma-separated text) → the stored CSV form: trimmed, without duplicates."""
	items = value if isinstance(value, (list, tuple)) else split_csv(value)
	return ",".join(dict.fromkeys(str(x).strip() for x in items if str(x or "").strip()))


def derive_subject(r, lines=None):
	"""Task title: the subject field when present, otherwise the first line of the description."""
	if lines is None:
		clean_text = frappe.utils.strip_html(r.get("description") or "").strip()
		lines = [line.strip() for line in clean_text.split("\n") if line.strip()]
	subject = r.get("subject") or r.get("gcrm_subject")
	if subject and subject != "None":
		return subject
	if lines:
		if lines[0].strip().lower() in ("subject:", "subject") and len(lines) > 1:
			return lines[1]
		return lines[0].replace("Subject:", "").strip() or lines[0]
	return r.get("reference_name") or r.get("name")


def short_subject(doc, length=60):
	"""First line of the subject/description, as plain text, for notification titles."""
	subj = doc.get("subject") or doc.get("gcrm_subject") or doc.get("description") or doc.get("name")
	return frappe.utils.strip_html(str(subj)).strip().split("\n")[0][:length]


# ------------------------------------------------------------------ task permissions
def can_manage(todo):
	"""The assigner (or anyone, for a self task) may change priority/date/subject/checklist structure."""
	me = frappe.session.user
	return not todo.assigned_by or todo.assigned_by == me or me == "Administrator"


def ensure_can_manage(todo):
	if not can_manage(todo):
		frappe.throw(
			_("Only the task creator can change the priority, date, subject and checklist"), frappe.PermissionError
		)


def can_add_checklist_item(todo):
	"""The creator (see can_manage) or the assignee may add checklist steps; removing stays creator-only."""
	return can_manage(todo) or todo.allocated_to == frappe.session.user


def ensure_can_add_checklist_item(todo):
	if not can_add_checklist_item(todo):
		frappe.throw(_("Only the task creator or assignee can add checklist steps"), frappe.PermissionError)


def is_participant(todo, user=None):
	"""Assignee, assigner or CC of the task, or anyone Frappe lets read the ToDo."""
	user = user or frappe.session.user
	if user in (todo.allocated_to, todo.assigned_by) or user in split_csv(todo.get("cc_users")):
		return True
	return bool(frappe.has_permission("ToDo", "read", doc=todo, user=user))


def get_task(name):
	"""Loads a ToDo the current user takes part in; raises PermissionError otherwise."""
	todo = frappe.get_doc("ToDo", name)
	if not is_participant(todo):
		frappe.throw(_("You do not have access to this task"), frappe.PermissionError)
	return todo


def can(doctype, ptype="read", doc=None, user=None):
	"""frappe.has_permission() without side effects. Frappe re-checks the doctype with print_logs on
	when a document check fails, which msgprints "User … does not have doctype access via role
	permission …" into the response even though nothing was thrown; the page then shows it as a
	popup. Drop whatever the check added to the message log."""
	log = frappe.local.message_log if hasattr(frappe.local, "message_log") else None
	size = len(log) if log is not None else 0
	try:
		return bool(frappe.has_permission(doctype, ptype, doc=doc, user=user))
	finally:
		if log is not None:
			del log[size:]
