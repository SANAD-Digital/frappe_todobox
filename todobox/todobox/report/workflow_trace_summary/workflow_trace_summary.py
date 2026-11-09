# Copyright (c) 2023, ToDoBox contributors
# For license information, please see license.txt
import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, today

from todobox.todobox.report.wf_report_utils import (
	as_filters,
	employee_guard,
	get_employees,
	hide_in_report_condition,
	info_message,
	no_employee_access_message,
)


def execute(filters=None):
	filters = as_filters(filters)
	columns = get_columns(filters)

	guard = employee_guard(filters)
	if guard:
		return columns, [], guard

	try:
		employees = get_employees(filters)
	except frappe.PermissionError:
		return columns, [], no_employee_access_message()

	data = get_data(filters, employees)
	if not frappe.db.table_exists("Workflow Trace"):
		return columns, data, info_message(_("Workflow Trace is not available on this site, so Completed stays 0.", context="ToDoBox"))
	return columns, data


def get_columns(filters):
	columns = [
		{"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 300},
		{"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 150},
		{"label": _("User ID"), "fieldname": "user_id", "fieldtype": "Link", "options": "User", "width": 100, "hidden": 1},
		{"label": _("Completed"), "fieldname": "trace_count", "fieldtype": "Int", "width": 100},
		{
			"label": _("Completed Average Duration", context="ToDoBox"),
			"fieldname": "completed_avg_duration",
			"fieldtype": "Duration",
			"width": 150,
		},
	]
	if cint(filters.get("show_open")):
		columns += [
			{"label": _("Open"), "fieldname": "open_workflow_count", "fieldtype": "Int", "width": 100},
			{"label": _("Open Average Duration", context="ToDoBox"), "fieldname": "open_avg_duration", "fieldtype": "Duration", "width": 150},
			{"label": _("Total"), "fieldname": "total", "fieldtype": "Int", "width": 100},
		]
	return columns


def get_trace_counts(filters):
	if not frappe.db.table_exists("Workflow Trace"):
		return {}

	params = {}
	condition = ""
	if cint(filters.get("today_completed")):
		condition = "AND DATE(WT.date) = %(today)s"
		params["today"] = today()
	elif filters.get("from_date") and filters.get("to_date"):
		condition = "AND DATE(WT.date) BETWEEN %(from_date)s AND %(to_date)s"
		params.update(from_date=filters.from_date, to_date=filters.to_date)

	rows = frappe.db.sql(
		f"""SELECT WT.user, COUNT(*) AS trace_count, AVG(WT.duration_seconds) AS completed_avg_duration
		FROM `tabWorkflow Trace` WT
		INNER JOIN `tabWorkflow State` WS ON WS.name = WT.workflow_state
		WHERE 1=1 {condition} {hide_in_report_condition("WS")}
		GROUP BY WT.user""",
		params,
		as_dict=True,
	)
	return {row.user: row for row in rows}


def get_open_totals(filters):
	"""Open count and summed lateness, keyed by role and by user."""
	params = {"now": now_datetime()}
	in_range = ""
	if filters.get("from_date") and filters.get("to_date"):
		in_range = "AND DATE(ac.creation) BETWEEN %(from_date)s AND %(to_date)s"
		params.update(from_date=filters.from_date, to_date=filters.to_date)

	totals = """COUNT(*) AS open_count, SUM(TIMESTAMPDIFF(SECOND, ac.creation, %(now)s)) AS total_late_date"""
	no_permitted_users = (
		"AND ac.todobox_permitted_users_count = 0"
		if frappe.db.has_column("Workflow Action", "todobox_permitted_users_count")
		else ""
	)

	by_role = frappe.db.sql(
		f"""SELECT acr.role, {totals}
		FROM `tabWorkflow Action Permitted Role` acr
		INNER JOIN `tabWorkflow Action` ac ON acr.parent = ac.name
		WHERE ac.status = 'Open' {in_range} {no_permitted_users}
		GROUP BY acr.role""",
		params,
		as_dict=True,
	)

	by_user = []
	if frappe.db.table_exists("Workflow Action Permitted User"):
		by_user = frappe.db.sql(
			f"""SELECT acu.user, {totals}
			FROM `tabWorkflow Action Permitted User` acu
			INNER JOIN `tabWorkflow Action` ac ON acu.parent = ac.name
			WHERE ac.status = 'Open' {in_range}
			GROUP BY acu.user""",
			params,
			as_dict=True,
		)

	return {row.role: row for row in by_role}, {row.user: row for row in by_user}


def get_data(filters, employees):
	traces = get_trace_counts(filters)
	role_totals, user_totals = get_open_totals(filters)

	data = []
	for emp in employees:
		user_id = emp.get("user_id")
		if not user_id:
			continue

		sources = [role_totals[role] for role in frappe.get_roles(user_id) if role in role_totals]
		if user_id in user_totals:
			sources.append(user_totals[user_id])
		open_count = sum(cint(row.open_count) for row in sources)
		late_total = sum(flt(row.total_late_date) for row in sources)

		trace = traces.get(user_id) or {}
		trace_count = cint(trace.get("trace_count"))
		data.append(
			{
				"employee": emp.name,
				"employee_name": emp.employee_name,
				"user_id": user_id,
				"trace_count": trace_count,
				"completed_avg_duration": flt(trace.get("completed_avg_duration")),
				"open_workflow_count": open_count,
				"open_avg_duration": late_total / open_count if open_count else 0,
				"total": trace_count + open_count,
			}
		)
	return data
