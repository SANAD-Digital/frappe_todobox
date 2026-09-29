// ToDo form: picking a ToDoBox Task Template fills the checklist (Table MultiSelect) with its steps
// Table MultiSelect has no grid, but the form timeline reads fields_dict[field].grid.doctype
// for row changes (a Version with row_changed) → TypeError. A minimal grid stub fixes the timeline.
function stub_multiselect_grids(frm) {
	Object.values(frm.fields_dict || {}).forEach((field) => {
		if (field.df && field.df.fieldtype === "Table MultiSelect" && !field.grid) {
			field.grid = { doctype: field.df.options, get_selected: () => [], grid_rows: [], grid_rows_by_docname: {} };
		}
	});
}

frappe.ui.form.on("ToDo", {
	setup: stub_multiselect_grids,
	onload: stub_multiselect_grids,
	refresh: stub_multiselect_grids,
	task_template(frm) {
		const template = frm.doc.task_template;
		if (!template) return;

		frappe.db.get_doc("ToDoBox Task Template", template).then((tpl) => {
			const existing = (frm.doc.checklist_items || []).map((row) => row.step);
			(tpl.checklist || []).forEach((row) => {
				if (!existing.includes(row.step)) {
					frm.add_child("checklist_items", { step: row.step });
				}
			});
			frm.refresh_field("checklist_items");

			if (!frm.doc.description && (tpl.subject || tpl.description)) {
				const parts = [tpl.subject, tpl.description].filter(Boolean);
				frm.set_value("description", parts.map((p) => `<p>${frappe.utils.escape_html(p)}</p>`).join(""));
			}
			if (tpl.priority && frm.is_new()) {
				frm.set_value("priority", tpl.priority);
			}
		});
	},
});
