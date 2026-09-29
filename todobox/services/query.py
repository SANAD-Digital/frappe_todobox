"""Search syntax (from: to: label: ref: due: is: + free text) and saved views.

Conditions are SQL fragments over `tabToDo` with fixed column names; every user value goes through
named query parameters.
"""

import re

import frappe
from frappe import _
from frappe.utils import add_days, cint, now_datetime, today

from todobox.services.common import SAVED_VIEW_DOCTYPE, loads, todo_has

QUERY_KEYS = ("from", "to", "label", "ref", "due", "is")


def parse_query(q):
	"""Splits a search string into text + key:value filters (same syntax as the UI query builder)."""
	out = {"text": [], "is": []}
	for tok in str(q or "").split():
		key, sep, val = tok.partition(":")
		key = key.lower()
		if sep and val and key in QUERY_KEYS:
			if key == "is":
				out["is"].append(val.lower())
			else:
				out[key] = val
		else:
			out["text"].append(tok)
	out["text"] = " ".join(out["text"])
	return out


def query_values():
	me = frappe.session.user
	return {"me": me, "today": today(), "now": str(now_datetime()), "me_like": f"%{me}%"}


def query_conditions(search, conditions, values):
	"""Appends SQL conditions for a UI search string."""
	p = parse_query(search)

	if p["text"]:
		values["q_text"] = f"%{p['text']}%"
		cols = ["description", "reference_name", "name"] + [c for c in ("subject", "labels") if todo_has(c)]
		conditions.append("(" + " OR ".join(f"`{c}` LIKE %(q_text)s" for c in cols) + ")")
	if p.get("from"):
		values["q_from"] = f"%{p['from']}%"
		conditions.append("assigned_by LIKE %(q_from)s")
	if p.get("to"):
		values["q_to"] = f"%{p['to']}%"
		conditions.append("allocated_to LIKE %(q_to)s")
	if p.get("label"):
		if todo_has("labels"):
			values["q_label"] = f"%{p['label']}%"
			conditions.append("labels LIKE %(q_label)s")
		else:
			conditions.append("1=0")
	if p.get("ref"):
		values["q_ref"] = f"%{p['ref']}%"
		conditions.append("reference_name LIKE %(q_ref)s")

	due = (p.get("due") or "").lower()
	if due:
		m = re.match(r"^([<>])(\d+)d$", due)
		if due == "overdue":
			conditions.append("status = 'Open' AND date < %(today)s")
		elif due == "today":
			conditions.append("date = %(today)s")
		elif re.match(r"^\d{4}-\d{2}-\d{2}$", due):
			values["q_due"] = due
			conditions.append("date = %(q_due)s")
		elif m:
			values["q_due_lim"] = add_days(values["today"], cint(m.group(2)))
			conditions.append("date <= %(q_due_lim)s" if m.group(1) == "<" else "date > %(q_due_lim)s")

	for f in p["is"]:
		if f == "open":
			conditions.append("status = 'Open'")
		elif f == "done":
			conditions.append("status = 'Closed'")
		elif f == "overdue":
			conditions.append("status = 'Open' AND date < %(today)s")
		elif f == "unread":
			if todo_has("read_by"):
				conditions.append("(read_by IS NULL OR read_by NOT LIKE %(me_like)s)")
		elif f == "snoozed":
			conditions.append("snooze_until > %(now)s" if todo_has("snooze_until") else "1=0")
		elif f == "waiting":
			# assigned by me to someone else, and the last message in the thread is mine
			conditions.append(
				"status = 'Open' AND assigned_by = %(me)s AND allocated_to != %(me)s AND COALESCE(("
				"SELECT c.owner FROM `tabComment` c WHERE c.reference_doctype = 'ToDo' "
				"AND c.reference_name = `tabToDo`.name AND c.comment_type = 'Comment' "
				"ORDER BY c.creation DESC LIMIT 1), assigned_by) = %(me)s"
			)


def my_scope(conditions):
	"""ToDos the current user takes part in (assignee, assigner or CC)."""
	if todo_has("cc_users"):
		conditions.append("(allocated_to = %(me)s OR assigned_by = %(me)s OR cc_users LIKE %(me_like)s)")
	else:
		conditions.append("(allocated_to = %(me)s OR assigned_by = %(me)s)")


@frappe.whitelist()
def count_queries(queries):
	"""Counts the current user's ToDos matching each saved-view query -> {key: count}."""
	out = {}
	for key, q in (loads(queries, {}) or {}).items():
		conditions, values = [], query_values()
		my_scope(conditions)
		query_conditions(q, conditions, values)
		out[key] = frappe.db.sql("SELECT COUNT(*) FROM `tabToDo` WHERE " + " AND ".join(conditions), values)[0][0]
	return out


# ------------------------------------------------------------------ saved views
def _view_dict(d):
	return {
		"id": d.name,
		"label": d.view_name,
		"query": d.query or "",
		"sort": d.sort_by or "modified",
		"icon": d.icon or "star",
	}


@frappe.whitelist()
def get_saved_views():
	rows = frappe.get_all(
		SAVED_VIEW_DOCTYPE,
		filters={"user": frappe.session.user},
		fields=["name", "view_name", "query", "sort_by", "icon"],
		order_by="creation asc",
	)
	return [_view_dict(r) for r in rows]


@frappe.whitelist()
def save_view(label, query="", sort="modified", icon="star"):
	label = (label or "").strip()
	if not label:
		frappe.throw(_("Enter a view name"))
	doc = frappe.get_doc(
		{
			"doctype": SAVED_VIEW_DOCTYPE,
			"view_name": label,
			"user": frappe.session.user,
			"query": query or "",
			"sort_by": sort or "modified",
			"icon": icon or "star",
		}
	).insert(ignore_permissions=True)
	return _view_dict(doc)


@frappe.whitelist()
def delete_view(id):
	if frappe.db.get_value(SAVED_VIEW_DOCTYPE, id, "user") != frappe.session.user:
		frappe.throw(_("You cannot delete this view"), frappe.PermissionError)
	frappe.delete_doc(SAVED_VIEW_DOCTYPE, id, ignore_permissions=True)
	return get_saved_views()
