"""Checklists: ToDoBox Checklist Item rows on ToDo (checklist_items) and on ToDoBox Task Template (checklist)."""

import frappe
from frappe import _
from frappe.utils import now_datetime, sbool

from todobox.services.common import (
	CHECKLIST_FIELD,
	CHECKLIST_ITEM_DOCTYPE,
	CHECKLIST_STEP_DOCTYPE,
	TEMPLATE_DOCTYPE,
	ensure_can_add_checklist_item,
	ensure_can_manage,
	get_task,
	loads,
)


def has_checklist_table():
	return frappe.get_meta("ToDo").has_field(CHECKLIST_FIELD)


def get_checklists(todo_names):
	"""{todo_name: [checklist items]} read from the ToDo checklist child table in one query."""
	if not todo_names or not has_checklist_table():
		return {}
	rows = frappe.get_all(
		CHECKLIST_ITEM_DOCTYPE,
		filters={"parenttype": "ToDo", "parentfield": CHECKLIST_FIELD, "parent": ["in", list(todo_names)]},
		fields=["name", "parent", "step", "done", "done_by", "done_on"],
		order_by="idx asc",
	)
	out = {}
	for r in rows:
		out.setdefault(r.parent, []).append(
			{
				"id": r.name,
				"label": r.step,
				"done": bool(r.done),
				"done_by": r.done_by,
				"done_on": str(r.done_on) if r.done_on else None,
			}
		)
	return out


def get_or_create_step(label):
	"""Returns the ToDoBox Checklist Step for label, creating it when it does not exist yet."""
	label = " ".join(str(label or "").split())[:140]
	if not label:
		return None
	existing = frappe.db.get_value(CHECKLIST_STEP_DOCTYPE, label, "name")
	if existing:
		return existing
	return frappe.get_doc({"doctype": CHECKLIST_STEP_DOCTYPE, "step_name": label}).insert(ignore_permissions=True).name


def normalize_checklist(items):
	"""Accepts labels or dicts ({label|step, done}) and returns unique [(step, done)] in order."""
	items = loads(items, [])
	out, seen = [], set()
	for item in items or []:
		if isinstance(item, dict):
			label, done = item.get("label") or item.get("step"), item.get("done")
		else:
			label, done = item, False
		step = get_or_create_step(label)
		if step and step.lower() not in seen:
			seen.add(step.lower())
			out.append((step, 1 if done else 0))
	return out


def set_checklist(doc, steps, fieldname=CHECKLIST_FIELD):
	"""Replaces checklist rows on doc with normalized steps, keeping who/when of steps already done."""
	previous = {row.step: row for row in doc.get(fieldname) or []}
	doc.set(fieldname, [])
	for step, done in steps:
		row = {"step": step, "done": done}
		old = previous.get(step)
		if done:
			row["done_by"] = old.done_by if old and old.done else frappe.session.user
			row["done_on"] = old.done_on if old and old.done else now_datetime()
		doc.append(fieldname, row)


def _find_checklist_row(todo, item_id):
	for row in todo.get(CHECKLIST_FIELD) or []:
		if row.name == item_id:
			return row
	frappe.throw(_("Checklist step not found"))


def _save(todo):
	todo.save(ignore_permissions=True)
	frappe.db.commit()
	return get_checklists([todo.name]).get(todo.name, [])


@frappe.whitelist()
def toggle_checklist_item(name, item_id, done=None):
	"""Marks a checklist step done/undone on a ToDo (toggles when done is not given)."""
	todo = get_task(name)
	row = _find_checklist_row(todo, item_id)
	row.done = (0 if row.done else 1) if done is None else (1 if sbool(done) else 0)
	row.done_by = frappe.session.user if row.done else None
	row.done_on = now_datetime() if row.done else None
	return _save(todo)


@frappe.whitelist()
def add_checklist_item(name, label):
	"""Appends a checklist step to a ToDo (creator or assignee), creating the step master when needed."""
	todo = get_task(name)
	ensure_can_add_checklist_item(todo)
	step = get_or_create_step(label)
	if not step:
		frappe.throw(_("Enter the step text"))
	if any(row.step.lower() == step.lower() for row in todo.get(CHECKLIST_FIELD) or []):
		return get_checklists([name]).get(name, [])
	todo.append(CHECKLIST_FIELD, {"step": step, "done": 0})
	return _save(todo)


@frappe.whitelist()
def remove_checklist_item(name, item_id):
	"""Removes a checklist step from a ToDo (creator only)."""
	todo = get_task(name)
	ensure_can_manage(todo)
	todo.remove(_find_checklist_row(todo, item_id))
	return _save(todo)


@frappe.whitelist()
def apply_task_template(name, template):
	"""Adds the steps of a ToDoBox Task Template that are missing from a ToDo's checklist."""
	todo = get_task(name)
	ensure_can_manage(todo)
	tpl = frappe.get_doc(TEMPLATE_DOCTYPE, template)
	existing = {row.step.lower() for row in todo.get(CHECKLIST_FIELD) or []}
	for row in tpl.checklist:
		if row.step.lower() not in existing:
			todo.append(CHECKLIST_FIELD, {"step": row.step, "done": 0})
	if frappe.get_meta("ToDo").has_field("task_template") and not todo.get("task_template"):
		todo.task_template = tpl.name
	return _save(todo)
