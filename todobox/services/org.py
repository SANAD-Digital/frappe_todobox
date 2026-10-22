"""Company privacy for multi-company sites (ERPNext/HRMS Company, Department, Employee).

Active only when the Employee DocType exists; without ERPNext every user sees everyone, as before.
A user belongs to the companies of their active Employee records (Employee.user_id) and sees, picks
and assigns only people in those companies; a user without an active employee record sees only
themselves. System Manager (and Administrator) work across companies. Analytics: a manager sees
the people reporting to them (Employee.reports_to, same company), a ToDoBox Company Manager sees
their whole company.
"""

import frappe
from frappe import _

from todobox.services.common import is_system_manager

COMPANY_MANAGER_ROLE = "ToDoBox Company Manager"


def enabled():
	return bool(frappe.db.exists("DocType", "Employee"))


def is_unrestricted(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or is_system_manager(user)


def companies_of(user=None):
	user = user or frappe.session.user
	return frappe.get_all(
		"Employee", filters={"user_id": user, "status": "Active"}, pluck="company", distinct=True
	)


def visible_users(user=None):
	"""The users this user may see and assign to (themselves included), or None for no limit.
	Cached for the request."""
	user = user or frappe.session.user
	cache = frappe.local.flags.setdefault("todobox_visible_users", {})
	if user not in cache:
		if not enabled() or is_unrestricted(user):
			cache[user] = None
		else:
			companies = [c for c in companies_of(user) if c]
			members = (
				frappe.get_all(
					"Employee",
					filters={"company": ["in", companies], "status": "Active", "user_id": ["is", "set"]},
					pluck="user_id",
				)
				if companies
				else []
			)
			cache[user] = {*members, user}
	return cache[user]


def can_see(other, user=None):
	visible = visible_users(user)
	return visible is None or other in visible


def restrict(users, user=None):
	"""The given users this user may see, in order."""
	visible = visible_users(user)
	return list(users) if visible is None else [u for u in users if u in visible]


def ensure_assignable(users, user=None):
	"""Raises PermissionError when any of the users is outside this user's companies."""
	if any(u and not can_see(u, user) for u in users):
		frappe.throw(_("You can only assign tasks to people in your company"), frappe.PermissionError)


def company_members(user=None):
	"""Everyone in this user's companies (themselves excluded) when they are a ToDoBox Company
	Manager, else an empty list."""
	user = user or frappe.session.user
	if not enabled() or COMPANY_MANAGER_ROLE not in frappe.get_roles(user):
		return []
	visible = visible_users(user)
	if visible is None:
		return []
	return sorted(visible - {user})


def setup_roles():
	if not frappe.db.exists("Role", COMPANY_MANAGER_ROLE):
		frappe.get_doc({"doctype": "Role", "role_name": COMPANY_MANAGER_ROLE, "desk_access": 1}).insert(
			ignore_permissions=True
		)


def remove_roles():
	if frappe.db.exists("Role", COMPANY_MANAGER_ROLE):
		frappe.delete_doc("Role", COMPANY_MANAGER_ROLE, ignore_permissions=True, force=True)


# ------------------------------------------------------------------ task templates
# A template belongs to its creator's company; one without a company is shared by every company
# (e.g. the seeded defaults) and only System Manager changes it.
TEMPLATE_TABLE = "`tabToDoBox Task Template`"


def template_query_conditions(user=None):
	"""permission_query_conditions: shared templates and those of my companies."""
	user = user or frappe.session.user
	if visible_users(user) is None:
		return ""
	shared = f"IFNULL({TEMPLATE_TABLE}.company, '') = ''"
	companies = [frappe.db.escape(c) for c in companies_of(user) if c]
	if not companies:
		return shared
	return f"({shared} OR {TEMPLATE_TABLE}.company IN ({', '.join(companies)}))"


def template_has_permission(doc, ptype=None, user=None):
	user = user or frappe.session.user
	if visible_users(user) is None:
		return True
	if not doc.get("company"):
		# create: the company is filled in before_insert
		return ptype in ("read", "select", "create")
	return doc.company in companies_of(user)


def set_template_company(doc):
	"""ToDoBox Task Template before_insert: the creator's company."""
	if doc.company or visible_users() is None:
		return
	companies = [c for c in companies_of() if c]
	if not companies:
		frappe.throw(_("You need an active employee record to create templates"), frappe.PermissionError)
	doc.company = companies[0]
