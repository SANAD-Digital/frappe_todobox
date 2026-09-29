"""Imports the data of the predecessor apps into ToDoBox (idempotent; the old tables are left untouched).

- frappe_taskmail: "TaskMail <X>"  -> "ToDoBox <X>"
- todo_tool:       "ToDo <X>"      -> "ToDoBox <X>"
- todo_management: the "custom_*" columns on ToDo / Comment -> ToDoBox's columns (only where still empty),
  and its JSON checklist (ToDo.custom_checklist) -> ToDoBox Checklist Item rows.

Raw table copies (no controllers, hooks or versions). Records whose name already exists in the ToDoBox table
are skipped (so TaskMail wins over todo_tool on equal names); record names are kept, so Link values
(task_template, step, rule names…) stay valid. Child rows are copied only for parents that have no ToDoBox rows
yet, with parenttype renamed from the old template DocType. Old rule conditions (min_amount, priority_is,
label_contains) become ToDoBox's dynamic `conditions` / `match`.
"""

import json

import frappe
from frappe.utils import now_datetime

SOURCES = ("TaskMail", "ToDo")  # DocType name prefixes, in priority order
PARENT_DOCTYPES = ("Checklist Step", "Task Template", "Rule", "Recurring Task", "Saved View")  # masters first
CHILD_DOCTYPE = "Checklist Item"
TARGET = "ToDoBox"
CHILD_PARENTS = {"Task Template": "checklist"}  # parent suffix -> child table field ("ToDo" keeps its own)

# todo_management: ToDo.custom_<x> -> ToDo.<x>, with the "empty" test for the target column
TODO_MANAGEMENT_COLUMNS = {
	"thread_id": "text",
	"parent_todo": "text",
	"cc_users": "text",
	"read_by": "text",
	"snooze_until": "date",
	"snooze_rule": "text",
	"forwarded_from": "text",
	"labels": "text",
	"day_order": "int",
	"rule_applied": "text",
}


def execute():
	for prefix in SOURCES:
		for suffix in PARENT_DOCTYPES:
			_copy_parents(f"{prefix} {suffix}", f"{TARGET} {suffix}")
		_copy_children(prefix)
	_import_todo_management()

	for suffix in (*PARENT_DOCTYPES, CHILD_DOCTYPE):
		frappe.clear_cache(doctype=f"{TARGET} {suffix}")
	frappe.cache.delete_value("todobox_rules")
	frappe.cache.delete_value("todobox_rules_v2")
	frappe.db.commit()


# ------------------------------------------------------------------ helpers
def _columns(doctype):
	return frappe.db.get_table_columns(doctype) if frappe.db.table_exists(doctype) else []


def _select(doctype, columns):
	return frappe.db.sql(
		"select {} from `tab{}`".format(", ".join(f"`{c}`" for c in columns), doctype), as_dict=True
	)


def _insert(doctype, columns, rows):
	if rows:
		frappe.db.bulk_insert(doctype, columns, [[r.get(c) for c in columns] for r in rows], ignore_duplicates=True)


# ------------------------------------------------------------------ TaskMail / todo_tool
def _copy_parents(source, target):
	src_cols, dst_cols = _columns(source), _columns(target)
	if not src_cols or not dst_cols:
		return
	columns = [c for c in dst_cols if c in src_cols]
	existing = set(frappe.db.sql_list(f"select name from `tab{target}`"))
	rows = [r for r in _select(source, sorted(set(src_cols))) if r.name not in existing]
	if not rows:
		return

	if target == f"{TARGET} Rule" and "conditions" in dst_cols:
		columns = list(dict.fromkeys([*columns, "conditions", "match"]))
		for r in rows:
			r.conditions, r.match = _rule_conditions(r), r.get("match") or "All"

	_insert(target, columns, rows)


def _rule_conditions(row):
	if row.get("conditions"):
		return row.conditions
	from todobox.services.rule_conditions import legacy_to_conditions

	ref = row.get("reference_doctype")
	if ref and not frappe.db.exists("DocType", ref):
		ref = None
	conditions = legacy_to_conditions(ref, row.get("min_amount"), row.get("priority_is"), row.get("label_contains"))
	return frappe.as_json(conditions, indent=None) if conditions else None


