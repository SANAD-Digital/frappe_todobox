"""Install / migrate / uninstall hooks: custom fields on ToDo and Comment, indexes, default templates,
desk artifacts.

Everything here is idempotent and safe to re-run.

Custom field ownership: the ToDo/Comment fields below were first added by predecessor apps (frappe_taskmail,
todo_tool) under the same fieldnames. Frappe's uninstall deletes every Custom Field / Property Setter whose
`module` belongs to the removed app, so ToDoBox claims the rows (module = "ToDoBox", Link options repointed
to ToDoBox DocTypes) on install and on every migrate, and again right before a predecessor is uninstalled
(before_app_uninstall). When ToDoBox itself is uninstalled, fields a still-installed predecessor also defines
are handed back to it instead of being deleted.
"""

import json

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from todobox.services.common import CHECKLIST_ITEM_DOCTYPE, TEMPLATE_DOCTYPE

MODULE = "ToDoBox"

CUSTOM_FIELDS = {
	"ToDo": [
		# own subject field: the title must not depend on another app (e.g. gcrm_subject)
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
}

DEFAULT_TASK_TEMPLATES = [
	{
		"template_name": "متابعة عميل",
		"subject": "متابعة عميل بعد إرسال العرض",
		"description": "مكالمة متابعة، تحديث حالة الفرصة، وتسجيل ملاحظات العميل.",
		"priority": "Medium",
		"checklist": ["مكالمة أولى وتسجيل الملاحظات", "تحديث حالة الفرصة في CRM", "جدولة المتابعة التالية"],
	},
	{
		"template_name": "مراجعة فاتورة",
		"subject": "مراجعة فاتورة قبل الترحيل",
		"description": "تحقّق من الكميات، الأسعار، ضريبة القيمة المضافة، وأمر الشراء المرتبط.",
		"priority": "High",
		"checklist": [
			"مطابقة الكميات مع إشعار الاستلام",
			"التحقق من الأسعار وأمر الشراء",
			"مراجعة ضريبة القيمة المضافة",
			"الترحيل والأرشفة",
		],
	},
	{
		"template_name": "جرد مستودع",
		"subject": "جرد بنود المستودع",
		"description": "جرد فعلي للبنود المحددة ومقارنته بأرصدة النظام.",
		"priority": "Medium",
		"checklist": ["طباعة كشف الأرصدة", "الجرد الفعلي بالرفوف", "حصر الفروقات", "إعداد قيد التسوية"],
	},
	{
		"template_name": "إغلاق شهري",
		"subject": "إجراءات الإغلاق المحاسبي الشهري",
		"description": "قائمة الإغلاق المعتمدة — تُنفّذ في أول ثلاثة أيام عمل من الشهر.",
		"priority": "High",
		"checklist": [
			"مطابقة الحسابات البنكية",
			"مطابقة كشوف الموردين",
			"قيود الاستحقاق والإهلاك",
			"مراجعة المخزون والتكلفة",
			"إقرار ضريبة القيمة المضافة",
			"إصدار القوائم الأولية",
		],
	},
	{
		"template_name": "إقرار ضريبي",
		"subject": "إعداد إقرار ضريبة القيمة المضافة",
		"description": "الإقرار الربعي — يُرفع قبل اليوم 28 من الشهر التالي للربع.",
		"priority": "High",
		"checklist": [
			"استخراج تقرير المخرجات",
			"استخراج تقرير المدخلات",
			"تسوية الفروقات",
			"الرفع على منصة هيئة الزكاة والضريبة",
		],
	},
]


# Composite indexes on core ToDo columns used by every folder query (allocated_to/assigned_by + status)
TODO_INDEXES = {
	"todobox_allocated_status": ("allocated_to", "status"),
	"todobox_assigned_status": ("assigned_by", "status"),
}

# Predecessor apps that define the same ToDo/Comment fieldnames. On ToDoBox uninstall, shared fields are
# handed back to the first one still installed (module + Link options as that app defines them).
PREDECESSORS = {
	"frappe_taskmail": {
		"module": "TaskMail",
		"fields": None,  # all of ToDoBox's fields
		"options": {"task_template": "TaskMail Task Template", "checklist_items": "TaskMail Checklist Item"},
	},
	"todo_tool": {
		"module": None,  # todo_tool creates its fields without a module
		"fields": {
			"thread_id", "parent_todo", "completed_on", "cc_users", "read_by", "snooze_until", "snooze_rule",
			"labels", "forwarded_from", "task_template", "checklist_items", "day_order", "rule_applied", "is_reply",
		},
		"options": {"task_template": "ToDo Task Template", "checklist_items": "ToDo Checklist Item"},
	},
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
def before_install():
	if not frappe.db.exists("DocType", "ToDo"):
		frappe.throw("ToDoBox needs Frappe's ToDo DocType")


def after_install():
	setup_custom_fields()
	frappe.db.commit()
	_safe("indexes", setup_indexes)
	_safe("import legacy data", import_legacy_data)
	_safe("seed task templates", seed_task_templates)
	_safe("backfill completed_on", backfill_completed_on)


def after_migrate():
	setup_custom_fields()
	frappe.db.commit()
	_safe("indexes", setup_indexes)
	_safe("backfill completed_on", backfill_completed_on)


def before_app_uninstall(app_name):
	"""Any app is being uninstalled: when it is a predecessor, re-claim the shared fields first so its
	module deletion leaves them (and their data) alone."""
	if app_name in PREDECESSORS and APP_NAME in frappe.get_installed_apps():
		setup_custom_fields()
		frappe.db.commit()


def before_uninstall():
	_safe("release custom fields", release_custom_fields)


def after_uninstall():
	_safe("drop indexes", drop_indexes)
	_safe("remove desk artifacts", remove_desk_artifacts)
	frappe.clear_cache()


def import_legacy_data():
	"""Data of the predecessor apps (install marks all patches as done, so the patch is run here too)."""
	from todobox.patches.v0_2.import_legacy_data import execute

	execute()


# ------------------------------------------------------------------ custom fields
def setup_custom_fields():
	"""Creates the fields, or takes over existing ones (same fieldname from a predecessor app)."""
	fields = {dt: [{**df, "module": MODULE} for df in dfs] for dt, dfs in CUSTOM_FIELDS.items()}
	create_custom_fields(fields, ignore_validate=True)


def _custom_field_owner(fieldname):
	"""The first installed predecessor app that also defines this fieldname, else None."""
	installed = set(frappe.get_installed_apps())
	for app, spec in PREDECESSORS.items():
		if app in installed and (spec["fields"] is None or fieldname in spec["fields"]):
			return app, spec
	return None, None


def release_custom_fields():
	"""ToDoBox is being uninstalled: hand shared fields back to a still-installed predecessor, delete the
	rest (only the field definitions; Frappe keeps the table columns, so a reinstall gets the data back)."""
	for dt, dfs in CUSTOM_FIELDS.items():
		for df in dfs:
			name = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": df["fieldname"], "module": MODULE})
			if not name:
				continue
			app, spec = _custom_field_owner(df["fieldname"])
			if app:
				values = {"module": spec["module"]}
				option = spec["options"].get(df["fieldname"])
				if option and frappe.db.exists("DocType", option):
					values["options"] = option
				frappe.db.set_value("Custom Field", name, values, update_modified=False)
			else:
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
	"""Creates the default task templates once, when the site has none."""
	if frappe.db.count(TEMPLATE_DOCTYPE):
		return

	from todobox.services.checklist import normalize_checklist, set_checklist

	for tpl in DEFAULT_TASK_TEMPLATES:
		doc = frappe.new_doc(TEMPLATE_DOCTYPE)
		doc.update({k: v for k, v in tpl.items() if k != "checklist"})
		set_checklist(doc, normalize_checklist(tpl["checklist"]), fieldname="checklist")
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
