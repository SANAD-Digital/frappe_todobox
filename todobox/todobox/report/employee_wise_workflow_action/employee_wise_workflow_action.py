# Copyright (c) 2022, ToDoBox contributors
# For license information, please see license.txt
import frappe
from frappe import _

from todobox.todobox.report.wf_report_utils import (
	as_filters,
	date_guard,
	doctype_counts,
	employee_guard,
	format_duration,
	get_employees,
	get_open_actions,
	info_message,
	join_employee_actions,
	no_employee_access_message,
)


def execute(filters=None):
	filters = as_filters(filters)
	filters.pop("manager", None)  # set here from the option, never from the client
	columns = get_columns(filters)

	guard = employee_guard(filters) or date_guard(filters) or apply_report_option(filters)
	if guard:
		return columns, [], guard, None

	# "Me" may just have set the employee, which hides the employee columns
	columns = get_columns(filters)
	try:
		employees = get_employees(filters, {"reports_to": filters.manager} if filters.get("manager") else None)
	except frappe.PermissionError:
		return columns, [], no_employee_access_message(), None

	user_rows, role_rows = get_open_actions(
		filters, hide_hidden_states=True, distinct_roles=True, join_state_for_roles=True
	)
	data = join_employee_actions(employees, user_rows, role_rows)

	if filters.report_option == "Me" or filters.get("employee"):
		return columns, data, get_summary(data), get_doctype_chart(doctype_counts(data, filters.get("employee")))
	return columns, data, None, get_employee_chart(data)


def apply_report_option(filters):
	"""Resolve the Me / My Team / All option; returns a message when it can't be honoured."""
	option = filters.get("report_option")
	if not option:
		return info_message(_("Please choose an Option.", context="ToDoBox"))

	if option == "All":
		if "System Manager" not in frappe.get_roles():
			return info_message(_("Only a System Manager can use the All option.", context="ToDoBox"))
		return None

	if option not in ("Me", "My Team"):
		return info_message(_("Please choose an Option.", context="ToDoBox"))

	employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
	if not employee:
		return info_message(_("No Employee record is linked to your user, so {0} has no data.", context="ToDoBox").format(_(option)))

	filters["employee" if option == "Me" else "manager"] = employee
	return None


def get_summary(data):
	if not data:
		return None
	last = data[-1]
	parts = (
		(_("Total Open Transactions", context="ToDoBox"), last["total_open"]),
		(_("Avg Late", context="ToDoBox"), format_duration(last["average_late_date"])),
		(_("Max Late Duration", context="ToDoBox"), format_duration(last["maximum_late_date"])),
	)
	return "<div><p>{}</p></div>".format(
		" | ".join(f"<strong>{label}:</strong> <span class='text-success'>{value}</span>" for label, value in parts)
	)


def get_doctype_chart(counts):
	if not counts:
		return None
	return {
		"data": {
			"labels": [_(label) for label in counts],
			"datasets": [{"name": _("Doctype Count", context="ToDoBox"), "values": list(counts.values())}],
		},
		"type": "pie",
	}


def get_employee_chart(data):
	if not data:
		return None
	counts = {row["employee_name"]: row["total_open"] for row in data if row.get("employee_name")}
	return {
		"data": {
			"labels": list(counts),
			"datasets": [{"name": _("Total Open by Employee", context="ToDoBox"), "values": list(counts.values())}],
		},
		"type": "pie",
	}


def get_columns(filters):
	single_employee = filters.get("report_option") == "Me" or filters.get("employee")
	return [
		{
			"fieldname": "employee",
			"label": _("Employee"),
			"fieldtype": "Link",
			"options": "Employee",
			"width": 120,
			"hidden": 1 if single_employee else 0,
		},
		{
			"fieldname": "employee_name",
			"label": _("Employee Name"),
			"fieldtype": "Data",
			"width": 120,
			"hidden": 1 if single_employee else 0,
		},
		{"fieldname": "total_open", "label": _("Total Open", context="ToDoBox"), "fieldtype": "Int", "hidden": 1},
		{"fieldname": "average_late_date", "label": _("Avg Late Date", context="ToDoBox"), "fieldtype": "Duration", "hidden": 1},
		{"fieldname": "maximum_late_date", "label": _("Max", context="ToDoBox"), "fieldtype": "Duration", "hidden": 1},
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
		{"fieldname": "creation", "label": _("Date"), "fieldtype": "Date", "width": 130},
		{"fieldname": "late_date", "label": _("Late Duration", context="ToDoBox"), "fieldtype": "Duration", "width": 150},
		{"fieldname": "late_days", "label": _("Late Days", context="ToDoBox"), "fieldtype": "Int", "width": 150},
	]
