"""The current user's UI language (header menu → Change language)."""

import frappe
from frappe import _


@frappe.whitelist(methods=["POST"])
def set_my_language(language: str):
	"""Set the current user's own UI language (User.language)."""
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not language or not frappe.db.exists("Language", language):
		frappe.throw(_("Language {0} does not exist").format(language or ""))
	frappe.db.set_value("User", user, "language", language)
	frappe.clear_cache(user=user)
	return language
