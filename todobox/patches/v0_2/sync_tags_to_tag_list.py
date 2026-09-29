"""Adds every tag already used by ToDoBox (tasks, rules, recurring tasks) to Frappe's Tag list."""

import frappe

from todobox.services.common import RECURRING_DOCTYPE, RULE_DOCTYPE, split_csv
from todobox.services.tags import ensure_tags


def execute():
	tags = set()
	sources = (("ToDo", "labels"), (RULE_DOCTYPE, "add_label"), (RECURRING_DOCTYPE, "labels"))
	for doctype, field in sources:
		if not frappe.db.table_exists(doctype) or not frappe.get_meta(doctype).has_field(field):
			continue
		for value in frappe.get_all(doctype, filters={field: ["is", "set"]}, pluck=field, distinct=True):
			tags.update(split_csv(value))
	ensure_tags(sorted(tags))
