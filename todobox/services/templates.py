"""Task templates (ToDoBox Task Template) with their checklist steps."""

import frappe
from frappe import _
from frappe.utils import sbool

from todobox.services.checklist import normalize_checklist, set_checklist
from todobox.services.common import CHECKLIST_ITEM_DOCTYPE, TEMPLATE_DOCTYPE, loads


def template_dicts(filters=None):
	templates = frappe.get_all(
		TEMPLATE_DOCTYPE,
		filters=filters or {},
		fields=["name", "template_name", "subject", "description", "priority", "enabled", "modified"],
		order_by="template_name asc",
	)
	steps = {}
	if templates:
		for r in frappe.get_all(
			CHECKLIST_ITEM_DOCTYPE,
			filters={
				"parenttype": TEMPLATE_DOCTYPE,
				"parentfield": "checklist",
				"parent": ["in", [t.name for t in templates]],
			},
			fields=["parent", "step"],
			order_by="idx asc",
		):
			steps.setdefault(r.parent, []).append(r.step)

	return [
		{
			"id": t.name,
			"label": t.template_name or t.name,
			"subject": t.subject or "",
			"body": t.description or "",
			"priority": t.priority or "Medium",
			"enabled": bool(t.enabled),
			"checklist": steps.get(t.name, []),
			"modified": str(t.modified),
		}
		for t in templates
	]


@frappe.whitelist()
def get_task_templates(include_disabled=1):
	"""Task templates with their checklist steps."""
	return template_dicts(None if sbool(include_disabled) else {"enabled": 1})


@frappe.whitelist()
def save_task_template(data):
	"""Creates or updates a task template (renaming it when the label changes)."""
	data = loads(data, {})
	label = " ".join(str(data.get("label") or "").split())
	if not label:
		frappe.throw(_("Enter a template name"))

	name = data.get("id")
	if name and frappe.db.exists(TEMPLATE_DOCTYPE, name):
		doc = frappe.get_doc(TEMPLATE_DOCTYPE, name)
	else:
		doc = frappe.new_doc(TEMPLATE_DOCTYPE)
		doc.template_name = label

	doc.subject = (data.get("subject") or "").strip()
	doc.description = (data.get("body") or "").strip()
	doc.priority = data.get("priority") if data.get("priority") in ("Low", "Medium", "High") else "Medium"
	doc.enabled = 1 if data.get("enabled", True) else 0
	set_checklist(doc, [(step, 0) for step, _done in normalize_checklist(data.get("checklist"))], fieldname="checklist")
	doc.save()

	if doc.name != label:
		doc = frappe.get_doc(TEMPLATE_DOCTYPE, frappe.rename_doc(TEMPLATE_DOCTYPE, doc.name, label, show_alert=False))

	frappe.db.commit()
	return template_dicts({"name": doc.name})[0]


@frappe.whitelist()
def delete_task_template(name):
	"""Deletes a task template; ToDos created from it keep their checklist."""
	frappe.delete_doc(TEMPLATE_DOCTYPE, name)
	frappe.db.commit()
	return {"status": "success"}
