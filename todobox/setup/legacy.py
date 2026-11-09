"""Sites that ran the earlier workflow add-on before ToDoBox: its field names, modules and leftover fields move
to ToDoBox's own, once, keeping their data. Nothing else in ToDoBox uses these old names.

Idempotent and cheap when there is nothing left to move. Runs before ToDoBox creates its fields, so the data
keeps its column instead of landing next to an empty new one.
"""

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
}

TABLE_TYPES = ("Table", "Table MultiSelect")


def _ours(module) -> bool:
	"""A field another app or the site owns stays as it is."""
	return not module or module == MODULE or module in OLD_MODULES


def migrate_legacy_workflow():
	if OLD_APP in frappe.get_installed_apps():
		# its fixtures would bring the old fields back: it has to be uninstalled first
		frappe.log_error(
			title="ToDoBox: uninstall the earlier workflow add-on",
			message=f"{OLD_APP} is installed on this site; its workflow data was not moved to ToDoBox.",
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
