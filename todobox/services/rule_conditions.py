"""Dynamic conditions of ToDoBox Rules (the format of Frappe's filters / Notification conditions).

Stored on the rule as JSON: ``[[doctype, fieldname, operator, value], ...]`` combined with
``match`` = "All" (AND) or "Any" (OR). ``doctype`` is "ToDo" or the rule's Reference DocType
(the condition then tests the ToDo's reference document).

Evaluated with ``frappe.utils.data.compare`` (Frappe's own filter comparison, value cast by
fieldtype): user values are never eval'ed.
"""

import json

import frappe
from frappe import _
from frappe.model import no_value_fields, table_fields
from frappe.utils import cstr, flt, getdate
from frappe.utils.data import cast, compare

TODO = "ToDo"
MATCH_OPTIONS = ("All", "Any")
OPERATORS = ("=", "!=", ">", "<", ">=", "<=", "like", "not like", "in", "not in", "is", "between")
IS_VALUES = ("set", "not set")
SKIP_FIELDTYPES = {"Attach", "Attach Image", "Password", "Signature", "Geolocation", "Image", "JSON", "HTML"}
DATE_TYPES = {"Date", "Datetime"}
# standard columns offered besides the DocType's own fields (name is not set yet when a ToDo is inserted)
STANDARD_FIELDS = {
	"name": ("ID", "Data", None),
	"owner": ("Created By", "Link", "User"),
	"creation": ("Created On", "Datetime", None),
	"modified": ("Last Updated On", "Datetime", None),
	"docstatus": ("Document Status", "Int", None),
}


# ------------------------------------------------------------------ fields
def filterable_fields(doctype):
	"""[{fieldname, label, fieldtype, options}] a condition can test on this DocType."""
	meta = frappe.get_meta(doctype)
	out = []
	for df in meta.fields:
		if df.fieldtype in no_value_fields or df.fieldtype in table_fields or df.fieldtype in SKIP_FIELDTYPES:
			continue
		out.append({
			"fieldname": df.fieldname, "label": _(df.label or df.fieldname, context=doctype),
			"fieldtype": df.fieldtype, "options": df.options or "",
		})
	for fieldname, (label, fieldtype, options) in STANDARD_FIELDS.items():
		if doctype == TODO and fieldname in ("name", "modified", "docstatus"):
			continue
		if fieldname == "docstatus" and not meta.is_submittable:
			continue
		out.append({"fieldname": fieldname, "label": _(label), "fieldtype": fieldtype, "options": options or ""})
	return out


def field_labels(conditions):
	"""{"doctype.fieldname": label} for the conditions' fields (the rule summary in the UI)."""
	out = {}
	for row in parse(conditions):
		if not isinstance(row, list) or len(row) < 2:
			continue
		doctype, fieldname = row[0] or TODO, row[1]
		if fieldname in STANDARD_FIELDS:
			label = STANDARD_FIELDS[fieldname][0]
		else:
			try:
				df = frappe.get_meta(doctype).get_field(fieldname)
			except frappe.DoesNotExistError:
				df = None
			label = (df.label if df else None) or fieldname
		out[f"{doctype}.{fieldname}"] = _(label, context=doctype) if label != fieldname else label
	return out


def _fieldtype(doctype, fieldname):
	if fieldname in STANDARD_FIELDS:
		return STANDARD_FIELDS[fieldname][1]
	df = frappe.get_meta(doctype).get_field(fieldname)
	return df.fieldtype if df else None


# ------------------------------------------------------------------ parse / validate
def parse(conditions):
	if not conditions:
		return []
	if isinstance(conditions, str):
		try:
			conditions = json.loads(conditions)
		except ValueError:
			return []
	return conditions if isinstance(conditions, list) else []


