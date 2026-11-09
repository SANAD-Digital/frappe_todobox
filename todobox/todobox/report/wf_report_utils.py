"""Shared by the ToDoBox workflow reports: guards for optional apps/fields and the open-action queries."""

from collections import Counter

import frappe
from frappe import _
from frappe.utils import escape_html, now_datetime

EMPLOYEE_FILTERS = ("department", "designation", "branch")


def as_filters(filters):
	return frappe._dict(filters or {})


def info_message(text):
	return f"<div class='text-muted'>{escape_html(text)}</div>"


def employee_guard(filters):
	"""A readable reason this site can't run an Employee based report, or None."""
	if not frappe.db.table_exists("Employee"):
		return info_message(_("This report needs the Employee doctype, which is not available on this site.", context="ToDoBox"))

	for fieldname in EMPLOYEE_FILTERS:
		if not filters.get(fieldname):
			continue
		doctype = fieldname.title()
		if not frappe.db.table_exists(doctype) or not frappe.db.has_column("Employee", fieldname):
			return info_message(_("The {0} filter is not available on this site.", context="ToDoBox").format(_(doctype)))
	return None


def date_guard(filters):
	if not filters.get("from_date") or not filters.get("to_date"):
		return info_message(_("Please set the From and To dates.", context="ToDoBox"))
	return None


def get_employees(filters, base_filters=None):
	"""Employees matching the report filters, respecting the session user's permissions."""
	employee_filters = dict(base_filters or {})
	if filters.get("employee"):
		employee_filters["name"] = filters.employee
	for fieldname in EMPLOYEE_FILTERS:
		if filters.get(fieldname):
			employee_filters[fieldname] = filters.get(fieldname)

	return frappe.get_list(
		"Employee",
		fields=["name", "employee_name", "user_id"],
		filters=employee_filters,
		order_by="name",
	)


def no_employee_access_message():
	return info_message(_("You do not have permission to read Employee records.", context="ToDoBox"))


def as_list(value):
	if not value:
		return []
	if isinstance(value, str):
		parsed = frappe.parse_json(value)
		return parsed if isinstance(parsed, list) else [value]
	return list(value)


def hide_in_report_condition(alias):
	"""States flagged "hide in report"; the flag only exists where the custom field does."""
	if frappe.db.has_column("Workflow State", "todobox_hide_in_report"):
		return f"AND IFNULL({alias}.todobox_hide_in_report, 0) = 0"
	return ""


def get_open_actions(filters, hide_hidden_states=False, distinct_roles=False, join_state_for_roles=False):
	"""Open Workflow Actions in the date range: (rows per permitted user, rows per permitted role)."""
	params = {"from_date": filters.from_date, "to_date": filters.to_date, "now": now_datetime()}

	conditions = ""
	workflow_states = as_list(filters.get("workflow_state"))
	if workflow_states:
		params["workflow_states"] = tuple(workflow_states)
		conditions += " AND ac.workflow_state IN %(workflow_states)s"
	doctypes = as_list(filters.get("docType"))
	if doctypes:
		params["doctypes"] = tuple(doctypes)
		conditions += " AND ac.reference_doctype IN %(doctypes)s"

	common = """ac.reference_name, ac.reference_doctype, ac.workflow_state, ac.creation,
		TIMESTAMPDIFF(SECOND, ac.creation, %(now)s) AS late_date"""
	in_range = "ac.status = 'Open' AND DATE(ac.creation) BETWEEN %(from_date)s AND %(to_date)s"
	state_join = "INNER JOIN `tabWorkflow State` ws ON ac.workflow_state = ws.name"
	hidden = hide_in_report_condition("ws") if hide_hidden_states else ""

	user_rows = []
	if frappe.db.table_exists("Workflow Action Permitted User"):
		user_rows = frappe.db.sql(
			f"""SELECT acr.user, ac.completed_by_role AS role, {common}
			FROM `tabWorkflow Action Permitted User` acr
			INNER JOIN `tabWorkflow Action` ac ON acr.parent = ac.name
			{state_join}
			WHERE {in_range} {hidden} {conditions}""",
			params,
			as_dict=True,
		)

	no_permitted_users = (
		"AND ac.todobox_permitted_users_count = 0"
		if frappe.db.has_column("Workflow Action", "todobox_permitted_users_count")
		else ""
	)
	role_rows = frappe.db.sql(
		f"""SELECT {"DISTINCT" if distinct_roles else ""} acr.parent, acr.role, {common}
		FROM `tabWorkflow Action Permitted Role` acr
		INNER JOIN `tabWorkflow Action` ac ON acr.parent = ac.name
		{state_join if join_state_for_roles else ""}
		WHERE {in_range} {no_permitted_users} {hidden if join_state_for_roles else ""} {conditions}""",
		params,
		as_dict=True,
	)
	return user_rows, role_rows


def delay_text(seconds):
	seconds = int(seconds or 0)
	return f"{seconds // 86400}d {seconds % 86400 // 3600}h {seconds % 3600 // 60}m {seconds % 60}s"


def join_employee_actions(employees, user_rows, role_rows):
	"""One row per open action per employee who may act on it, with that employee's totals."""
	joined = []
	for emp in employees:
		user_id = emp.get("user_id")
		if not user_id:
			continue

		roles = frappe.get_roles(user_id)
		rows = [r for r in user_rows if r.user == user_id] + [r for r in role_rows if r.role in roles]
		if not rows:
			continue

		total_open = len(rows)
		late_sum = sum(r.late_date for r in rows)
		maximum_late = max(r.late_date for r in rows)

		for r in rows:
			joined.append(
				{
					"user": user_id,
					"employee": emp.name,
					"employee_name": emp.employee_name,
					"role": r.role,
					"reference_doctype": r.reference_doctype,
					"reference_type": _(r.reference_doctype),
					"reference_name": r.reference_name,
					"workflow_state": r.workflow_state,
					"creation": r.creation,
					"late_date": r.late_date,
					"late_days": r.late_date // 86400,
					"total_open": total_open,
					"average_late_date": late_sum / total_open,
					"maximum_late_date": maximum_late,
					"delay_duration": delay_text(r.late_date),
				}
			)
	return joined


def doctype_counts(rows, employee):
	if not employee:
		return Counter()
	return Counter(row["reference_doctype"] for row in rows if row["employee"] == employee)


def format_duration(seconds):
	seconds = int(seconds or 0)
	parts = []
	for size, unit in ((86400, _("d", context="ToDoBox")), (3600, _("h")), (60, _("m", context="ToDoBox"))):
		value, seconds = divmod(seconds, size)
		if value:
			parts.append(f"{value} {unit}")
	if seconds or not parts:
		parts.append(f"{seconds} {_('s')}")
	return " ".join(parts)
