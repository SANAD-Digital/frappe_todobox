# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from todobox.services.update_conditions import clear_cache, normalize


class DoctypeUpdateCondition(Document):
	def validate(self):
		if not frappe.db.exists("DocType", self.doc_type):
			frappe.throw(_("{0} is not a document type").format(self.doc_type))
		self.filters_data = frappe.as_json(normalize(self.doc_type, self.filters_data))
		required = normalize(self.doc_type, self.mandatory_data)
		if not required:
			frappe.throw(_("Add at least one field the document must have"))
		self.mandatory_data = frappe.as_json(required)

	def on_update(self):
		clear_cache()

	def on_trash(self):
		clear_cache()
