# Copyright (c) 2026, SANAD Digital and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, today

from todobox.services.common import join_tags, split_csv
from todobox.services.tags import ensure_tags

EXCLUDED_ROLES = ("Guest", "Administrator")


class ToDoBoxRecurringTask(Document):
	def validate(self):
		self.title = (self.title or "").strip()
		if not self.task_template and not (self.subject or "").strip():
			frappe.throw(_("Choose a task template or enter a subject"))
		self.validate_target()
		self.set_schedule()
		self.labels = join_tags(self.labels) or None
		ensure_tags(split_csv(self.labels))

	def validate_target(self):
		"""A user takes precedence; with no user, the task goes to every user holding the role."""
		if not self.allocated_to and not self.role:
			frappe.throw(_("Choose the user to assign the task to, or a role"))
		if self.role in EXCLUDED_ROLES:
			frappe.throw(_("Tasks cannot be assigned to the role {0}").format(_(self.role)))
		self.assign_by = "User" if self.allocated_to else "Role"

	def set_schedule(self):
		"""The period comes only from the frequency: the first run is today (or the next cycle if it
		already ran today), then the scheduler moves it forward by the frequency."""
		self.due_after_days = 0
		if self.is_new() or not self.next_run or self.has_value_changed("frequency"):
			from todobox.services.automation import next_date

			ran_today = self.last_run and getdate(self.last_run) >= getdate(today())
			self.next_run = next_date(today(), self.frequency) if ran_today else today()
