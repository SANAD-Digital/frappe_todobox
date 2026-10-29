"""Active users for avatars and pickers."""

import frappe
from frappe import _
from frappe.utils import today

from todobox.services.common import generate_color, generate_initials, is_system_manager, split_csv, todo_has
from todobox.services.org import visible_users
from todobox.services.settings import hidden_people


def _my_task_people(me):
	"""Assigners/assignees of my own tasks: known to me even outside my company."""
	rows = frappe.db.sql(
		"""SELECT DISTINCT allocated_to, assigned_by FROM `tabToDo`
		WHERE allocated_to = %(me)s OR assigned_by = %(me)s""",
		{"me": me},
	)
	return {u for row in rows for u in row if u}


def _hidden_in_my_tasks(me, hidden):
	"""The hidden people taking part (assignee, assigner, CC) in tasks I take part in: their avatars must
	still resolve."""
	if not hidden:
		return set()
	cc = todo_has("cc_users")
	rows = frappe.db.sql(
		f"""SELECT DISTINCT allocated_to, assigned_by{", cc_users" if cc else ""} FROM `tabToDo`
		WHERE (allocated_to = %(me)s OR assigned_by = %(me)s{" OR cc_users LIKE %(me_like)s" if cc else ""})
		AND (allocated_to IN %(hidden)s OR assigned_by IN %(hidden)s{" OR IFNULL(cc_users, '') != ''" if cc else ""})""",
		{"me": me, "me_like": f"%{me}%", "hidden": list(hidden)},
	)
	people = {u for row in rows for u in row[:2] if u}
	if cc:
		people.update(u for row in rows for u in split_csv(row[2]))
	return people & hidden


@frappe.whitelist()
def get_active_users():
	"""System/website users I can see (my companies, see org.py) with initials and avatar colors, plus
	the current user. The people hidden in ToDoBox Settings are left out unless they take part in my
	tasks. is_settings_admin: I may change ToDoBox Settings (System Manager)."""
	me = frappe.session.user
	filters = {"enabled": 1, "user_type": ["in", ["System User", "Website User"]]}
	visible = visible_users()
	if visible is not None:
		filters["name"] = ["in", list(visible | _my_task_people(me))]
	hidden = hidden_people() - {me}
	hidden -= _hidden_in_my_tasks(me, hidden)
	if hidden:
		filters["name"] = (
			["in", [u for u in filters["name"][1] if u not in hidden] or [""]]
			if "name" in filters
			else ["not in", list(hidden)]
		)
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

	return {"me": me, "users": out, "today": today(), "is_settings_admin": 1 if is_system_manager(me) else 0}
