# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ToDoBoxSavedView(Document):
	def validate(self):
		self.view_name = (self.view_name or "").strip()
		self.query = (self.query or "").strip()
