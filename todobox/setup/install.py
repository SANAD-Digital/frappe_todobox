"""Install / migrate / uninstall hooks: custom fields on ToDo and Comment, indexes, roles, default templates,
desk artifacts.

Everything here is idempotent and safe to re-run.
"""

import json
import os

import frappe
from frappe import _, _lt
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.modules import scrub

from todobox.services.common import CHECKLIST_ITEM_DOCTYPE, TEMPLATE_DOCTYPE
from todobox.services.org import remove_roles, setup_roles
from todobox.setup.legacy import migrate_legacy_workflow

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
		{"fieldname": "archived_by", "label": "Archived By", "fieldtype": "Text", "insert_after": "read_by"},
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

# Workflow: shown on the Workflow forms, unlike the fields above. Only those with a runtime effect
CUSTOM_FIELDS.update(
	{
		"Workflow": [
			{"fieldname": "show_status_bar", "label": "Show Status Bar", "fieldtype": "Check", "default": "1", "insert_after": "workflow_state_field"},
			{"fieldname": "todobox_has_wf_trace", "label": "Has trace?", "fieldtype": "Check", "insert_after": "show_status_bar"},
		],
		"Workflow Transition": [
			{"fieldname": "todobox_add_user", "label": "Add User", "fieldtype": "Button", "insert_after": "allow_self_approval"},
			{"fieldname": "todobox_users_by_doc_field", "label": "Users By Doc Field", "fieldtype": "Data", "insert_after": "todobox_add_user"},
			{"fieldname": "todobox_use_and_condition", "label": "Use and Condition", "fieldtype": "Check", "depends_on": "todobox_users_by_doc_field", "insert_after": "todobox_users_by_doc_field"},
			{"fieldname": "todobox_use_and_condition_between_users", "label": "Use and Condition Between Users", "fieldtype": "Check", "insert_after": "todobox_use_and_condition"},
		],
		"Workflow Document State": [
			{"fieldname": "show_in_statusbar", "label": "Show in Status Bar", "fieldtype": "Check", "default": "1", "insert_after": "style"},
			{"fieldname": "status_no", "label": "Status No", "fieldtype": "Int", "insert_after": "show_in_statusbar"},
			{"fieldname": "todobox_statusbar_condition", "label": "Status Bar Condition", "fieldtype": "Small Text", "insert_after": "status_no"},
		],
		"Workflow State": [
			{"fieldname": "todobox_hide_in_report", "label": "Hide In Report", "fieldtype": "Check", "insert_after": "style"},
		],
		"Workflow Action": [
			{"fieldname": "next_state", "label": "Next State", "fieldtype": "Link", "options": "Workflow State", "insert_after": "workflow_state", "read_only": 1},
			{"fieldname": "next_action", "label": "Next Action", "fieldtype": "Link", "options": "Workflow Action Master", "insert_after": "next_state", "read_only": 1},
			{"fieldname": "received_on", "label": "Received On", "fieldtype": "Datetime", "insert_after": "completed_by", "read_only": 1},
			{"fieldname": "completed_on", "label": "Completed On", "fieldtype": "Datetime", "insert_after": "received_on", "read_only": 1},
			{"fieldname": "duration", "label": "Duration", "fieldtype": "Duration", "insert_after": "completed_on", "read_only": 1},
			{"fieldname": "todobox_permitted_users", "label": "Permitted Users", "fieldtype": "Table MultiSelect", "options": "Workflow Action Permitted User", "insert_after": "permitted_roles", "read_only": 1},
			{"fieldname": "todobox_permitted_users_count", "label": "Permitted Users Count", "fieldtype": "Int", "insert_after": "todobox_permitted_users", "hidden": 1, "read_only": 1},
		],
	}
)

