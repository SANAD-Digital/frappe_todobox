"""Analytics dashboard: real numbers for a user-selected period.

Principles:
- Individuals are compared with themselves (previous period of equal length), not with colleagues.
- Team ranking and member comparison are shown only to team leads (users with direct reports, or System Manager).
- Every number is explainable: completed = closed within the period (completed_on); on-time = completed on or before the due date.
"""

from statistics import median

import frappe
from frappe import _
from frappe.utils import add_days, date_diff, get_datetime, getdate, now_datetime, today

from todobox.services.common import derive_subject, get_direct_reports, is_system_manager

STALE_DAYS = 3
PRIORITIES = ("High", "Medium", "Low")


# ------------------------------------------------------------------ hooks
def stamp_completed_on(doc, method=None):
	"""ToDo validate: set completion time on close and clear it on reopen."""
	if not frappe.get_meta("ToDo").has_field("completed_on"):
		return
	if doc.status == "Closed":
		if not doc.get("completed_on"):
			doc.completed_on = now_datetime()
	elif doc.get("completed_on"):
		doc.completed_on = None


# ------------------------------------------------------------------ scope
def _team_of(user):
	"""My team: users reporting to me directly or indirectly (Employee.reports_to); all users for System Manager."""
	if is_system_manager(user):
		return frappe.get_all(
			"User", filters={"enabled": 1, "user_type": "System User", "name": ["not in", ["Guest"]]}, pluck="name"
		)
	seen, queue = set(), [user]
	while queue and len(seen) < 500:
		for u in get_direct_reports(queue.pop()):
			if u not in seen and u != user:
				seen.add(u)
				queue.append(u)
	return sorted(seen)


