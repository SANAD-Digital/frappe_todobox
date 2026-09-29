"""Workload per user and recipient search for the "new task" composer."""

import frappe
from frappe.utils import cint, today

from todobox.services.common import generate_color, generate_initials, get_direct_reports


@frappe.whitelist()
def get_workload():
	"""{user: {open, overdue}} over all open ToDos."""
	rows = frappe.db.sql(
		"""
		SELECT allocated_to AS user,
			COUNT(*) AS open,
			SUM(CASE WHEN date < %(today)s THEN 1 ELSE 0 END) AS overdue
		FROM `tabToDo`
		WHERE status = 'Open' AND IFNULL(allocated_to, '') != ''
		GROUP BY allocated_to
		""",
		{"today": today()},
		as_dict=True,
	)
	return {r.user: {"open": int(r.open or 0), "overdue": int(r.overdue or 0)} for r in rows}


def _assignable_filters():
	return {"enabled": 1, "user_type": "System User", "name": ["not in", ["Guest", frappe.session.user]]}


def _recent_recipients(limit=8):
	"""Users I have assigned the most tasks to, most frequent first (latest breaks ties)."""
	return frappe.db.sql_list(
		"""
		SELECT allocated_to FROM `tabToDo`
		WHERE assigned_by = %(me)s AND allocated_to != %(me)s AND IFNULL(allocated_to, '') != ''
		GROUP BY allocated_to ORDER BY COUNT(*) DESC, MAX(creation) DESC LIMIT %(limit)s
		""",
		{"me": frappe.session.user, "limit": cint(limit)},
	)


@frappe.whitelist()
def search_users(txt="", limit=20, exclude=None):
	"""Recipient search. Without text: suggestions (recent recipients, then direct reports), padded
	with other users; with text: name/email match. Each user carries their workload."""
	limit = min(max(cint(limit) or 20, 1), 50)
	exclude = set(frappe.parse_json(exclude) or []) if exclude else set()
	txt = (txt or "").strip()
	base = _assignable_filters()
	fields = ["name", "full_name", "user_image"]

	if txt:
		like = f"%{txt}%"
		rows = frappe.get_all(
			"User",
			filters=base,
			or_filters={"full_name": ["like", like], "name": ["like", like]},
			fields=fields,
			order_by="full_name asc",
			limit=limit + len(exclude),
		)
		suggested = set()
	else:
		recent = _recent_recipients()
		picks = [u for u in recent + get_direct_reports(frappe.session.user) if u not in exclude]
		picks = list(dict.fromkeys(picks))
		by_name = {
			r.name: r for r in frappe.get_all("User", filters={**base, "name": ["in", picks or [""]]}, fields=fields)
		}
		rows = [by_name[u] for u in picks if u in by_name]
		# only people I actually assign to count as "suggested" (direct reports just pad the list)
		suggested = {u for u in recent if u in by_name}
		if len(rows) < limit:
			rows += frappe.get_all(
				"User",
				# pad with everyone not listed yet (direct reports are in rows but not in `suggested`)
				filters={**base, "name": ["not in", list(base["name"][1]) + [r.name for r in rows] + list(exclude)]},
				fields=fields,
				order_by="full_name asc",
				limit=limit - len(rows),
			)

	rows = [r for r in rows if r.name not in exclude][:limit]
	load = get_workload()
	return [
		{
			"id": r.name,
			"name": r.full_name or r.name,
			"initials": generate_initials(r.full_name or r.name),
			"color": generate_color(r.name),
			"user_image": r.user_image,
			"open": load.get(r.name, {}).get("open", 0),
			"overdue": load.get(r.name, {}).get("overdue", 0),
			"suggested": r.name in suggested,
		}
		for r in rows
	]
