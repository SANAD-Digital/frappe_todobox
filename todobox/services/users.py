"""Active users for avatars and pickers."""

import frappe
from frappe import _
from frappe.utils import today

from todobox.services.common import generate_color, generate_initials, get_direct_reports


@frappe.whitelist()
def get_active_users():
	"""System/website users with initials and avatar colors, plus the current user and their direct reports."""
	me = frappe.session.user
	users = frappe.get_all(
		"User",
		filters={"enabled": 1, "user_type": ["in", ["System User", "Website User"]]},
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

	return {"me": me, "users": out, "today": today(), "my_reports": get_direct_reports(me)}
