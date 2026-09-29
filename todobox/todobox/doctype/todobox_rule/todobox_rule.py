# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from todobox.services import rule_conditions
from todobox.services.common import join_tags, split_csv
from todobox.services.tags import ensure_tags

ACTION_FIELDS = ("set_priority", "add_label")


class ToDoBoxRule(Document):
	def validate(self):
		self.rule_name = (self.rule_name or "").strip()
		self.add_label = join_tags(self.add_label) or None
		ensure_tags(split_csv(self.add_label))
		self.match = self.match if self.match in rule_conditions.MATCH_OPTIONS else "All"
		conditions = rule_conditions.normalize(self.conditions, self.reference_doctype)
		self.conditions = frappe.as_json(conditions, indent=None) if conditions else None
		if not conditions and not self.reference_doctype:
			frappe.throw(_("Add at least one condition"))
		if not any(self.get(f) for f in ACTION_FIELDS):
			frappe.throw(_("Add at least one action"))

	def on_change(self):
		self.clear_rules_cache()

	def on_trash(self):
		self.clear_rules_cache()

	@staticmethod
	def clear_rules_cache():
		from todobox.services.automation import clear_rules_cache

		clear_rules_cache()
