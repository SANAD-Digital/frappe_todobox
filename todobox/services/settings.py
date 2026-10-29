"""ToDoBox Settings (Single): who appears in pickers, department-only assignment, linkable document types.

Every helper is cached for the request (frappe.local); saving the settings clears the caches.
"""

import frappe
from frappe import _

from todobox.services.common import can, is_system_manager, loads

SETTINGS_DOCTYPE = "ToDoBox Settings"
CACHE_KEY = "todobox_settings_cache"

DEFAULTS = {
	"hide_administrator": 1,
	"hidden_users": [],
	"hidden_groups": [],
	"restrict_to_department": 0,
	"linkable_doctypes": [],
}


def _cache():
	if not hasattr(frappe.local, CACHE_KEY):
		setattr(frappe.local, CACHE_KEY, {})
	return getattr(frappe.local, CACHE_KEY)


def clear_cache():
	"""Drops the request cache and the cached Single."""
	if hasattr(frappe.local, CACHE_KEY):
		delattr(frappe.local, CACHE_KEY)
	frappe.clear_document_cache(SETTINGS_DOCTYPE, SETTINGS_DOCTYPE)


def get_settings():
	"""The settings as a plain dict (DEFAULTS before the DocType is migrated)."""
	cache = _cache()
	if "settings" not in cache:
		if not frappe.db.exists("DocType", SETTINGS_DOCTYPE):
			cache["settings"] = {k: (list(v) if isinstance(v, list) else v) for k, v in DEFAULTS.items()}
		else:
			doc = frappe.get_cached_doc(SETTINGS_DOCTYPE)
			cache["settings"] = {
				"hide_administrator": 1 if doc.hide_administrator else 0,
				"hidden_users": [r.user for r in doc.get("hidden_users") or [] if r.user],
				"hidden_groups": [r.user_group for r in doc.get("hidden_groups") or [] if r.user_group],
				"restrict_to_department": 1 if doc.restrict_to_department else 0,
				"linkable_doctypes": [r.document_type for r in doc.get("linkable_doctypes") or [] if r.document_type],
			}
	return cache["settings"]


# ------------------------------------------------------------------ hidden people
def hidden_people():
	"""Users kept out of recipient/user pickers: Administrator (when hidden), the hidden users and every
	member of the hidden user groups."""
	cache = _cache()
	if "hidden" not in cache:
		s = get_settings()
		hidden = set(s["hidden_users"])
		if s["hide_administrator"]:
			hidden.add("Administrator")
		if s["hidden_groups"]:
			hidden.update(
				frappe.get_all(
					"User Group Member",
					filters={"parenttype": "User Group", "parent": ["in", s["hidden_groups"]]},
					pluck="user",
				)
			)
		hidden.discard(None)
		cache["hidden"] = hidden
	return cache["hidden"]


# ------------------------------------------------------------------ department
def department_available():
	"""Employee and Department exist (ERPNext/HRMS) and Employee has a department field."""
	return bool(
		frappe.db.exists("DocType", "Employee")
		and frappe.db.exists("DocType", "Department")
		and frappe.get_meta("Employee").has_field("department")
	)


def department_peers(user=None):
	"""The users this user may assign to when "Assign only within the department" is on: the active
	employees of their department(s) plus themselves. None: no restriction (option off, no HR doctypes,
	or a System Manager / Administrator)."""
	user = user or frappe.session.user
	cache = _cache().setdefault("peers", {})
	if user not in cache:
		if (
			not get_settings()["restrict_to_department"]
			or user == "Administrator"
			or is_system_manager(user)
			or not department_available()
		):
			cache[user] = None
		else:
			departments = frappe.get_all(
				"Employee",
				filters={"user_id": user, "status": "Active", "department": ["is", "set"]},
				pluck="department",
				distinct=True,
			)
			members = (
				frappe.get_all(
					"Employee",
					filters={"department": ["in", departments], "status": "Active", "user_id": ["is", "set"]},
					pluck="user_id",
				)
				if departments
				else []
			)
			cache[user] = {*members, user}
	return cache[user]


