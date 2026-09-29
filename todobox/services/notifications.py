"""Notifications for ToDos, stored as Frappe Notification Log entries."""

import frappe
from frappe import _
from frappe.query_builder import DocType

from todobox.services.common import get_task, short_subject


def create_notification_log(
	for_user,
	subject,
	content=None,
	document_type="ToDo",
	document_name=None,
	from_user=None,
	notif_type="Assignment",
	dedupe=True,
):
	"""Creates a Notification Log for a target user (skips self-notifications and, unless dedupe=False,
	exact duplicates)."""
	if not for_user:
		return None

	sender = from_user or (frappe.session.user if frappe.session and frappe.session.user else "Administrator")
	if for_user == sender:
		return None

	if dedupe and document_name and frappe.db.exists(
		"Notification Log",
		{"for_user": for_user, "document_type": document_type, "document_name": document_name, "subject": subject},
	):
		return None

	prev_mute = frappe.flags.mute_emails
	try:
		frappe.flags.mute_emails = True
		doc = frappe.get_doc(
			{
				"doctype": "Notification Log",
				"for_user": for_user,
				"from_user": sender,
				"type": notif_type,
				"document_type": document_type,
				"document_name": document_name,
				"subject": subject,
				"email_content": content or subject,
				"read": 0,
			}
		).insert(ignore_permissions=True)
		return doc.name
	except Exception:
		frappe.log_error(title="ToDoBox: notification creation failed")
		return None
	finally:
		frappe.flags.mute_emails = prev_mute


@frappe.whitelist()
def create_notification(for_user, subject, content=None, todo_name=None, notif_type="Assignment"):
	"""Creates a ToDo notification for another user (about a task the caller takes part in)."""
	if todo_name:
		get_task(todo_name)
	name = create_notification_log(
		for_user=for_user,
		subject=subject,
		content=content,
		document_type="ToDo",
		document_name=todo_name,
		notif_type=notif_type,
	)
	frappe.db.commit()
	return {"status": "success", "notification_name": name}


def on_todo_after_insert(doc, method=None):
	"""ToDo after_insert (any source): notify the assignee."""
	if doc.allocated_to and doc.allocated_to != (doc.assigned_by or frappe.session.user):
		create_notification_log(
			for_user=doc.allocated_to,
			subject=_("New task assigned to you: {0}").format(short_subject(doc, 60)),
			content=doc.description,
			document_type="ToDo",
			document_name=doc.name,
			from_user=doc.assigned_by,
			notif_type="Assignment",
		)


def _kind(log):
	subject = log.subject or ""
	if log.type == "Assignment":
		return "assign"
	if log.type in ("Mention", "Share"):
		return "reply"
	if "overdue" in subject.lower() or "متأخر" in subject:
		return "overdue"
	if "cc" in subject.lower() or "نسخة" in subject:
		return "cc"
	return "assign"


@frappe.whitelist()
def get_notifications():
	"""The current user's latest 50 Notification Log items about ToDos and workflow documents.
	Each item says where it opens: a ToDo's folder for this user, or the Required-actions screen."""
	from todobox.services.todos import get_todo_folders
	from todobox.services.workflow import _active_workflows

	wf_doctypes = [dt for dt in _active_workflows() if dt != "ToDo"]
	logs = frappe.get_all(
		"Notification Log",
		filters={"for_user": frappe.session.user, "document_type": ["in", ["ToDo", *wf_doctypes]]},
		fields=["name", "subject", "email_content", "document_type", "document_name", "from_user", "read", "type", "creation"],
		order_by="creation desc",
		limit=50,
	)
	folders = get_todo_folders([log.document_name for log in logs if log.document_type == "ToDo"])
	out = []
	for log in logs:
		text = frappe.utils.strip_html(log.email_content or log.subject or "").strip()
		is_todo = log.document_type == "ToDo"
		out.append(
			{
				"id": log.name,
				"kind": _kind(log) if is_todo else "wf",
				"todo": log.document_name if is_todo else None,
				"folder": folders.get(log.document_name, "inbox") if is_todo else None,
				"doctype": None if is_todo else log.document_type,
				"docname": None if is_todo else log.document_name,
				"subject": log.subject or log.document_name,
				"user": log.from_user or "System",
				"text": text or log.subject or _("New task notification"),
				"ts": str(log.creation),
				"read": bool(log.read),
			}
		)
	return out


@frappe.whitelist()
def mark_notif_read(name):
	"""Marks one of the current user's Notification Log entries as read."""
	if frappe.db.get_value("Notification Log", name, "for_user") == frappe.session.user:
		frappe.db.set_value("Notification Log", name, "read", 1)
		frappe.db.commit()
	return {"status": "success"}


@frappe.whitelist()
def mark_all_notifs_read():
	"""Marks all of the current user's ToDo notifications as read."""
	log = DocType("Notification Log")
	(
		frappe.qb.update(log)
		.set(log.read, 1)
		.where((log.for_user == frappe.session.user) & (log.document_type == "ToDo") & (log.read == 0))
	).run()
	frappe.db.commit()
	return {"status": "success"}
