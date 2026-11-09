# Copyright (c) 2022, Champion and contributors
# For license information, please see license.txt
import frappe
from frappe import _

from todobox.todobox.report.wf_report_utils import (
	as_filters,
	date_guard,
	doctype_counts,
	employee_guard,
	get_employees,
	get_open_actions,
	join_employee_actions,
	no_employee_access_message,
)

LABEL_LENGTH = 15


def execute(filters=None):
	filters = as_filters(filters)
	columns = get_columns()

	guard = employee_guard(filters) or date_guard(filters)
	if guard:
		return columns, [], guard, None

	try:
		employees = get_employees(filters)
	except frappe.PermissionError:
		return columns, [], no_employee_access_message(), None

	user_rows, role_rows = get_open_actions(filters)
	data = join_employee_actions(employees, user_rows, role_rows)
	return columns, data, None, get_chart(doctype_counts(data, filters.get("employee")))


def get_chart(counts):
	if not counts:
		return None

	labels = [_(key) for key in counts]
	if len(labels) > 1:
		labels = [f"{label[:LABEL_LENGTH]}..." if len(label) > LABEL_LENGTH else label for label in labels]

	return {
		"data": {
			"labels": labels,
			"datasets": [{"name": _("Doctype Count", context="ToDoBox"), "values": list(counts.values())}],
		},
		"type": "pie",
	}


def get_columns():
	return [
		{"fieldname": "employee", "label": _("Employee"), "fieldtype": "Link", "options": "Employee", "width": 300},
		{"fieldname": "employee_name", "label": _("Employee Name"), "fieldtype": "Data", "width": 200, "hidden": 1},
		{"fieldname": "total_open", "label": _("Total Open", context="ToDoBox"), "fieldtype": "Int", "hidden": 1},
		{"fieldname": "average_late_date", "label": _("Avg Late Date", context="ToDoBox"), "fieldtype": "Duration", "hidden": 1},
		{"fieldname": "user", "label": _("User"), "fieldtype": "Link", "options": "User", "width": 200, "hidden": 1},
		{"fieldname": "role", "label": _("Role"), "fieldtype": "Link", "options": "Role", "width": 200, "hidden": 1},
		{"fieldname": "reference_doctype", "label": _("Reference Doctype"), "fieldtype": "Data", "width": 200, "hidden": 1},
		{"fieldname": "reference_type", "label": _("Reference Type"), "fieldtype": "Data", "width": 200},
		{
			"fieldname": "reference_name",
			"label": _("Reference Name"),
			"fieldtype": "Dynamic Link",
			"options": "reference_doctype",
			"width": 200,
		},
		{"fieldname": "workflow_state", "label": _("Workflow State", context="ToDoBox"), "fieldtype": "Data", "width": 250},
		{"fieldname": "creation", "label": _("Date"), "fieldtype": "Date", "width": 160},
		{"fieldname": "late_date", "label": _("Late"), "fieldtype": "Duration", "width": 120},
	]
