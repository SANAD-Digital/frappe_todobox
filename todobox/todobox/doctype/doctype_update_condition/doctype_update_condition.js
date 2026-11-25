// Copyright (c) 2026, SANAD Digital and contributors
// For license information, please see license.txt

/* The two condition lists are edited with Frappe's filter builder (the one of list views), on the chosen
   document type and its child tables, and stored as [[doctype, field, operator, value], ...]. */
frappe.ui.form.on("Doctype Update Condition", {
	refresh(frm) {
		frm.trigger("render_filters");
	},
	/* the builders are read again on save: not every edit (e.g. the operator) fires their on_change */
	validate(frm) {
		Object.entries(frm._tbx_groups || {}).forEach(([data, group]) => {
			frm.doc[data] = JSON.stringify(group.get_filters().map((f) => f.slice(0, 4)));
		});
	},
	doc_type(frm) {
		frm.set_value("filters_data", "[]");
		frm.set_value("mandatory_data", "[]");
		frm.trigger("render_filters");
	},
	render_filters(frm) {
		[
			["filters_html", "filters_data"],
			["mandatory_html", "mandatory_data"],
		].forEach(([html, data]) => {
			frm._tbx_groups = frm._tbx_groups || {};
			delete frm._tbx_groups[data];
			const $wrapper = frm.get_field(html).$wrapper.empty();
			if (!frm.doc.doc_type) return;
			frappe.model.with_doctype(frm.doc.doc_type, () => {
				const sync = () => {
					const value = JSON.stringify(group.get_filters().map((f) => f.slice(0, 4)));
					if (value !== JSON.stringify(JSON.parse(frm.doc[data] || "[]"))) frm.set_value(data, value);
				};
				const group = new frappe.ui.FilterGroup({
					parent: $("<div>").appendTo($wrapper),
					doctype: frm.doc.doc_type,
					on_change: sync,
				});
				// an operator or value edited in place: on_change does not always fire
				$wrapper.on("change", "select, input", () => setTimeout(sync, 50));
				let rows = [];
				try {
					rows = JSON.parse(frm.doc[data] || "[]");
				} catch (e) {
					rows = [];
				}
				group.add_filters_to_filter_group(rows);
				frm._tbx_groups[data] = group;
			});
		});
	},
});
