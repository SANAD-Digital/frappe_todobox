"""ToDoBox Rule: the fixed conditions (amount / priority / tag) become dynamic conditions.

Each old rule gets ``conditions`` = [[doctype, fieldname, operator, value], ...] and match "All"
(the old rules were AND). The old columns (min_amount, priority_is, label_contains) are then
dropped: the DocType no longer has these fields.
"""

import frappe

from todobox.services import rule_conditions

DOCTYPE = "ToDoBox Rule"
OLD_COLUMNS = ("min_amount", "priority_is", "label_contains")


def execute():
	if not frappe.db.table_exists(DOCTYPE):
		return
	columns = set(frappe.db.get_table_columns(DOCTYPE))
	old = [c for c in OLD_COLUMNS if c in columns]
	if old:
		fields = ["name", "reference_doctype", "conditions", *old]
		for row in frappe.db.sql(
			"select {} from `tabToDoBox Rule`".format(", ".join(f"`{f}`" for f in fields)), as_dict=True
		):
			if rule_conditions.parse(row.conditions):
				continue
			conditions = rule_conditions.legacy_to_conditions(
				row.reference_doctype, row.get("min_amount"), row.get("priority_is"), row.get("label_contains")
			)
			frappe.db.set_value(
				DOCTYPE, row.name,
				{"conditions": frappe.as_json(conditions, indent=None) if conditions else None, "match": "All"},
				update_modified=False,
			)
		frappe.db.commit()
		for column in old:
			frappe.db.sql_ddl(f"alter table `tabToDoBox Rule` drop column `{column}`")
	frappe.db.sql("update `tabToDoBox Rule` set `match` = 'All' where ifnull(`match`, '') = ''")
	frappe.cache.delete_value("todobox_rules")
	frappe.cache.delete_value("todobox_rules_v2")
	frappe.cache.delete_value("table_columns")
	frappe.clear_cache(doctype=DOCTYPE)
