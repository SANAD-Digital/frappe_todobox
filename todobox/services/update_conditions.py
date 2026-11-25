"""Doctype Update Condition: when a document matches the conditions, it must have the required fields (or values).

Checked before every save (doc_events "*" validate / before_update_after_submit), on the document as it is being
saved, so a missing field stops the save before anything is written. Conditions and requirements use Frappe's
filter format, [[doctype, fieldname, operator, value], ...]: the document's own fields, or a child table's (any of
its rows). Only document types that have a condition are looked at (cached map).
"""

import json

import frappe
from frappe import _
from frappe.utils import cstr, strip_html

from todobox.services.rule_conditions import _compare

DOCTYPE = "Doctype Update Condition"
CACHE_KEY = "todobox:update_conditions"
# an editor left empty still holds markup ("<p><br></p>"): it counts as not set
EDITOR_TYPES = {"Text Editor", "HTML Editor", "Markdown Editor"}
OPERATORS = ("=", "!=", ">", "<", ">=", "<=", "like", "not like", "in", "not in", "is", "between", "timespan")


def clear_cache():
	frappe.cache.delete_value(CACHE_KEY)


def _rules_by_doctype() -> dict:
	rules = frappe.cache.get_value(CACHE_KEY)
	if rules is None:
		rules = {}
		if frappe.db.table_exists(DOCTYPE):
			has_disabled = frappe.db.has_column(DOCTYPE, "disabled")
			for r in frappe.get_all(
				DOCTYPE,
				filters={"disabled": 0} if has_disabled else {},
				fields=["name", "doc_type", "filters_data", "mandatory_data"],
				order_by="creation asc",
			):
				rules.setdefault(r.doc_type, []).append(
					{"name": r.name, "when": _parse(r.filters_data), "must": _parse(r.mandatory_data)}
				)
		frappe.cache.set_value(CACHE_KEY, rules)
	return rules


def _parse(value):
	if not value:
		return []
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			return []
	return [list(r) for r in value if isinstance(r, list | tuple) and len(r) >= 3] if isinstance(value, list) else []


def normalize(doctype, rows):
	"""Checked rows for saving: [[doctype, fieldname, operator, value], ...] on the type or one of its child tables."""
	meta = frappe.get_meta(doctype)
	children = {df.options for df in meta.get_table_fields()}
	out = []
	for row in _parse(rows):
		dt, fieldname, operator = row[0] or doctype, cstr(row[1]).strip(), cstr(row[2]).strip().lower()
		if not fieldname:
			continue
		if dt != doctype and dt not in children:
			frappe.throw(_("{0} is not {1} or one of its tables").format(_(dt), _(doctype)))
		if operator not in OPERATORS:
			frappe.throw(_("Operator must be one of {0}").format(", ".join(OPERATORS)))
		out.append([dt, fieldname, operator, row[3] if len(row) > 3 else None])
	return out


def _sources(doc, dt):
	"""The values a row tests: the document itself, or the rows of its child tables of that type."""
	if dt in (None, "", doc.doctype):
		return [doc]
	return [row for df in doc.meta.get_table_fields() if df.options == dt for row in (doc.get(df.fieldname) or [])]


def _holds(doc, row) -> bool:
	dt, fieldname, operator, value = (list(row) + [None])[:4]
	dt = dt or doc.doctype
	if operator == "timespan":
		return True  # relative dates are not checked on a single document
	fieldtype = (frappe.get_meta(dt).get_field(fieldname) or frappe._dict()).get("fieldtype")
	for source in _sources(doc, dt):
		current = source.get(fieldname)
		if operator == "is" and fieldtype in EDITOR_TYPES and current:
			current = strip_html(cstr(current)).replace("\xa0", " ").strip() or None
		try:
			if _compare(current, operator, value, fieldtype):
				return True
		except (TypeError, ValueError):
			continue
	return False


def _label(doc, row):
	dt, fieldname = row[0] or doc.doctype, row[1]
	label = frappe.get_meta(dt).get_label(fieldname)
	return _(label) if dt == doc.doctype else f"{_(label)} ({_(dt)})"


def check_update_conditions(doc, method=None):
	"""doc_events "*" validate / before_update_after_submit."""
	if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_patch or frappe.flags.in_import:
		return
	rules = _rules_by_doctype().get(doc.doctype)
	if not rules:
		return
	missing = []
	for rule in rules:
		if all(_holds(doc, r) for r in rule["when"]):
			for r in rule["must"]:
				if not _holds(doc, r):
					operator, value = r[2], r[3] if len(r) > 3 else None
					if operator == "is" and cstr(value).lower() in ("set", ""):
						text = _("{0} is mandatory").format(_label(doc, r))
					else:
						shown = ", ".join(cstr(v) for v in value) if isinstance(value, list) else cstr(value)
						text = _("{0} must be {1} {2}").format(_label(doc, r), _(operator), shown)
					if text not in missing:
						missing.append(text)
	if missing:
		frappe.throw("<br>".join(missing), frappe.MandatoryError, title=_("Missing values"))