# Workflow data ToDoBox owns on a site
SHARED_DOCTYPES = ("Workflow Trace", "Workflow Action Permitted User")
SHARED_REPORTS = (
	"Employee wise Workflow Action",
	"Leader For Wise",
	"Workflow Action Report",
	"Workflow Trace Report",
	"Workflow Trace Summary",
)
SHARED_FIELDS = {
	"Workflow": ("show_status_bar", "todobox_has_wf_trace"),
	"Workflow Transition": (
		"todobox_add_user", "todobox_users_by_doc_field", "todobox_use_and_condition",
		"todobox_use_and_condition_between_users",
	),
	"Workflow Document State": ("show_in_statusbar", "status_no", "todobox_statusbar_condition"),
	"Workflow State": ("todobox_hide_in_report",),
	"Workflow Action": (
		"next_state", "next_action", "received_on", "completed_on", "duration", "todobox_permitted_users",
		"todobox_permitted_users_count",
	),
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
	# before the fields are created: it moves older data to these names
	migrate_legacy_workflow()
	setup_custom_fields()
	claim_workflow_ownership()
	frappe.db.commit()
	_safe("indexes", setup_indexes)
	_safe("roles", setup_roles)
	_safe("seed task templates", seed_task_templates)
	_safe("backfill completed_on", backfill_completed_on)


def after_migrate():
	# before the fields are created: it moves older data to these names
	migrate_legacy_workflow()
	setup_custom_fields()
	claim_workflow_ownership()
	frappe.db.commit()
	_safe("indexes", setup_indexes)
	_safe("roles", setup_roles)
	_safe("backfill completed_on", backfill_completed_on)


def before_uninstall():
	# not _safe: if this fails the uninstall must stop, or Frappe would drop the Workflow Trace table
	release_workflow_ownership()
	frappe.db.commit()
	_safe("release custom fields", release_custom_fields)


def after_uninstall():
	_safe("drop indexes", drop_indexes)
	_safe("remove desk artifacts", remove_desk_artifacts)
	_safe("remove roles", remove_roles)
	frappe.clear_cache()


# ------------------------------------------------------------------ shared workflow data
def _per_doctype_trace_fields():
	"""The trace fields a Workflow with "Has trace?" added to its document type."""
	fields = frappe.get_all(
		"Custom Field",
		filters={"fieldname": ("in", ("todobox_wf_trace", "section_workflow_trace"))},
		fields=["name", "module"],
	)
	with_trace = frappe.get_all("Custom Field", filters={"fieldname": "todobox_wf_trace"}, pluck="dt")
	if with_trace:
		fields += frappe.get_all(
			"Custom Field",
			filters={
				"fieldname": "main_data",
				"insert_after": "todobox_wf_trace",
				"fieldtype": "Section Break",
				"dt": ("in", with_trace),
			},
			fields=["name", "module"],
		)
	return fields


def _shared_fields():
	fields = []
	for dt, fieldnames in SHARED_FIELDS.items():
		fields += frappe.get_all(
			"Custom Field", filters={"dt": dt, "fieldname": ("in", fieldnames)}, fields=["name", "module"]
		)
	return fields


def _report_code_shipped(report) -> bool:
	"""A standard report runs from <module>/report/<name>/, so it cannot move before its code is here."""
	folder = scrub(report)
	return os.path.exists(frappe.get_app_path(APP_NAME, scrub(MODULE), "report", folder, f"{folder}.py"))


def claim_workflow_ownership():
	"""Idempotent. A field another app or the site owns stays as it is."""
	for doctype in SHARED_DOCTYPES:
		current = frappe.db.get_value("DocType", doctype, ["module", "custom"], as_dict=True)
		if current and (current.module != MODULE or current.custom):
			frappe.db.set_value("DocType", doctype, {"module": MODULE, "custom": 0}, update_modified=False)
			frappe.clear_cache(doctype=doctype)

	for report in SHARED_REPORTS:
		module = frappe.db.get_value("Report", report, "module")
		if module and module != MODULE:
			if _report_code_shipped(report):
				frappe.db.set_value("Report", report, "module", MODULE, update_modified=False)
			else:
				_logger().warning(f"ToDoBox: report {report} stays in {module}: its code is not in ToDoBox")

	for field in _shared_fields() + _per_doctype_trace_fields():
		if not field.module:
			frappe.db.set_value("Custom Field", field.name, "module", MODULE, update_modified=False)


def release_workflow_ownership():
	"""ToDoBox is being uninstalled and Frappe drops the tables of the doctypes in its module.

	The two doctypes stay on the site as custom doctypes (a reinstall claims them back) and the trace fields
	stay on their documents, so the trace rows are kept and remain visible. The other field definitions are
	removed by the uninstall; their columns stay."""
	for doctype in SHARED_DOCTYPES:
		if frappe.db.get_value("DocType", doctype, "module") == MODULE:
			frappe.db.set_value("DocType", doctype, {"module": "Custom", "custom": 1}, update_modified=False)
			frappe.clear_cache(doctype=doctype)

	for field in _per_doctype_trace_fields():
		if field.module == MODULE:
			frappe.db.set_value("Custom Field", field.name, "module", None, update_modified=False)


# ------------------------------------------------------------------ custom fields
def setup_custom_fields():
	"""Creates the fields (or updates them to the definitions above). Unless a definition says otherwise
	they are hidden and read-only on the Desk forms, which look as they did before ToDoBox; the app writes
	them server-side."""
	fields = {
		dt: [
			{
				"hidden": 0 if dt in SHARED_FIELDS else 1,
				"read_only": 0 if dt in SHARED_FIELDS else 1,
				**df,
				"module": MODULE,
			}
			for df in dfs
		]
		for dt, dfs in CUSTOM_FIELDS.items()
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