# ------------------------------------------------------------------ linkable document types
def _all_doctypes():
	cache = _cache()
	if "all_doctypes" not in cache:
		cache["all_doctypes"] = frappe.get_all(
			"DocType", filters={"istable": 0, "issingle": 0}, pluck="name", order_by="name asc"
		)
	return cache["all_doctypes"]


def linkable_doctypes(user=None):
	"""Document types a task may link to: the configured list (all non-child, non-single DocTypes when
	empty), limited to those the user can read."""
	user = user or frappe.session.user
	cache = _cache().setdefault("linkable", {})
	if user not in cache:
		configured = get_settings()["linkable_doctypes"]
		candidates = configured or _all_doctypes()
		cache[user] = [dt for dt in candidates if can(dt, "read", user=user)]
	return cache[user]


def can_link(doctype, user=None):
	"""True when a task may link to this document type (see linkable_doctypes) — without building the
	whole list."""
	user = user or frappe.session.user
	if not doctype or not frappe.db.exists("DocType", doctype):
		return False
	configured = get_settings()["linkable_doctypes"]
	if configured:
		if doctype not in configured:
			return False
	else:
		meta = frappe.db.get_value("DocType", doctype, ["istable", "issingle"], as_dict=True)
		if meta.istable or meta.issingle:
			return False
	return can(doctype, "read", user=user)


def ensure_linkable(reference_type, reference_name=None, user=None):
	"""Raises PermissionError unless the user may link a task to this document (type allowed and
	readable, the document itself readable)."""
	if not reference_type:
		return
	if not can_link(reference_type, user):
		frappe.throw(_("You cannot link this document type"), frappe.PermissionError)
	if reference_name:
		if not frappe.db.exists(reference_type, reference_name):
			frappe.throw(_("{0} {1} not found").format(_(reference_type), reference_name), frappe.DoesNotExistError)
		if not can(reference_type, "read", doc=reference_name, user=user):
			frappe.throw(_("You cannot link this document type"), frappe.PermissionError)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def search_link_doctypes(doctype, txt, searchfield, start, page_len, filters):
	"""Link-field query for the task's "Document type": linkable DocTypes matching txt by name or
	translated label → [[name, label], ...]."""
	txt = (txt or "").strip().lower()
	rows = [[dt, _(dt)] for dt in linkable_doctypes()]
	if txt:
		rows = [r for r in rows if txt in r[0].lower() or txt in r[1].lower()]
	start = frappe.utils.cint(start)
	return rows[start : start + (frappe.utils.cint(page_len) or 20)]


# ------------------------------------------------------------------ API
@frappe.whitelist()
def get_settings_api():
	"""The settings for the settings screen; can_edit only for System Manager."""
	s = get_settings()
	return {
		"can_edit": 1 if is_system_manager() else 0,
		"hide_administrator": s["hide_administrator"],
		"hidden_users": list(s["hidden_users"]),
		"hidden_groups": list(s["hidden_groups"]),
		"restrict_to_department": s["restrict_to_department"],
		"linkable_doctypes": list(s["linkable_doctypes"]),
		"department_available": 1 if department_available() else 0,
	}


@frappe.whitelist(methods=["POST"])
def save_settings(data):
	"""Saves the settings (System Manager only) and returns them as get_settings does."""
	if not is_system_manager():
		frappe.throw(_("Only a System Manager can change ToDoBox settings"), frappe.PermissionError)
	data = loads(data, {}) or {}
	doc = frappe.get_doc(SETTINGS_DOCTYPE)

	def names(key):
		return [x for x in dict.fromkeys(str(v).strip() for v in (data.get(key) or []) if v) if x]

	if "hide_administrator" in data:
		doc.hide_administrator = 1 if frappe.utils.cint(data["hide_administrator"]) else 0
	if "restrict_to_department" in data:
		doc.restrict_to_department = 1 if frappe.utils.cint(data["restrict_to_department"]) else 0
	for key, field in (("hidden_users", "user"), ("hidden_groups", "user_group"), ("linkable_doctypes", "document_type")):
		if key in data:
			doc.set(key, [{field: v} for v in names(key)])
	doc.save()
	clear_cache()
	return get_settings_api()
