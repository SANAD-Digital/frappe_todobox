"""Day plan: my open tasks that are overdue or due today, in an order the user keeps."""

import frappe
from frappe.utils import cint, get_datetime, now_datetime, today

from todobox.services.checklist import get_checklists
from todobox.services.common import derive_subject

PRIORITY_RANK = {"High": 0, "Medium": 1, "Low": 2}


def _drop_key(user=None):
	return f"todobox:day_drop:{user or frappe.session.user}:{today()}"


def _dropped():
	return set(frappe.cache.get_value(_drop_key()) or [])


def _plan_rows():
	meta = frappe.get_meta("ToDo")
	fields = ["name", "description", "priority", "date", "assigned_by", "reference_type", "reference_name"]
	fields += [f for f in ("day_order", "snooze_until", "subject", "gcrm_subject") if meta.has_field(f)]
	rows = frappe.get_all(
		"ToDo",
		filters={"allocated_to": frappe.session.user, "status": "Open", "date": ["<=", today()]},
		fields=fields,
	)
	now, dropped = now_datetime(), _dropped()
	rows = [
		r
		for r in rows
		if r.name not in dropped and not (r.get("snooze_until") and get_datetime(r.snooze_until) > now)
	]
	td = today()

	def key(r):
		order = cint(r.get("day_order"))
		return (0 if order > 0 else 1, order, 0 if str(r.date) < td else 1, PRIORITY_RANK.get(r.priority, 1), str(r.date))

	rows.sort(key=key)
	return rows


@frappe.whitelist()
def get_day_plan():
	rows = _plan_rows()
	checklists = get_checklists([r.name for r in rows])
	return [
		{
			"name": r.name,
			"subject": derive_subject(r),
			"priority": r.priority or "Medium",
			"date": str(r.date) if r.date else "",
			"assigned_by": r.assigned_by or "",
			"reference_type": r.reference_type or "",
			"reference_name": r.reference_name or "",
			"day_order": cint(r.get("day_order")),
			"custom_checklist": checklists.get(r.name, []),
		}
		for r in rows
	]


@frappe.whitelist()
def reorder_day(name, direction):
	"""Moves a task one step up/down and stores the whole plan order in day_order."""
	names = [r.name for r in _plan_rows()]
	if name not in names or not frappe.get_meta("ToDo").has_field("day_order"):
		return get_day_plan()
	i = names.index(name)
	j = i + (1 if cint(direction) > 0 else -1)
	if 0 <= j < len(names):
		names[i], names[j] = names[j], names[i]
		for pos, n in enumerate(names, start=1):
			frappe.db.set_value("ToDo", n, "day_order", pos, update_modified=False)
	return get_day_plan()


@frappe.whitelist()
def drop_from_day(name):
	"""Hides a task from today's plan only; it comes back in tomorrow's plan."""
	if name in {r.name for r in _plan_rows()}:
		frappe.cache.set_value(_drop_key(), list(_dropped() | {name}), expires_in_sec=36 * 3600)
	return get_day_plan()
