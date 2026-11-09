/* ToDoBox Desk: "Add User" on a Workflow transition.
   Offers the document's Link -> User fields and appends the choice to todobox_users_by_doc_field. */
(function () {
	"use strict";

	if (window.__todobox_wf_form_loaded || !window.frappe || !frappe.ui.form) return;
	window.__todobox_wf_form_loaded = true;

	frappe.ui.form.on("Workflow Transition", {
		todobox_add_user(frm, cdt, cdn) {
			if (!frm.doc.document_type) {
				frappe.msgprint(__("Please set Document Type first.", null, "ToDoBox"));
				return;
			}

			frappe.model.with_doctype(frm.doc.document_type, () => {
				const user_fields = frappe.meta
					.get_docfields(frm.doc.document_type)
					.filter((df) => df.fieldtype === "Link" && df.options === "User")
					.map((df) => df.fieldname);

				if (!user_fields.length) {
					frappe.msgprint(__("{0} has no field linked to User.", [__(frm.doc.document_type)], "ToDoBox"));
					return;
				}

				const dialog = new frappe.ui.Dialog({
					title: __("Add User", null, "ToDoBox"),
					fields: [
						{
							fieldtype: "Select",
							label: __("User"),
							fieldname: "user",
							options: user_fields,
							reqd: 1,
						},
					],
					primary_action(values) {
						dialog.hide();
						const row = locals[cdt][cdn];
						const current = (row.todobox_users_by_doc_field || "").trim();
						const parts = current ? current.split(",").map((part) => part.trim()) : [];
						if (parts.includes(values.user)) return;
						parts.push(values.user);
						frappe.model.set_value(cdt, cdn, "todobox_users_by_doc_field", parts.join(","));
					},
				});
				dialog.show();
			});
		},
	});
})();
