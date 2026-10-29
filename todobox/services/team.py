"""Workload per user, recipient search for the "new task" composer and the user Link query (forward,
recurring tasks) — all limited to the people I can see (see org.py). The pickers also leave out the
people hidden in ToDoBox Settings and, when assignment is restricted to the department, everyone
outside mine."""

import frappe
from frappe.utils import cint, today

from todobox.services.common import generate_color, generate_initials, get_direct_reports
from todobox.services.org import assignable_users, visible_users
from todobox.services.settings import hidden_people


@frappe.whitelist()
def get_workload():
	"""{user: {open, overdue}} over all open ToDos of the users I can see."""
	visible = visible_users()
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
	return {
		r.user: {"open": int(r.open or 0), "overdue": int(r.overdue or 0)}
		for r in rows
		if visible is None or r.user in visible
	}


def _assignable_filters():
	me = frappe.session.user
	hidden = hidden_people() - {me}
	filters = {"enabled": 1, "user_type": "System User", "name": ["not in", ["Guest", me, *hidden]]}
	allowed = assignable_users()
	if allowed is not None:
		# other companies (and departments, when restricted) stay out of the picker
		filters["name"] = ["in", list(allowed - {"Guest", me} - hidden) or [""]]
	return filters


def _only(base, names):
	"""base filters narrowed to the given users."""
	op, listed = base["name"]
	keep = [u for u in names if (u in listed) == (op == "in")]
	return {**base, "name": ["in", keep or [""]]}


def _without(base, names):
	"""base filters minus the given users."""
	op, listed = base["name"]
	if op == "in":
		return {**base, "name": ["in", [u for u in listed if u not in names] or [""]]}
	return {**base, "name": ["not in", list(listed) + list(names)]}


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
			r.name: r for r in frappe.get_all("User", filters=_only(base, picks), fields=fields)
		}
		rows = [by_name[u] for u in picks if u in by_name]
		# only people I actually assign to count as "suggested" (direct reports just pad the list)
		suggested = {u for u in recent if u in by_name}
		if len(rows) < limit:
			rows += frappe.get_all(
				"User",
				# pad with everyone not listed yet (direct reports are in rows but not in `suggested`)
				filters=_without(base, [r.name for r in rows] + list(exclude)),
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


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def user_link_query(doctype, txt, searchfield, start, page_len, filters):
	"""Link-field query for User pickers: active system users I may assign to (not hidden), matched on
	email or name."""
	hidden = hidden_people() - {frappe.session.user}
	conditions = [["enabled", "=", 1], ["user_type", "=", "System User"], ["name", "not in", ["Guest", *hidden]]]
	allowed = assignable_users()
	if allowed is not None:
		conditions.append(["name", "in", list(allowed - hidden) or [""]])
	for key, value in (filters or {}).items():
		conditions.append([key, *value] if isinstance(value, (list, tuple)) else [key, "=", value])
	like = f"%{txt or ''}%"
	return frappe.get_all(
		"User",
		filters=conditions,
		or_filters=[["name", "like", like], ["full_name", "like", like]],
		fields=["name", "full_name"],
		order_by="full_name asc",
		limit_start=cint(start),
		limit_page_length=cint(page_len) or 20,
		as_list=True,
	)
