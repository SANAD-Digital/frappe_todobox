"""The current user's UI language (header menu → Change language)."""

import frappe
from frappe import _


@frappe.whitelist()
def get_languages():
	"""Enabled languages for the header "Change language" menu, plus the current user's language."""
	if frappe.session.user == "Guest":
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	langs = frappe.get_all(
		"Language", filters={"enabled": 1}, fields=["name", "language_name"], order_by="language_name asc"
	)
	current = frappe.db.get_value("User", frappe.session.user, "language") or frappe.local.lang or "en"
	return {
		"current": current,
		"languages": [{"code": l.name, "label": l.language_name or l.name} for l in langs],
	}


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
