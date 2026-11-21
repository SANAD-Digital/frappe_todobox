"""Comments of the other tasks (ToDo) linked to the same document as a task, for "Show all comments" in its
conversation, and the ToDo a comment was written from (Comment.todobox_todo)."""

import frappe
from frappe.utils import get_fullname

from todobox.services.common import can, derive_subject, is_participant, split_csv
from todobox.services.workflow import _initials

FIELD = "todobox_todo"
LIMIT = 300


def _has_field() -> bool:
	return frappe.db.has_column("Comment", FIELD)


def stamp_comment_todo(doc, method=None):
	"""doc_events Comment before_insert: a comment on a ToDo is written from that ToDo."""
	if doc.reference_doctype == "ToDo" and doc.reference_name and not doc.get(FIELD) and _has_field():
		doc.set(FIELD, doc.reference_name)


def mark_written_from(comment_name, todo_name):
	"""A comment ToDoBox added to a task's linked document, from that task."""
	if comment_name and _has_field():
		frappe.db.set_value("Comment", comment_name, FIELD, todo_name, update_modified=False)


def backfill_comment_todo():
	"""Comments on ToDos written before the field existed."""
	if _has_field():
		frappe.db.sql(
			f"""UPDATE `tabComment` SET `{FIELD}` = reference_name
			WHERE reference_doctype = 'ToDo' AND IFNULL(`{FIELD}`, '') = ''"""
		)


@frappe.whitelist()
def get_related_comments(name):
	"""{items, users}: the comments of the other tasks linked to this task's document (those the user may read),
	and every comment on that document (with the task it was written from, if any). Oldest first."""
	todo = frappe.get_doc("ToDo", name)
	if not is_participant(todo):
		frappe.throw(frappe._("You do not have access to this task"), frappe.PermissionError)
	empty = {"items": [], "users": {}}
	if not (todo.reference_type and todo.reference_name):
		return empty

	siblings = {}
	for r in frappe.get_all(
		"ToDo",
		filters={"reference_type": todo.reference_type, "reference_name": todo.reference_name, "name": ("!=", name)},
		fields=["name", "description", "allocated_to", "assigned_by", "cc_users", "status"]
		+ (["subject"] if frappe.get_meta("ToDo").has_field("subject") else []),
		limit=LIMIT,
	):
		me = frappe.session.user
		# assignee, assigner, CC, or anyone Frappe lets read the ToDo (common.is_participant, without loading it)
		if me in (r.allocated_to, r.assigned_by) or me in split_csv(r.get("cc_users")) or can("ToDo", "read", doc=r.name):
			siblings[r.name] = r

	fields = ["name", "reference_doctype", "reference_name", "comment_type", "comment_email", "owner", "content", "creation"]
	has_reply = frappe.db.has_column("Comment", "is_reply")
	if has_reply:
		fields.append("is_reply")

	rows = []
	if siblings:
		rows += frappe.get_all(
			"Comment",
			filters={"reference_doctype": "ToDo", "reference_name": ("in", list(siblings)), "comment_type": "Comment"},
			fields=fields,
			order_by="creation asc",
			limit=LIMIT,
		)
	ref_readable = frappe.db.exists(todo.reference_type, todo.reference_name) and can(
		todo.reference_type, "read", doc=todo.reference_name
	)
	if ref_readable:
		rows += frappe.get_all(
			"Comment",
			filters={
				"reference_doctype": todo.reference_type,
				"reference_name": todo.reference_name,
				"comment_type": "Comment",
			},
			fields=[*fields, FIELD] if _has_field() else fields,
			order_by="creation asc",
			limit=LIMIT,
		)

	items, users = [], {}
	for c in sorted(rows, key=lambda c: c.creation):
		on_doc = c.reference_doctype != "ToDo"
		source = c.get(FIELD) if on_doc else c.reference_name
		user = c.comment_email or c.owner
		users.setdefault(user, None)
		task = siblings.get(source) if source else None
		items.append(
			{
				"id": c.name,
				"kind": "reply" if has_reply and c.get("is_reply") else "comment",
				"user": user,
				"html": c.content,
				"ts": str(c.creation),
				"todo": source or "",
				"own": 1 if source == name else 0,
				"on_doc": 1 if on_doc else 0,
				"todo_subject": derive_subject(task) if task else "",
			}
		)
	for u in users:
		full = get_fullname(u)
		users[u] = {"name": full, "initials": _initials(full)}
	return {"items": items, "users": users}