def _copy_children(prefix):
	source, target = f"{prefix} {CHILD_DOCTYPE}", f"{TARGET} {CHILD_DOCTYPE}"
	src_cols, dst_cols = _columns(source), _columns(target)
	if not src_cols or not dst_cols:
		return
	columns = [c for c in dst_cols if c in src_cols]
	parenttypes = {"ToDo": "ToDo", **{f"{prefix} {s}": f"{TARGET} {s}" for s in CHILD_PARENTS}}

	# parents that already have ToDoBox rows keep them (no merge, no duplicates)
	filled = set(frappe.db.sql(f"select distinct parenttype, parent from `tab{target}`"))
	existing = set(frappe.db.sql_list(f"select name from `tab{target}`"))
	rows = []
	for r in _select(source, columns):
		r.parenttype = parenttypes.get(r.parenttype)
		if r.parenttype and (r.parenttype, r.parent) not in filled and r.name not in existing:
			rows.append(r)
	_insert(target, columns, rows)


# ------------------------------------------------------------------ todo_management
def _import_todo_management():
	todo_cols = set(_columns("ToDo"))
	for col, kind in TODO_MANAGEMENT_COLUMNS.items():
		old = f"custom_{col}"
		if col not in todo_cols or old not in todo_cols:
			continue
		if kind == "int":
			empty, has = f"ifnull(`{col}`, 0) = 0", f"ifnull(`{old}`, 0) != 0"
		elif kind == "date":
			empty, has = f"`{col}` is null", f"`{old}` is not null"
		else:
			empty, has = f"ifnull(`{col}`, '') = ''", f"ifnull(`{old}`, '') != ''"
		frappe.db.sql(f"update `tabToDo` set `{col}` = `{old}` where {empty} and {has}")

	comment_cols = set(_columns("Comment"))
	if {"is_reply", "custom_is_reply"} <= comment_cols:
		frappe.db.sql("update `tabComment` set is_reply = 1 where ifnull(is_reply, 0) = 0 and custom_is_reply = 1")

	if "custom_checklist" in todo_cols:
		_import_json_checklists()


def _import_json_checklists():
	step_dt, item_dt = f"{TARGET} Checklist Step", f"{TARGET} {CHILD_DOCTYPE}"
	if not frappe.db.table_exists(step_dt) or not frappe.db.table_exists(item_dt):
		return
	filled = set(frappe.db.sql_list(f"select distinct parent from `tab{item_dt}` where parenttype = 'ToDo'"))
	todos = frappe.db.sql(
		"select name, custom_checklist from `tabToDo` where ifnull(custom_checklist, '') != ''", as_dict=True
	)
	now, steps, items = now_datetime(), {}, []
	std = {"creation": now, "modified": now, "owner": "Administrator", "modified_by": "Administrator", "docstatus": 0}
	for todo in todos:
		if todo.name in filled:
			continue
		try:
			entries = json.loads(todo.custom_checklist)
		except ValueError:
			continue
		seen = set()
		for entry in entries if isinstance(entries, list) else []:
			label, done = (entry.get("label") or entry.get("step"), entry.get("done")) if isinstance(entry, dict) else (entry, 0)
			step = " ".join(str(label or "").split())[:140]
			if not step or step.lower() in seen:
				continue
			seen.add(step.lower())
			steps.setdefault(step.lower(), step)
			items.append(
				frappe._dict(
					std,
					name=frappe.generate_hash(length=10),
					parent=todo.name,
					parenttype="ToDo",
					parentfield="checklist_items",
					idx=len(seen),
					step=step,
					done=1 if done else 0,
					done_by=(entry.get("done_by") if isinstance(entry, dict) else None) or None,
					done_on=None,
				)
			)
	if not items:
		return
	existing = {s.lower(): s for s in frappe.db.sql_list(f"select name from `tab{step_dt}`")}
	new_steps = [frappe._dict(std, name=s, step_name=s) for k, s in steps.items() if k not in existing]
	_insert(step_dt, ["name", "step_name", *std], new_steps)
	for item in items:  # point at the existing step's exact name (case-insensitive match)
		item.step = existing.get(item.step.lower(), item.step)
	columns = ["name", "parent", "parenttype", "parentfield", "idx", "step", "done", "done_by", "done_on", *std]
	_insert(item_dt, [c for c in columns if c in _columns(item_dt)], items)
