"""Sites that ran the earlier workflow add-on before ToDoBox: its field names, modules and leftover fields move
to ToDoBox's own, once, keeping their data. Nothing else in ToDoBox uses these old names.

Idempotent and cheap when there is nothing left to move. Runs before ToDoBox creates its fields, so the data
keeps its column instead of landing next to an empty new one.

While both apps are installed the add-on keeps its fields (its fixtures would bring them back). The move happens
when it is uninstalled (before_app_uninstall), before Frappe deletes what belongs to its module: its fields and
property setters, and its DocTypes with their tables. What holds data stays:
- its fields move to ToDoBox's (above); the Workflow Trace, Permitted User and Doctype Update Condition tables
  become ToDoBox's (install.SHARED_DOCTYPES);
- its other DocTypes that hold rows (Share Tool, ...) stay as custom DocTypes;
- the role it hid the progress bar from becomes ToDoBox's setting;
- records the site made in its module (reports, print formats, scripts, notifications, ...) move to "Custom".
On a site where the add-on was uninstalled before ToDoBox came, the columns it left are read once
(repair_orphaned_data).
"""

import json
import os

import frappe
from frappe.model.utils.rename_field import update_property_setters, update_reports, update_user_settings

MODULE = "ToDoBox"
OLD_APP = "snd_workflow"
# MariaDB compares these case-insensitively, Postgres does not
OLD_MODULES = ("Snd Workflow", "SND Workflow")

RENAMED = {
	"Workflow": {"snd_wf_has_wf_trace": "todobox_has_wf_trace"},
	"Workflow Transition": {
		"snd_wf_add_user": "todobox_add_user",
		"snd_wf_users_by_doc_field": "todobox_users_by_doc_field",
		"snd_wf_use_and_condition": "todobox_use_and_condition",
		"snd_wf_use_and_condition_between_users": "todobox_use_and_condition_between_users",
	},
	"Workflow Document State": {"snd_sbdma_condition": "todobox_statusbar_condition"},
	"Workflow State": {"snd_wf_hide_in_report": "todobox_hide_in_report"},
	"Workflow Action": {
		"snd_wf_permitted_users": "todobox_permitted_users",
		"snd_wf_permitted_users_count": "todobox_permitted_users_count",
	},
}
# on every document type whose workflow keeps a trace
TRACE_FIELD = ("snd_wf_trace", "todobox_wf_trace")

# definitions with no effect: removed. Their columns, and whatever they hold, stay until `bench trim-tables`
UNUSED = {
	"Workflow": (
		"snd_wf_show_progress_button", "snd_wf_show_next_actions_button", "snd_wf_cb1", "snd_wf_channel",
		"snd_wf_send_system_notification", "snd_wf_next_action_email_template",
	),
	"Workflow Transition": ("snd_wf_cb2", "snd_wf_na_description", "snd_wf_escalated_transaction"),
	"Workflow Action": ("snd_wf_reference_creation", "snd_wf_reference_owner"),
	# its value stays in the Singles table
	"System Settings": ("snd_wf_notification_template_",),
}

TABLE_TYPES = ("Table", "Table MultiSelect")


def _ours(module) -> bool:
	"""A field another app or the site owns stays as it is."""
	return not module or module == MODULE or module in OLD_MODULES


def migrate_legacy_workflow(force=False):
	"""force: the add-on is being uninstalled (its fixtures will not come back)."""
	if not force and OLD_APP in frappe.get_installed_apps():
		# its fixtures would bring the old fields back: it has to be uninstalled first
		frappe.log_error(
			title="ToDoBox: uninstall the earlier workflow add-on",
			message=f"{OLD_APP} is installed on this site; its workflow data moves to ToDoBox when it is uninstalled.",
		)
		return

	for dt, fields in RENAMED.items():
		for old, new in fields.items():
			_rename(dt, old, new)
	for dt in frappe.get_all("Custom Field", filters={"fieldname": TRACE_FIELD[0]}, pluck="dt"):
		_rename(dt, *TRACE_FIELD)

	for field in frappe.get_all(
		"Custom Field", filters={"module": ("in", OLD_MODULES)}, fields=["name", "fieldname"]
	):
		if field.fieldname in ("section_workflow_trace", "main_data"):
			frappe.db.set_value("Custom Field", field.name, "module", MODULE, update_modified=False)

	for dt, fieldnames in UNUSED.items():
		for field in frappe.get_all(
			"Custom Field", filters={"dt": dt, "fieldname": ("in", fieldnames)}, fields=["name", "module"]
		):
			if _ours(field.module):
				frappe.delete_doc("Custom Field", field.name, ignore_permissions=True, force=True)


