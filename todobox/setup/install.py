"""Install / migrate / uninstall hooks: custom fields on ToDo and Comment, indexes, roles, default templates,
desk artifacts.

Everything here is idempotent and safe to re-run.
"""

import json

import frappe
from frappe import _, _lt
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from todobox.services.common import CHECKLIST_ITEM_DOCTYPE, TEMPLATE_DOCTYPE
from todobox.services.org import remove_roles, setup_roles

MODULE = "ToDoBox"

CUSTOM_FIELDS = {
	"ToDo": [
		# own subject field: the title must not depend on another app
		{"fieldname": "subject", "label": "Subject", "fieldtype": "Data", "insert_after": "description_section", "in_list_view": 1},
		{"fieldname": "thread_id", "label": "Thread ID", "fieldtype": "Data", "insert_after": "status"},
		{
			"fieldname": "parent_todo",
			"label": "Parent ToDo",
			"fieldtype": "Link",
			"options": "ToDo",
			"insert_after": "thread_id",
			"search_index": 1,
		},
		{
			"fieldname": "completed_on",
			"label": "Completed On",
			"fieldtype": "Datetime",
			"insert_after": "date",
			"read_only": 1,
			"no_copy": 1,
			"search_index": 1,
		},
		{"fieldname": "cc_users", "label": "CC Users", "fieldtype": "Small Text", "insert_after": "allocated_to"},
		{"fieldname": "read_by", "label": "Read By", "fieldtype": "Text", "insert_after": "cc_users"},
		{
			"fieldname": "snooze_until",
			"label": "Snooze Until",
			"fieldtype": "Datetime",
			"insert_after": "date",
			"search_index": 1,
		},
		{"fieldname": "snooze_rule", "label": "Snooze Rule", "fieldtype": "Data", "insert_after": "snooze_until"},
		{"fieldname": "labels", "label": "Custom Labels", "fieldtype": "Small Text", "insert_after": "priority"},
		{
			"fieldname": "forwarded_from",
			"label": "Forwarded From",
			"fieldtype": "Link",
			"options": "User",
			"insert_after": "assigned_by",
		},
		{
			"fieldname": "task_template",
			"label": "Task Template",
			"fieldtype": "Link",
			"options": TEMPLATE_DOCTYPE,
			"insert_after": "description",
		},
		{
			"fieldname": "checklist_items",
			"label": "Checklist",
			"fieldtype": "Table MultiSelect",
			"options": CHECKLIST_ITEM_DOCTYPE,
			"insert_after": "task_template",
		},
		{"fieldname": "day_order", "label": "Day Order", "fieldtype": "Int", "insert_after": "labels"},
		{
			"fieldname": "rule_applied",
			"label": "Automation Rule Applied",
			"fieldtype": "Small Text",
			"insert_after": "day_order",
		},
	],
	"Comment": [
		{
			"fieldname": "is_reply",
			"label": "Is Reply",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "comment_type",
		}
	],
	"Notification Log": [
		# what the notification is about (reply, first, answer, mention, ...), for the ToDoBox bell
		{
			"fieldname": "todobox_kind",
			"label": "ToDoBox Kind",
			"fieldtype": "Data",
			"insert_after": "type",
			"read_only": 1,
			"hidden": 1,
		}
	],
}

# Default task templates, seeded once in the site's default language (see seed_task_templates)
DEFAULT_TASK_TEMPLATES = [
	{
		"template_name": _lt("Client follow-up"),
		"subject": _lt("Follow up with the client"),
		"description": _lt("Call the client, record their feedback and agree on the next step."),
		"priority": "Medium",
		"checklist": [_lt("Call the client"), _lt("Record the feedback"), _lt("Schedule the next follow-up")],
	},
	{
		"template_name": _lt("Document review"),
		"subject": _lt("Review the document"),
		"description": _lt("Read the document, check it for accuracy and send back your comments."),
		"priority": "High",
		"checklist": [
			_lt("Read the document"),
			_lt("Check facts and figures"),
			_lt("Add comments"),
			_lt("Send back for revision or approve"),
		],
	},
	{
		"template_name": _lt("Team onboarding"),
		"subject": _lt("Onboard a new team member"),
		"description": _lt("Prepare everything a new colleague needs for their first week."),
		"priority": "Medium",
		"checklist": [
			_lt("Create user accounts"),
			_lt("Share key documents"),
			_lt("Introduce the team"),
			_lt("Plan the first week"),
		],
	},
	{
		"template_name": _lt("Weekly report"),
		"subject": _lt("Prepare the weekly report"),
		"description": _lt("Summarise the week's progress, open issues and next week's plan."),
		"priority": "Low",
		"checklist": [_lt("Collect updates"), _lt("Write the summary"), _lt("Share the report")],
	},
	{
		"template_name": _lt("Event preparation"),
		"subject": _lt("Prepare the event"),
		"description": _lt("Arrange the venue, invitations and agenda ahead of the event."),
		"priority": "Medium",
		"checklist": [
			_lt("Book the venue"),
			_lt("Send the invitations"),
			_lt("Prepare the agenda"),
			_lt("Confirm attendance"),
		],
	},
]

# Composite indexes on core ToDo columns used by every folder query (allocated_to/assigned_by + status)
TODO_INDEXES = {
	"todobox_allocated_status": ("allocated_to", "status"),
	"todobox_assigned_status": ("assigned_by", "status"),
}

APP_NAME = "todobox"


def _logger():
	return frappe.logger("todobox", allow_site=True)


def _safe(step, fn, *args):
	"""Runs one lifecycle step; a failure is logged and rolled back without aborting the others."""
	try:
		fn(*args)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		_logger().exception(f"ToDoBox lifecycle step failed: {step}")
		frappe.log_error(title=f"ToDoBox: {step} failed")


