"""Tasks (ToDo) linked to a document, for the "Tasks" dialog of its Desk form (public/js/linked_todos.bundle.js)."""

import frappe
from frappe.utils import get_fullname, getdate, nowdate

from todobox.services.common import can, derive_subject, split_csv

LIMIT = 500


def set_todo_count(doc, method=None):
	"""doc_events "*" onload: the form shows its Tasks button only when the document has tasks."""
	if doc.doctype == "ToDo" or doc.is_new() or frappe.session.user == "Guest":
		return
	count = frappe.db.count("ToDo", {"reference_type": doc.doctype, "reference_name": doc.name})
	if count:
		doc.set_onload("todobox_todo_count", count)


@frappe.whitelist()
def get_linked_todos(doctype, name):
	"""Every task linked to the document, newest first, for a user who can read the document. A task the user
	takes no part in shows who holds it and where it stands, not what it says."""
	frappe.get_doc(doctype, name).check_permission("read")
	fields = ["name", "description", "status", "priority", "date", "allocated_to", "assigned_by", "owner", "creation"]
	meta = frappe.get_meta("ToDo")
	fields += [f for f in ("subject", "cc_users", "completed_on") if meta.has_field(f)]

	today = getdate(nowdate())
	users, rows = {}, []
	for r in frappe.get_all(
		"ToDo",
		filters={"reference_type": doctype, "reference_name": name},
		fields=fields,
		order_by="creation desc",
		limit=LIMIT,
	):
		me = frappe.session.user
		# assignee, assigner, CC, or anyone Frappe lets read the ToDo (same as common.is_participant)
		readable = me in (r.allocated_to, r.assigned_by) or me in split_csv(r.get("cc_users")) or can("ToDo", "read", doc=r.name)
		assigner = r.assigned_by or r.owner
		for u in (r.allocated_to, assigner):
			if u and u not in users:
				users[u] = {"name": get_fullname(u), "image": frappe.db.get_value("User", u, "user_image")}
		rows.append(
			{
				"name": r.name,
				"subject": derive_subject(r) if readable else "",
				"readable": 1 if readable else 0,
				"status": r.status,
				"overdue": 1 if r.status == "Open" and r.date and getdate(r.date) < today else 0,
				"priority": r.priority,
				"date": r.date,
				"allocated_to": r.allocated_to,
				"assigned_by": assigner,
				"creation": r.creation,
				"completed_on": r.get("completed_on"),
			}
		)
	return {"todos": rows, "users": users}
