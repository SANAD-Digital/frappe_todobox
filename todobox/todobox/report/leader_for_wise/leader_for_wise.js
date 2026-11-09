// Copyright (c) 2023, ToDoBox contributors
// For license information, please see license.txt
/* eslint-disable */

frappe.query_reports["Leader For Wise"] = {
	"filters": [
			{
				"fieldname":"from_date",
				"label": __("From"),
				"fieldtype": "Date",
				"default": frappe.datetime.get_today(),
				"reqd": 1
			},
			{
				"fieldname":"to_date",
				"label": __("To"),
				"fieldtype": "Date",
				"default": frappe.datetime.get_today(),
				"reqd": 1
			},
			{
				"fieldname":"employee",
				"label": __("Employee"),
				"fieldtype": "Link",
				"options":"Employee"
			},
			{
				"fieldname":"report_option",
				"label": __("Option", null, "ToDoBox"),
				"fieldtype": "Select",
				"options": ["", {"value": "Me", "label": __("Me")}, {"value": "My Team", "label": __("My Team")}, {"value": "All", "label": __("All")}],
				"default": "Me"
			},
	

	]
};