# ------------------------------------------------------------------ hooks
def after_install():
	setup_custom_fields()
	frappe.db.commit()
	_safe("indexes", setup_indexes)
	_safe("roles", setup_roles)
	_safe("seed task templates", seed_task_templates)
	_safe("backfill completed_on", backfill_completed_on)


def after_migrate():
	setup_custom_fields()
	frappe.db.commit()
	_safe("indexes", setup_indexes)
	_safe("roles", setup_roles)
	_safe("backfill completed_on", backfill_completed_on)


def before_uninstall():
	_safe("release custom fields", release_custom_fields)


def after_uninstall():
	_safe("drop indexes", drop_indexes)
	_safe("remove desk artifacts", remove_desk_artifacts)
	_safe("remove roles", remove_roles)
	frappe.clear_cache()


# ------------------------------------------------------------------ custom fields
def setup_custom_fields():
	"""Creates the fields (or updates them to the definitions above). They are hidden and read-only on
	the Desk forms, which look as they did before ToDoBox; the app writes them server-side."""
	fields = {
		dt: [{**df, "hidden": 1, "read_only": 1, "module": MODULE} for df in dfs] for dt, dfs in CUSTOM_FIELDS.items()
	}
	create_custom_fields(fields, ignore_validate=True)


def release_custom_fields():
	"""ToDoBox is being uninstalled: delete its field definitions (Frappe keeps the table columns, so a
	reinstall gets the data back)."""
	for dt, dfs in CUSTOM_FIELDS.items():
		for df in dfs:
			name = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": df["fieldname"], "module": MODULE})
			if name:
				frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True)
		frappe.clear_cache(doctype=dt)

	for ps in frappe.get_all("Property Setter", filters={"module": MODULE}, pluck="name"):
		frappe.delete_doc("Property Setter", ps, ignore_permissions=True, force=True)


# ------------------------------------------------------------------ indexes
def setup_indexes():
	for index_name, columns in TODO_INDEXES.items():
		frappe.db.add_index("ToDo", list(columns), index_name)


def drop_indexes():
	for index_name in TODO_INDEXES:
		if not frappe.db.has_index("tabToDo", index_name):
			continue
		if frappe.db.db_type == "postgres":
			frappe.db.sql_ddl(f'DROP INDEX IF EXISTS "{index_name}"')
		else:
			frappe.db.sql_ddl(f"ALTER TABLE `tabToDo` DROP INDEX `{index_name}`")


# ------------------------------------------------------------------ desk artifacts
def remove_desk_artifacts():
	"""Desktop icons / sidebars of the app. Frappe's own cleanup matches icons by app_name, not by the
	"ToDoBox" label, so it misses them.

	Rows are removed directly: in developer mode ``delete_doc`` would also delete the app's own
	desktop_icon/*.json and workspace_sidebar/*.json files (their on_trash removes the exported file)."""
	icons = frappe.get_all("Desktop Icon", filters={"app": APP_NAME}, pluck="name")
	icons += frappe.get_all("Desktop Icon", filters={"parent_icon": ["in", icons or [""]]}, pluck="name")
	sidebars = frappe.get_all("Workspace Sidebar", filters={"app": APP_NAME}, pluck="name")
	for doctype, names in (("Desktop Icon", set(icons)), ("Workspace Sidebar", set(sidebars))):
		if not names:
			continue
		for child in frappe.get_meta(doctype).get_table_fields():
			frappe.db.delete(child.options, {"parenttype": doctype, "parent": ("in", list(names))})
		frappe.db.delete(doctype, {"name": ("in", list(names))})
	frappe.cache.delete_key("desktop_icons")
	frappe.cache.delete_key("bootinfo")
	# the Workspace belongs to the ToDoBox module and is removed by Frappe's module deletion


def seed_task_templates():
	"""Creates the default task templates once, when the site has none, translated to the site's
	default language."""
	if frappe.db.count(TEMPLATE_DOCTYPE):
		return

	from todobox.services.checklist import normalize_checklist, set_checklist

	lang = frappe.db.get_default("lang") or frappe.local.lang

	def tr(value):
		return _(value.msg, lang=lang) if hasattr(value, "msg") else value

	for tpl in DEFAULT_TASK_TEMPLATES:
		doc = frappe.new_doc(TEMPLATE_DOCTYPE)
		doc.update({k: tr(v) for k, v in tpl.items() if k != "checklist"})
		set_checklist(doc, normalize_checklist([tr(step) for step in tpl["checklist"]]), fieldname="checklist")
		doc.insert(ignore_permissions=True)


def backfill_completed_on():
	"""completed_on for tasks closed before the field existed (or closed without validate, e.g. db updates):
	the time the status changed to Closed from the Version log, else the last modification."""
	rows = frappe.get_all(
		"ToDo", filters={"status": "Closed", "completed_on": ["is", "not set"]}, fields=["name", "modified"]
	)
	if not rows:
		return

	closed_at = {}
	names = [r.name for r in rows]
	for i in range(0, len(names), 500):
		for v in frappe.get_all(
			"Version",
			filters={"ref_doctype": "ToDo", "docname": ["in", names[i : i + 500]], "data": ["like", '%"status"%']},
			fields=["docname", "data", "creation"],
			order_by="creation desc",
		):
			if v.docname in closed_at:
				continue
			try:
				changed = json.loads(v.data or "{}").get("changed") or []
			except ValueError:
				continue
			if any(c[0] == "status" and c[2] == "Closed" for c in changed):
				closed_at[v.docname] = v.creation

	for row in rows:
		frappe.db.set_value(
			"ToDo", row.name, "completed_on", closed_at.get(row.name) or row.modified, update_modified=False
		)
