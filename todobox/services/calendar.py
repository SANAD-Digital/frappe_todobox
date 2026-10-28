"""Calendar: the tasks I take part in, by due date, for a date range (one month view)."""

import frappe
from frappe.utils import getdate

from todobox.services.common import derive_subject, todo_has
from todobox.services.query import my_scope, query_values

MAX_ROWS = 1000


@frappe.whitelist()
def get_calendar(start, end):
	"""[{name, subject, date, status, priority, allocated_to, assigned_by}] with a due date in [start, end]
	(cancelled tasks left out)."""
	values = {**query_values(), "start": str(getdate(start)), "end": str(getdate(end))}
	conditions = ["date BETWEEN %(start)s AND %(end)s", "status != 'Cancelled'"]
	my_scope(conditions)
	fields = "name, description, date, status, priority, allocated_to, assigned_by" + (", subject" if todo_has("subject") else "")
	rows = frappe.db.sql(
		f"SELECT {fields} FROM `tabToDo` WHERE {' AND '.join(conditions)} ORDER BY date, (status = 'Open') DESC, modified DESC LIMIT {MAX_ROWS}",
		values,
		as_dict=True,
	)
	return [
		{
			"name": r.name,
			"subject": derive_subject(r),
			"date": str(r.date),
			"status": r.status,
			"priority": r.priority or "Medium",
			"allocated_to": r.allocated_to or "",
			"assigned_by": r.assigned_by or "",
		}
		for r in rows
	]