def _resolve_period(period, date_from, date_to):
	t = getdate(today())
	if period == "custom" and date_from and date_to:
		start, end = getdate(date_from), getdate(date_to)
		if start > end:
			start, end = end, start
	elif period == "7d":
		start, end = add_days(t, -6), t
	elif period == "90d":
		start, end = add_days(t, -89), t
	elif period == "month":
		start, end = t.replace(day=1), t
	elif period == "quarter":
		start, end = t.replace(month=((t.month - 1) // 3) * 3 + 1, day=1), t
	elif period == "year":
		start, end = t.replace(month=1, day=1), t
	else:
		start, end = add_days(t, -29), t
	days = date_diff(end, start) + 1
	return getdate(start), getdate(end), getdate(add_days(start, -days)), getdate(add_days(start, -1)), days


# ------------------------------------------------------------------ data
def _fetch(users, start, end):
	"""Tasks completed and created in [start, end], plus currently open ones, for a set of users."""
	if not users:
		return [], [], []
	closed = frappe.db.sql(
		"""
		SELECT name, allocated_to, priority, date, creation, completed_on
		FROM `tabToDo`
		WHERE status = 'Closed' AND allocated_to IN %(users)s
			AND completed_on >= %(start)s AND completed_on < %(end)s
		""",
		{"users": users, "start": start, "end": add_days(end, 1)},
		as_dict=True,
	)
	created = frappe.db.sql(
		"""
		SELECT allocated_to, creation FROM `tabToDo`
		WHERE allocated_to IN %(users)s AND status != 'Cancelled'
			AND creation >= %(start)s AND creation < %(end)s
		""",
		{"users": users, "start": start, "end": add_days(end, 1)},
		as_dict=True,
	)
	open_rows = frappe.db.sql(
		"""
		SELECT name, allocated_to, priority, date, creation, modified FROM `tabToDo`
		WHERE status = 'Open' AND allocated_to IN %(users)s
		""",
		{"users": users},
		as_dict=True,
	)
	return closed, created, open_rows


def _cycle_days(r):
	return max(0.0, (get_datetime(r.completed_on) - get_datetime(r.creation)).total_seconds() / 86400)


def _on_time(rows):
	"""Share of tasks with a due date completed on time; None if there are none."""
	due = [r for r in rows if r.date]
	if not due:
		return None
	ok = sum(1 for r in due if getdate(r.completed_on) <= getdate(r.date))
	return round(ok * 100 / len(due))


def _med(values):
	return round(median(values), 1) if values else None


def _summary(closed, created, open_rows):
	t = getdate(today())
	overdue = [r for r in open_rows if r.date and getdate(r.date) < t]
	return {
		"completed": len(closed),
		"created": len(created),
		"on_time": _on_time(closed),
		"cycle": _med([_cycle_days(r) for r in closed]),
		"open": len(open_rows),
		"overdue": len(overdue),
		"oldest_overdue": max((date_diff(t, r.date) for r in overdue), default=0),
	}


def _weekend_days():
	"""Weekly off days (0=Monday) from the default company holiday list; otherwise Friday and Saturday."""
	# Company/Holiday List exist only with ERPNext; check first, because frappe.throw
	# queues a message for the client even when the exception is caught
	if not frappe.db.exists("DocType", "Company") or not frappe.db.exists("DocType", "Holiday List"):
		return {4, 5}
	company = frappe.defaults.get_user_default("Company") or frappe.db.get_default("company")
	hl = company and frappe.db.get_value("Company", company, "default_holiday_list")
	if hl:
		offs = frappe.get_all("Holiday", filters={"parent": hl, "weekly_off": 1}, pluck="holiday_date", limit=60)
		days = {getdate(d).weekday() for d in offs}
		if days:
			return days
	return {4, 5}


def _streak(user):
	"""Consecutive working days (up to today) with at least one completed task; weekly off days don't break the streak."""
	days = set(
		getdate(d)
		for d in frappe.db.sql_list(
			"""SELECT DATE(completed_on) FROM `tabToDo`
			WHERE status = 'Closed' AND allocated_to = %s AND completed_on >= %s""",
			(user, add_days(today(), -120)),
		)
	)
	weekend, d, n = _weekend_days(), getdate(today()), 0
	if d not in days:  # today isn't over yet; doesn't break the streak
		d = add_days(d, -1)
	for _i in range(120):
		d = getdate(d)
		if d in days:
			n += 1
		elif d.weekday() not in weekend:
			break
		d = add_days(d, -1)
	return n


def _buckets(start, end, days):
	"""Split the period into trend buckets: daily up to 31 days, weekly up to 120, otherwise monthly."""
	out, cur = [], getdate(start)
	if days <= 31:
		while cur <= end:
			out.append((cur, cur, frappe.utils.formatdate(cur, "dd/MM")))
			cur = getdate(add_days(cur, 1))
	elif days <= 120:
		while cur <= end:
			last = min(getdate(add_days(cur, 6)), end)
			out.append((cur, last, frappe.utils.formatdate(cur, "dd/MM")))
			cur = getdate(add_days(last, 1))
	else:
		while cur <= end:
			nxt = getdate(frappe.utils.add_months(cur.replace(day=1), 1))
			last = min(getdate(add_days(nxt, -1)), end)
			out.append((cur, last, frappe.utils.formatdate(cur, "MM/yyyy")))
			cur = nxt
	return out


def _trend(closed, created, start, end, days):
	out = []
	for a, b, label in _buckets(start, end, days):
		done = sum(1 for r in closed if a <= getdate(r.completed_on) <= b)
		new = sum(1 for r in created if a <= getdate(r.creation) <= b)
		out.append({"label": label, "from": str(a), "to": str(b), "done": done, "created": new})
	return out


def _aging(open_rows):
	t = getdate(today())
	spec = [(0, 3, _("Up to 3 days")), (4, 7, _("4 to 7 days")), (8, 14, _("8 to 14 days")), (15, 10**6, _("15 days or more"))]
	out = []
	for lo, hi, label in spec:
		rows = [r for r in open_rows if lo <= date_diff(t, r.creation) <= hi]
		out.append({"label": label, "count": len(rows), "overdue": sum(1 for r in rows if r.date and getdate(r.date) < t)})
	return out


def _by_priority(closed, open_rows):
	return [
		{
			"priority": p,
			"done": sum(1 for r in closed if (r.priority or "Medium") == p),
			"open": sum(1 for r in open_rows if (r.priority or "Medium") == p),
			"cycle": _med([_cycle_days(r) for r in closed if (r.priority or "Medium") == p]),
		}
		for p in PRIORITIES
	]


def _waiting_on_others(me):
	"""Open tasks I assigned to others, including stale ones (untouched for STALE_DAYS days)."""
	rows = frappe.db.sql(
		"""
		SELECT name, allocated_to, description, modified, date FROM `tabToDo`
		WHERE status = 'Open' AND assigned_by = %(me)s AND allocated_to != %(me)s AND IFNULL(allocated_to, '') != ''
		ORDER BY modified ASC
		""",
		{"me": me},
		as_dict=True,
	)
	t = getdate(today())
	stale = [r for r in rows if date_diff(t, r.modified) >= STALE_DAYS]
	return {
		"count": len(rows),
		"stale": len(stale),
		"items": [
			{"name": r.name, "subject": derive_subject(r), "user": r.allocated_to, "days": date_diff(t, r.modified)}
			for r in stale[:6]
		],
	}


def _pct_change(cur, prev):
	if not prev:
		return None
	return round((cur - prev) * 100 / prev)


# ------------------------------------------------------------------ insights
def _personal_insights(cur, prev, streak, best):
	out = []
	delta = _pct_change(cur["completed"], prev["completed"])
	if cur["completed"] and delta is not None and delta > 0:
		out.append({"tone": "green", "icon": "chart", "text": _("You completed {0} tasks — {1}% more than the previous period. Great momentum!").format(cur["completed"], delta)})
	elif cur["completed"] and prev["completed"] == 0:
		out.append({"tone": "green", "icon": "chart", "text": _("You completed {0} tasks in this period. Keep it up!").format(cur["completed"])})
	elif delta is not None and delta < 0:
		out.append({"tone": "fg2", "icon": "sunrise", "text": _("{0} tasks completed versus {1} in the previous period — planning your day can help you get back on pace.").format(cur["completed"], prev["completed"])})
	if cur["on_time"] is not None and cur["on_time"] >= 90 and cur["completed"] >= 3:
		out.append({"tone": "green", "icon": "check-circle", "text": _("Excellent reliability: {0}% of your tasks were done on or before their due date.").format(cur["on_time"])})
	if streak >= 3:
		out.append({"tone": "primary", "icon": "zap", "text": _("{0} working days in a row with at least one completed task — keep the streak going!").format(streak)})
	if best and best["done"] >= 3:
		out.append({"tone": "primary", "icon": "star", "text": _("Your best day in this period: {0} with {1} completed tasks.").format(best["label"], best["done"])})
	if cur["overdue"]:
		out.append({"tone": "red", "icon": "alert", "action": "overdue", "text": _("{0} of your open tasks are overdue (the oldest by {1} days). Start with them or update their due dates.").format(cur["overdue"], cur["oldest_overdue"])})
	if cur["created"] > cur["completed"] * 1.3 and cur["created"] - cur["completed"] >= 3:
		out.append({"tone": "amber", "icon": "inbox", "text": _("You received {0} tasks and completed {1} — your backlog is growing.").format(cur["created"], cur["completed"])})
	return out


def _team_insights(rows, cur, prev, names):
	out = []
	active = [r for r in rows if r["completed"] or r["open"]]
	if not active:
		return out
	stars = sorted([r for r in active if r["completed"] >= 3 and (r["on_time"] or 0) >= 80 and not (r["overdue"] >= 3 and r["overdue"] * 2 >= r["open"])], key=lambda r: (-r["completed"], -(r["on_time"] or 0)))
	if stars:
		s = stars[0]
		out.append({"tone": "green", "icon": "star", "text": _("Recognition: {0} completed {1} tasks with {2}% on time. A word of thanks goes a long way.").format(names[s["user"]], s["completed"], s["on_time"])})
	opens = sorted(r["open"] for r in active)
	med_open = median(opens) if opens else 0
	lightest = min(active, key=lambda r: (r["open"], r["overdue"]))
	for r in sorted(active, key=lambda r: -r["open"]):
		if r["open"] >= max(6, med_open * 1.6) and r["user"] != lightest["user"]:
			out.append({"tone": "amber", "icon": "users", "user": r["user"], "text": _("{0} has {1} open tasks (team median {2}). Consider reassigning some to {3} ({4} open).").format(names[r["user"]], r["open"], round(med_open), names[lightest["user"]], lightest["open"])})
			break
	for r in sorted(active, key=lambda r: -r["overdue"]):
		if r["overdue"] >= 3 and r["overdue"] * 2 >= r["open"]:
			out.append({"tone": "red", "icon": "alert", "user": r["user"], "text": _("{0}: {1} of {2} open tasks are overdue (oldest by {3} days). A quick check-in may help clear blockers.").format(names[r["user"]], r["overdue"], r["open"], r["oldest_overdue"])})
			break
	if cur["created"] > cur["completed"] * 1.3 and cur["created"] - cur["completed"] >= 5:
		out.append({"tone": "amber", "icon": "inbox", "text": _("The team received {0} tasks and completed {1} in this period — incoming work exceeds capacity.").format(cur["created"], cur["completed"])})
	delta = _pct_change(cur["completed"], prev["completed"])
	if delta is not None and delta >= 10:
		out.append({"tone": "green", "icon": "chart", "text": _("Team output is up {0}% compared to the previous period.").format(delta)})
	return out


# ------------------------------------------------------------------ endpoint
@frappe.whitelist()
def get_analytics(period="30d", date_from=None, date_to=None, scope="me", user=None):
	me = frappe.session.user
	team = _team_of(me)
	can_team = bool(team)
	start, end, pstart, pend, days = _resolve_period(period, date_from, date_to)

	if scope == "member" and user and (user == me or user in team):
		users, subject = [user], user
	elif scope == "team" and can_team:
		users, subject = list(dict.fromkeys([me] + team)), None
	else:
		scope, users, subject = "me", [me], me

	closed, created, open_rows = _fetch(users, start, end)
	pclosed, pcreated, _open = _fetch(users, pstart, pend)
	cur = _summary(closed, created, open_rows)
	prev = _summary(pclosed, pcreated, [])
	trend = _trend(closed, created, start, end, days)
	best = max(trend, key=lambda b: b["done"]) if trend and days <= 31 else None

	names = {u: frappe.utils.get_fullname(u) for u in users}
	out = {
		"period": {"key": period, "from": str(start), "to": str(end), "prev_from": str(pstart), "prev_to": str(pend), "days": days},
		"scope": scope,
		"user": subject,
		"user_name": names.get(subject) if subject else "",
		"can_team": can_team,
		"team_size": len(team),
		"kpis": {"cur": cur, "prev": prev},
		"trend": trend,
		"granularity": "day" if days <= 31 else "week" if days <= 120 else "month",
		"by_priority": _by_priority(closed, open_rows),
		"aging": _aging(open_rows),
		"streak": _streak(subject) if subject else None,
	}

	if scope == "team":
		rows = []
		for u in users:
			c = [r for r in closed if r.allocated_to == u]
			o = [r for r in open_rows if r.allocated_to == u]
			s = _summary(c, [r for r in created if r.allocated_to == u], o)
			if not (s["completed"] or s["open"] or s["created"]):
				continue
			rows.append({"user": u, "name": names[u], **s})
		rows.sort(key=lambda r: (-r["completed"], r["overdue"]))
		out["team"] = rows
		out["insights"] = _team_insights(rows, cur, prev, names)
	else:
		out["insights"] = _personal_insights(cur, prev, out["streak"] or 0, best) if subject == me else _team_insights(
			[{"user": subject, "name": names[subject], **cur}], cur, prev, names
		)

	if subject == me or scope == "team":
		out["waiting"] = _waiting_on_others(me)
	return out
