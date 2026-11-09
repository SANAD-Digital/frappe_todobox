# Copyright (c) 2022, Champion and contributors
# For license information, please see license.txt
import frappe
from frappe import _

from todobox.todobox.report.wf_report_utils import (
	as_filters,
	employee_guard,
	get_employees,
	info_message,
	no_employee_access_message,
)


def execute(filters=None):
	filters = as_filters(filters)
	columns = get_columns()

	guard = employee_guard(filters)
	if guard:
		return columns, [], guard

	if not frappe.db.table_exists("Workflow Trace"):
		return columns, [], info_message(_("Workflow Trace is not available on this site.", context="ToDoBox"))

	try:
		employees = get_employees(filters)
	except frappe.PermissionError:
		return columns, [], no_employee_access_message()

	return columns, get_data(filters, employees)


def get_data(filters, employees):
	conditions = "1=1"
	params = {}
	if filters.get("from_date") and filters.get("to_date"):
		conditions = "DATE(date) BETWEEN %(from_date)s AND %(to_date)s"
		params = {"from_date": filters.from_date, "to_date": filters.to_date}

	traces = frappe.db.sql(
		f"""SELECT user, user_name, parent, parenttype, workflow_state, date, duration_seconds, duration, creation
		FROM `tabWorkflow Trace`
		WHERE {conditions}""",
		params,
		as_dict=True,
	)

	data = []
	for emp in employees:
		for trace in traces:
			if trace.user == emp.user_id:
				data.append({**trace, "employee": emp.name, "employee_name": emp.employee_name})
	return data


def get_columns():
	return [
		{"fieldname": "employee", "label": _("Employee"), "fieldtype": "Link", "options": "Employee", "width": 120},
		{"fieldname": "employee_name", "label": _("Employee Name"), "fieldtype": "Data", "width": 120},
		{"fieldname": "parenttype", "label": _("Transaction Type"), "fieldtype": "Data", "width": 120},
		{"fieldname": "parent", "label": _("Transaction Number", context="ToDoBox"), "fieldtype": "Data", "width": 120},
		{
			"fieldname": "workflow_state",
			"label": _("Workflow State", context="ToDoBox"),
			"fieldtype": "Link",
			"options": "Workflow State",
			"width": 120,
		},
		{"fieldname": "date", "label": _("Date"), "fieldtype": "Date", "width": 120},
		{"fieldname": "duration_seconds", "label": _("Duration"), "fieldtype": "Duration", "width": 120},
		{"fieldname": "creation", "label": _("Creation"), "fieldtype": "Date", "width": 120},
		{"fieldname": "user_name", "label": _("Created By"), "fieldtype": "Data", "width": 120},
	]
