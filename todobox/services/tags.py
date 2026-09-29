"""Tags: ToDoBox tags are Frappe "Tag" records (Desk's Tag list).

Every tag field in the app suggests from that list, and any new tag saved on a task, a rule or a
recurring task is added to it.
"""

import frappe
from frappe.utils import cint

from todobox.services.common import split_csv

TAG_DOCTYPE = "Tag"


@frappe.whitelist()
def search_tags(txt="", limit=20):
	"""Tag names matching ``txt`` (all tags when empty), alphabetical."""
	filters = {"name": ["like", f"%{(txt or '').strip()}%"]} if (txt or "").strip() else None
	return frappe.get_all(
		TAG_DOCTYPE, filters=filters, pluck="name", order_by="name asc", limit_page_length=min(cint(limit) or 20, 100)
	)


def ensure_tags(tags):
	"""Creates the Tag records that don't exist yet (one query for the lookup)."""
	tags = [t for t in dict.fromkeys((str(x).strip() for x in (tags or []))) if t]
	if not tags:
		return
	existing = set(frappe.get_all(TAG_DOCTYPE, filters={"name": ["in", tags]}, pluck="name"))
	for tag in tags:
		if tag in existing:
			continue
		try:
			frappe.get_doc({"doctype": TAG_DOCTYPE, "__newname": tag}).insert(
				ignore_permissions=True, ignore_if_duplicate=True
			)
		except Exception:
			frappe.logger("todobox").exception(f"Could not create Tag {tag!r}")


def sync_todo_tags(doc, method=None):
	"""ToDo on_update: new tags on the task join the Tag list."""
	if doc.meta.has_field("labels") and (doc.is_new() or doc.has_value_changed("labels")):
		ensure_tags(split_csv(doc.get("labels")))