def normalize(conditions, reference_doctype=None):
	"""Validated conditions (throws on a bad one): [[doctype, fieldname, operator, value], ...]."""
	out = []
	for row in parse(conditions):
		if isinstance(row, dict):
			row = [row.get("doctype"), row.get("fieldname"), row.get("operator"), row.get("value")]
		if not isinstance(row, list | tuple) or len(row) < 3:
			frappe.throw(_("Invalid condition: {0}").format(frappe.as_json(row)))
		doctype, fieldname, operator = row[0] or TODO, cstr(row[1]).strip(), cstr(row[2]).strip().lower()
		value = row[3] if len(row) > 3 else None
		if not fieldname:
			continue
		if doctype not in (TODO, reference_doctype):
			frappe.throw(_("Condition on {0}: set it as the Reference Document Type first").format(_(doctype)))
		valid = {f["fieldname"]: f for f in filterable_fields(doctype)}
		if fieldname not in valid:
			frappe.throw(_("{0} is not a field of {1}").format(fieldname, _(doctype)))
		if operator not in OPERATORS:
			frappe.throw(_("Operator must be one of {0}").format(", ".join(OPERATORS)))
		fieldtype = valid[fieldname]["fieldtype"]
		if operator == "is":
			value = cstr(value).lower() or "set"
			if value not in IS_VALUES:
				frappe.throw(_("Operator 'is' takes 'set' or 'not set'"))
		elif operator in ("in", "not in"):
			value = [cstr(v).strip() for v in (value if isinstance(value, list) else cstr(value).split(","))]
			value = [v for v in value if v]
			if not value:
				frappe.throw(_("Enter at least one value for {0}").format(_(valid[fieldname]["label"])))
		elif operator == "between":
			if not isinstance(value, list) or len(value) != 2 or not all(value):
				frappe.throw(_("Enter both dates for {0}").format(_(valid[fieldname]["label"])))
			value = [cstr(v) for v in value]
		elif fieldtype == "Check":
			value = 1 if value in (1, "1", True, "true", "Yes") else 0
		elif value is None:
			value = ""
		out.append([doctype, fieldname, operator, value])
	return out


def legacy_to_conditions(reference_doctype=None, min_amount=None, priority_is=None, label_contains=None):
	"""The fixed conditions of v0.1 rules as dynamic conditions."""
	out = []
	if priority_is:
		out.append([TODO, "priority", "=", priority_is])
	if label_contains and frappe.get_meta(TODO).has_field("labels"):
		out.append([TODO, "labels", "like", f"%{label_contains}%"])
	if flt(min_amount) and reference_doctype and frappe.get_meta(reference_doctype).has_field("grand_total"):
		out.append([reference_doctype, "grand_total", ">", flt(min_amount)])
	return out


# ------------------------------------------------------------------ evaluation
class ReferenceLoader:
	"""The ToDo's reference document, read at most once per ToDo (None when missing or not readable)."""

	def __init__(self, todo):
		self.todo = todo
		self._loaded = False
		self._doc = None

	def get(self):
		if not self._loaded:
			self._loaded = True
			dt, name = self.todo.get("reference_type"), self.todo.get("reference_name")
			try:
				if dt and name and frappe.has_permission(dt, "read", doc=name):
					self._doc = frappe.db.get_value(dt, name, "*", as_dict=True)
			except Exception:
				self._doc = None
		return self._doc


def _compare(value, operator, target, fieldtype):
	if operator == "is":
		return compare(value, "is", target)
	if operator in ("like", "not like"):
		# case-insensitive, like the database's LIKE
		matched = compare(cstr(value).lower(), "like", cstr(target).lower())
		return matched if operator == "like" else not matched
	if operator in ("in", "not in"):
		targets = target if isinstance(target, list) else cstr(target).split(",")
		if fieldtype:
			value = cast(fieldtype, value)
			targets = [cast(fieldtype, cstr(t).strip()) for t in targets]
		found = value in targets
		return found if operator == "in" else not found
	if fieldtype in DATE_TYPES:
		if not value:
			return operator == "!=" and bool(target)
		value = getdate(value)
		if operator == "between":
			lo, hi = (getdate(t) for t in target)
			return lo <= value <= hi
		return compare(value, operator, getdate(target) if target else None)
	if operator == "between":
		lo, hi = target
		return compare(value, ">=", lo, fieldtype) and compare(value, "<=", hi, fieldtype)
	return compare(value, operator, target, fieldtype)


def condition_matches(condition, todo, reference, reference_doctype=None):
	doctype, fieldname, operator, target = (list(condition) + [None])[:4]
	if doctype and doctype != TODO:
		if doctype != reference_doctype or todo.get("reference_type") != doctype:
			return False
		source = reference.get()
		if source is None:
			return False
	else:
		doctype, source = TODO, todo
	try:
		return bool(_compare(source.get(fieldname), operator, target, _fieldtype(doctype, fieldname)))
	except (TypeError, ValueError):
		return False


def rule_matches(rule, todo, reference):
	"""rule: {reference_doctype, match, conditions (parsed list)}; reference: ReferenceLoader."""
	if rule.get("reference_doctype") and todo.get("reference_type") != rule["reference_doctype"]:
		return False
	conditions = parse(rule.get("conditions"))
	if not conditions:
		# scoped to a document type only (validated to have one of the two)
		return bool(rule.get("reference_doctype"))
	results = (condition_matches(c, todo, reference, rule.get("reference_doctype")) for c in conditions)
	return any(results) if rule.get("match") == "Any" else all(results)