def _rename(dt, old, new):
	cf = frappe.db.get_value(
		"Custom Field", {"dt": dt, "fieldname": old}, ["name", "fieldtype", "options", "module"], as_dict=True
	)
	if not cf or not _ours(cf.module):
		return

	table = cf.fieldtype in TABLE_TYPES
	if table:
		child = (cf.options or "").split("\n", 1)[0]
		if child and frappe.db.table_exists(child):
			frappe.db.sql(
				f"update `tab{child}` set parentfield=%s where parenttype=%s and parentfield=%s", (new, dt, old)
			)

	if frappe.db.exists("Custom Field", {"dt": dt, "fieldname": new}):
		# both exist: the data goes to the new field where it is empty, the old definition goes
		if not table and frappe.db.has_column(dt, old) and frappe.db.has_column(dt, new):
			frappe.db.sql(
				f"update `tab{dt}` set `{new}`=`{old}` where `{old}` is not null and ifnull(`{new}`, '') in ('', '0')"
			)
		frappe.delete_doc("Custom Field", cf.name, ignore_permissions=True, force=True)
	else:
		if not table and frappe.db.has_column(dt, old):
			frappe.db.sql_ddl(f"alter table `tab{dt}` rename column `{old}` to `{new}`")
		frappe.db.sql(
			"update `tabCustom Field` set name=%s, fieldname=%s, module=%s where name=%s",
			(f"{dt}-{new}", new, MODULE, cf.name),
		)

	frappe.db.sql("update `tabCustom Field` set insert_after=%s where dt=%s and insert_after=%s", (new, dt, old))
	for prop in ("depends_on", "mandatory_depends_on", "read_only_depends_on"):
		frappe.db.sql(
			f"update `tabCustom Field` set `{prop}`=replace(`{prop}`, %s, %s) where dt=%s and `{prop}` like %s",
			(old, new, dt, f"%{old}%"),
		)
	update_property_setters(dt, old, new)
	update_user_settings(dt, old, new)
	if not table:
		update_reports(dt, old, new)
	frappe.clear_cache(doctype=dt)


# ------------------------------------------------------------------ the add-on is being uninstalled
CUSTOM_MODULE = "Custom"
# records that are only the add-on's layout or its own code: they go with it
NOT_KEPT_PROPERTIES = ("field_order",)


def before_old_app_uninstall():
	"""Frappe is about to delete everything in the add-on's module. Raises (stopping the uninstall) if the shared
	tables could not be secured, so no table is dropped with its data."""
	from todobox.setup.install import SHARED_DOCTYPES, claim_workflow_ownership

	migrate_legacy_workflow(force=True)
	claim_workflow_ownership()
	for doctype in SHARED_DOCTYPES:
		if frappe.db.get_value("DocType", doctype, "module") in OLD_MODULES:
			frappe.throw(f"ToDoBox could not take over the {doctype} table; the uninstall was stopped to keep its data.")
	_keep_own_doctypes()
	_keep_site_records()
	_keep_progress_hidden_role()
	frappe.db.commit()


# the add-on hid the progress bar from this role (hard-coded); ToDoBox makes it a setting
OLD_HIDDEN_ROLE = "Trader"


def _keep_progress_hidden_role():
	if not frappe.db.exists("Role", OLD_HIDDEN_ROLE) or not frappe.db.table_exists("ToDoBox Hidden Role"):
		return
	settings = frappe.get_single("ToDoBox Settings")
	if OLD_HIDDEN_ROLE not in {r.role for r in settings.get("progress_hidden_roles") or []}:
		settings.append("progress_hidden_roles", {"role": OLD_HIDDEN_ROLE})
		settings.flags.ignore_permissions = True
		settings.save()


def _old_app_path():
	try:
		return frappe.get_app_path(OLD_APP)
	except Exception:
		return None


def _shipped_names():
	"""(doctype, name) of what the add-on brings itself: its fixtures and the documents exported in its modules."""
	path, shipped = _old_app_path(), set()
	if not path:
		return shipped
	for file in ("custom_field.json", "property_setter.json"):
		full = os.path.join(path, "fixtures", file)
		if os.path.exists(full):
			for d in json.load(open(full)):
				shipped.add((d.get("doctype"), d.get("name")))
	return shipped


def _exported(doctype, name, module) -> bool:
	path = _old_app_path()
	if not path:
		return False
	folder = frappe.scrub(name)
	return os.path.exists(os.path.join(path, frappe.scrub(module), frappe.scrub(doctype), folder, f"{folder}.json"))


