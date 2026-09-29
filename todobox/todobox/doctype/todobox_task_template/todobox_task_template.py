# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ToDoBoxTaskTemplate(Document):
	def validate(self):
		# Template steps are never "done"; drop duplicates while keeping order
		seen, rows = set(), []
		for row in self.checklist:
			if not row.step or row.step in seen:
				continue
			seen.add(row.step)
			row.done = 0
			row.done_by = None
			row.done_on = None
			rows.append(row)
		self.checklist = rows

	def on_trash(self):
		# Frappe ignores ToDo links on delete, so clear them instead of leaving broken links
		if frappe.get_meta("ToDo").has_field("task_template"):
			frappe.db.set_value("ToDo", {"task_template": self.name}, "task_template", None, update_modified=False)
