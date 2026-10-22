"""Active users for avatars and pickers."""

import frappe
from frappe import _
from frappe.utils import today

from todobox.services.common import generate_color, generate_initials
from todobox.services.org import visible_users


def _my_task_people(me):
	"""Assigners/assignees of my own tasks: known to me even outside my company."""
	rows = frappe.db.sql(
		"""SELECT DISTINCT allocated_to, assigned_by FROM `tabToDo`
		WHERE allocated_to = %(me)s OR assigned_by = %(me)s""",
		{"me": me},
	)
	return {u for row in rows for u in row if u}


@frappe.whitelist()
def get_active_users():
	"""System/website users I can see (my companies, see org.py) with initials and avatar colors, plus
	the current user."""
	me = frappe.session.user
	filters = {"enabled": 1, "user_type": ["in", ["System User", "Website User"]]}
	visible = visible_users()
	if visible is not None:
		filters["name"] = ["in", list(visible | _my_task_people(me))]
	users = frappe.get_all(
		"User",
		filters=filters,
		fields=["name", "full_name", "user_image"],
		limit=0,
	)

	out = {}
	for u in users:
		full_name = u.full_name or u.name
		out[u.name] = {
			"name": full_name,
			"title": _("System User") if u.name != "Administrator" else _("System Administrator"),
			"initials": generate_initials(full_name),
			"color": generate_color(u.name),
			"user_image": u.user_image,
		}

	if me not in out:
		out[me] = {
			"name": me,
			"title": _("Current User"),
			"initials": generate_initials(me),
			"color": generate_color(me),
			"user_image": None,
		}

	return {"me": me, "users": out, "today": today()}
