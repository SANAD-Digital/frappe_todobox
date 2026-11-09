# Copyright (c) 2022, ToDoBox contributors
# For license information, please see license.txt
import frappe
from frappe import _

from todobox.todobox.report.wf_report_utils import (
	as_filters,
	date_guard,
	employee_guard,
	get_employees,
	get_open_actions,
	info_message,
	join_employee_actions,
	no_employee_access_message,
)


def execute(filters=None):
	filters = as_filters(filters)
	filters.pop("manager", None)  # set here from the option, never from the client
	columns = get_columns()

	guard = employee_guard(filters) or date_guard(filters) or apply_report_option(filters)
	if guard:
		return columns, [], guard

	try:
		employees = get_employees(filters, {"reports_to": filters.manager} if filters.get("manager") else None)
	except frappe.PermissionError:
		return columns, [], no_employee_access_message()

	user_rows, role_rows = get_open_actions(filters, distinct_roles=True)
	return columns, join_employee_actions(employees, user_rows, role_rows)


def apply_report_option(filters):
	"""Resolve the Me / My Team / All option; returns a message when it can't be honoured."""
	option = filters.get("report_option")
	if option == "All":
		if not {"System Manager", "HR Manager"}.intersection(frappe.get_roles()):
			return info_message(_("Only a System Manager or HR Manager can use the All option.", context="ToDoBox"))
		return None

	if option not in ("Me", "My Team"):
		return info_message(_("Please choose an Option.", context="ToDoBox"))

	employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
	if not employee:
		return info_message(_("No Employee record is linked to your user, so {0} has no data.", context="ToDoBox").format(_(option)))

	filters["employee" if option == "Me" else "manager"] = employee
	return None


def get_columns():
	return [
		{"fieldname": "employee", "label": _("Employee"), "fieldtype": "Link", "options": "Employee", "width": 120},
		{"fieldname": "employee_name", "label": _("Employee Name"), "fieldtype": "Data", "width": 120},
		{"fieldname": "total_open", "label": _("Total Open", context="ToDoBox"), "fieldtype": "Int", "hidden": 1},
		{"fieldname": "average_late_date", "label": _("Avg Late Date", context="ToDoBox"), "fieldtype": "Duration", "hidden": 1},
		{"fieldname": "user", "label": _("User"), "fieldtype": "Link", "options": "User", "width": 200, "hidden": 1},
		{"fieldname": "reference_doctype", "label": _("Reference Doctype"), "fieldtype": "Data", "width": 100, "hidden": 1},
		{"fieldname": "reference_type", "label": _("Reference Type"), "fieldtype": "Data", "width": 100},
		{
			"fieldname": "reference_name",
			"label": _("Reference Name"),
			"fieldtype": "Dynamic Link",
			"options": "reference_doctype",
			"width": 200,
		},
		{"fieldname": "workflow_state", "label": _("Workflow State", context="ToDoBox"), "fieldtype": "Data", "width": 150},
		{"fieldname": "creation", "label": _("Date"), "fieldtype": "Date", "width": 100},
		{"fieldname": "late_date", "label": _("Late Duration", context="ToDoBox"), "fieldtype": "Duration", "width": 150},
	]
