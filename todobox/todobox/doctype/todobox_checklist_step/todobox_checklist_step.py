# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ToDoBoxChecklistStep(Document):
	def validate(self):
		self.step_name = (self.step_name or "").strip()
		if not self.step_name:
			frappe.throw(_("Step is required"))
