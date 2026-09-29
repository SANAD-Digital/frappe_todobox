"""Estimates were removed from ToDoBox: drop the ToDo "est_minutes" Custom Field (the DB column is left as is)."""

import frappe


def execute():
	# todo_tool (a predecessor app) still uses this field while it is installed
	if "todo_tool" in frappe.get_installed_apps():
		return
	if frappe.db.exists("Custom Field", "ToDo-est_minutes"):
		frappe.delete_doc("Custom Field", "ToDo-est_minutes", ignore_permissions=True, force=True)
		frappe.clear_cache(doctype="ToDo")