def _keep_own_doctypes():
	"""Its DocTypes holding rows stay as custom DocTypes (data kept, readable in the Desk; no code runs on them).
	Empty ones go with the add-on."""
	from todobox.setup.install import SHARED_DOCTYPES

	doctypes = frappe.get_all(
		"DocType", filters={"module": ("in", OLD_MODULES)}, fields=["name", "istable", "issingle", "custom"]
	)
	keep = set()
	for d in doctypes:
		if d.name in SHARED_DOCTYPES:
			continue
		if d.custom or (not d.issingle and frappe.db.table_exists(d.name) and frappe.db.count(d.name)):
			keep.add(d.name)
	# a parent kept keeps its child tables
	for d in doctypes:
		if d.name in keep:
			for child in frappe.get_all(
				"DocField", filters={"parent": d.name, "fieldtype": ("in", TABLE_TYPES)}, pluck="options"
			):
				if child in {x.name for x in doctypes}:
					keep.add(child)
	for name in keep:
		frappe.db.set_value("DocType", name, {"module": CUSTOM_MODULE, "custom": 1}, update_modified=False)
		frappe.clear_cache(doctype=name)


def _keep_site_records():
	"""What the site made in the add-on's module (not shipped by it) moves out of it instead of being deleted."""
	from frappe.installer import _get_module_linked_doctype_field_map

	shipped = _shipped_names()
	for doctype, field in _get_module_linked_doctype_field_map().items():
		meta = frappe.get_meta(doctype)
		for r in frappe.get_all(doctype, filters={field: ("in", OLD_MODULES)}, fields=["name", field]):
			if (doctype, r.name) in shipped or _exported(doctype, r.name, r.get(field)):
				continue
			if doctype == "Property Setter" and frappe.db.get_value(doctype, r.name, "property") in NOT_KEPT_PROPERTIES:
				continue
			# fields and property setters belong to no module on a site; other records to "Custom"
			target = None if doctype in ("Custom Field", "Property Setter") and not meta.get_field(field).reqd else CUSTOM_MODULE
			frappe.db.set_value(doctype, r.name, field, target, update_modified=False)


# ------------------------------------------------------------------ the add-on was uninstalled before ToDoBox
REPAIRED_FLAG = "todobox_legacy_columns_read"


def repair_orphaned_data():
	"""The add-on's field definitions are gone but its columns and rows are still there: child rows move to
	ToDoBox's fields (each time: nothing else writes them), column values are read once into ToDoBox's empty fields
	(once: a value cleared later stays cleared). Runs after ToDoBox's fields exist."""
	if OLD_APP in frappe.get_installed_apps():
		return
	first = not frappe.db.get_default(REPAIRED_FLAG)
	for dt, fields in RENAMED.items():
		for old, new in fields.items():
			if frappe.db.exists("Custom Field", {"dt": dt, "fieldname": old}):
				continue
			cf = frappe.db.get_value("Custom Field", {"dt": dt, "fieldname": new}, ["fieldtype", "options"], as_dict=True)
			if not cf:
				continue
			if cf.fieldtype in TABLE_TYPES:
				if cf.options and frappe.db.table_exists(cf.options):
					frappe.db.sql(
						f"update `tab{cf.options}` set parentfield=%s where parenttype=%s and parentfield=%s",
						(new, dt, old),
					)
			elif first and frappe.db.has_column(dt, old) and frappe.db.has_column(dt, new):
				frappe.db.sql(
					f"update `tab{dt}` set `{new}`=`{old}` where `{old}` is not null and ifnull(`{new}`, '') in ('', '0')"
				)
	_repair_trace_rows()
	if first:
		frappe.db.set_default(REPAIRED_FLAG, 1)


def _repair_trace_rows():
	"""Trace rows still under the old field: their document type gets ToDoBox's trace field and the rows move to it."""
	old, new = TRACE_FIELD
	if not frappe.db.table_exists("Workflow Trace"):
		return
	for dt in frappe.db.sql_list(
		"select distinct parenttype from `tabWorkflow Trace` where parentfield=%s", (old,)
	):
		if not frappe.db.exists("DocType", dt) or frappe.db.exists("Custom Field", {"dt": dt, "fieldname": old}):
			continue
		if not frappe.get_meta(dt).get_field(new):
			from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

			create_custom_fields(
				{
					dt: [
						{"fieldname": "section_workflow_trace", "label": "Workflow Trace", "fieldtype": "Section Break", "collapsible": 1, "module": MODULE},
						{
							"fieldname": new, "label": "Workflow Trace", "fieldtype": "Table", "options": "Workflow Trace",
							"read_only": 1, "allow_on_submit": 1, "no_copy": 1, "insert_after": "section_workflow_trace", "module": MODULE,
						},
					]
				},
				ignore_validate=True,
			)
		frappe.db.sql(
			"update `tabWorkflow Trace` set parentfield=%s where parenttype=%s and parentfield=%s", (new, dt, old)
		)
		frappe.clear_cache(doctype=dt)
