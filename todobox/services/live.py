"""Live updates: tell the people in a task that it changed, so open pages refresh without a reload.

With socket.io, "todobox_update" is published to each participant's user room after commit. Without
it (or while it reconnects) the page polls get_pulse(), a small signature of what the user can see,
and reloads only when it changes.
"""

import frappe

from todobox.services.common import split_csv, todo_has
from todobox.services.query import my_scope, query_values

EVENT = "todobox_update"


def _participants(todo):
	users = {todo.get("allocated_to"), todo.get("assigned_by"), *split_csv(todo.get("cc_users"))}
	return {u for u in users if u and u != "Guest"}


def _publish(users, names, kind):
	for user in users:
		frappe.publish_realtime(EVENT, {"names": names, "kind": kind}, user=user, after_commit=True)


def publish_task_update(todo, kind, exclude=None):
	"""A change that does not save the ToDo (e.g. read_by), published to its other participants."""
	_publish(_participants(todo) - {exclude}, [todo.name], kind)


def on_todo_change(doc, method=None):
	"""ToDo after_insert / on_update / on_trash."""
	if frappe.flags.in_import or frappe.flags.in_migrate or frappe.flags.in_install:
		return
	users = _participants(doc)
	before = doc.get_doc_before_save() if method == "on_update" else None
	if before:
		users |= _participants(before)  # reassigned or a CC removed: their list changes too
	_publish(users, [doc.name], "task")


def on_comment_insert(doc, method=None):
	"""Comment after_insert: on a task, or on a document that open tasks refer to."""
	if not doc.reference_doctype or not doc.reference_name:
		return
	if doc.reference_doctype == "ToDo":
		todos = frappe.get_all(
			"ToDo",
			filters={"name": doc.reference_name},
			fields=["name", "allocated_to", "assigned_by", *(["cc_users"] if todo_has("cc_users") else [])],
		)
		kind = "comment"
	else:
		todos = frappe.get_all(
			"ToDo",
			filters={
				"reference_type": doc.reference_doctype,
				"reference_name": doc.reference_name,
				"status": "Open",
			},
			fields=["name", "allocated_to", "assigned_by", *(["cc_users"] if todo_has("cc_users") else [])],
			limit=50,
		)
		kind = "reference"
	by_user = {}
	for t in todos:
		for user in _participants(t):
			by_user.setdefault(user, []).append(t.name)
	for user, names in by_user.items():
		_publish([user], names, kind)


@frappe.whitelist()
def get_pulse():
	"""What the current user can see changed? {tasks, workflow, notifications} signatures."""
	values = query_values()
	scope = []
	my_scope(scope)
	# read_by changes without touching modified (opening a task): its checksum shows them too
	read_sum = "SUM(CRC32(IFNULL(read_by, '')))" if todo_has("read_by") else "0"
	tasks = frappe.db.sql(
		f"SELECT COUNT(*), CONCAT(MAX(modified), '/', {read_sum}) FROM `tabToDo` WHERE {scope[0]}", values
	)[0]
	# comments of the last day on my tasks and on the documents my open tasks refer to
	values["since"] = frappe.utils.add_days(frappe.utils.now_datetime(), -1)
	scope_t = "(t.allocated_to = %(me)s OR t.assigned_by = %(me)s" + (
		" OR t.cc_users LIKE %(me_like)s)" if todo_has("cc_users") else ")"
	)
	comments = frappe.db.sql(
		f"""SELECT COUNT(*), MAX(c.creation) FROM `tabComment` c
		INNER JOIN `tabToDo` t ON (
			(c.reference_doctype = 'ToDo' AND c.reference_name = t.name)
			OR (c.reference_doctype = t.reference_type AND c.reference_name = t.reference_name AND t.status = 'Open')
		)
		WHERE c.creation > %(since)s AND {scope_t}""",
		values,
	)[0]
	notifications = frappe.db.sql(
		"SELECT COUNT(*), MAX(modified) FROM `tabNotification Log` WHERE for_user = %(me)s", values
	)[0]
	workflow = (
		frappe.db.sql("SELECT COUNT(*), MAX(modified) FROM `tabWorkflow Action` WHERE status = 'Open'")[0]
		if frappe.db.exists("DocType", "Workflow Action")
		else (0, None)
	)
	sig = lambda row: f"{row[0]}|{row[1] or ''}"  # noqa: E731
	return {
		"tasks": sig(tasks) + "/" + sig(comments),
		"notifications": sig(notifications),
		"workflow": sig(workflow),
	}
