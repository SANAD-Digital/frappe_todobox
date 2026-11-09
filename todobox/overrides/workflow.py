"""Workflow controller: the state field stays visible (read-only) on the document form, and a workflow with
"Has trace?" gets the Workflow Trace table on its document type."""

import frappe
from frappe import _
from frappe.workflow.doctype.workflow.workflow import Workflow

MODULE = "ToDoBox"


class CustomWorkflow(Workflow):
	def create_custom_field_for_workflow_state(self):
		frappe.clear_cache(doctype=self.document_type)
		meta = frappe.get_meta(self.document_type)

		if not meta.get_field(self.workflow_state_field):
			self._add_field(
				{
					"fieldname": self.workflow_state_field,
					"label": self.workflow_state_field.replace("_", " ").title(),
					"fieldtype": "Link",
					"options": "Workflow State",
					"hidden": 0,
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				}
			)
			frappe.msgprint(_("Created Custom Field {0} in {1}").format(self.workflow_state_field, self.document_type))

		if self.get("todobox_has_wf_trace"):
			self._create_trace_fields()

	def _create_trace_fields(self):
		meta = frappe.get_meta(self.document_type)
		if not meta.get_field("section_workflow_trace"):
			self._add_field(
				{
					"fieldname": "section_workflow_trace",
					"label": "Workflow Trace",
					"fieldtype": "Section Break",
					"collapsible": 1,
				}
			)
		meta = frappe.get_meta(self.document_type)
		if not meta.get_field("todobox_wf_trace"):
			self._add_field(
				{
					"fieldname": "todobox_wf_trace",
					"label": "Workflow Trace",
					"fieldtype": "Table",
					"options": "Workflow Trace",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"insert_after": "section_workflow_trace",
				}
			)

	def _add_field(self, definition):
		frappe.get_doc(
			{
				"doctype": "Custom Field",
				"dt": self.document_type,
				"module": MODULE,
				"owner": "Administrator",
				**definition,
			}
		).insert(ignore_permissions=True)
		frappe.clear_cache(doctype=self.document_type)
