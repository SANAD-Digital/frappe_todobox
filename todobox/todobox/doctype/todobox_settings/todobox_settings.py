# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ToDoBoxSettings(Document):
	def on_update(self):
		from todobox.services.settings import clear_cache

		clear_cache()
