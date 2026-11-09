		
// Copyright (c) 2023, ToDoBox contributors
// For license information, please see license.txt
/* eslint-disable */

frappe.query_reports["Employee wise Workflow Action"] = {
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
				"fieldname":"report_option",
				"label": __("Option", null, "ToDoBox"),
				"fieldtype": "Select",
				"options": ["", {"value": "Me", "label": __("Me")}, {"value": "My Team", "label": __("My Team")}, {"value": "All", "label": __("All")}],
				"default": "Me"
			},
			{
				"fieldname":"employee",
				"label": __("Employee"),
				"fieldtype": "Link",
				"options":"Employee",
				"depends_on": "eval:doc.report_option=='My Team' || doc.report_option=='All'"
				
			},
			{
				"fieldname":"department",
				"label":__("Department"),
				"fieldtype":"Link",
				"options":"Department",
				"depends_on": "eval:doc.report_option=='My Team' || doc.report_option=='All'"
				
			},
			{
				"fieldname":"branch",
				"label":__("Branch"),
				"fieldtype":"Link",
				"options":"Branch",
				"depends_on": "eval:doc.report_option=='My Team' || doc.report_option=='All'"
				
			},
			{
				"fieldname":"designation",
				"label":__("Designation"),
				"fieldtype":"Link",
				"options":"Designation",
				"depends_on": "eval:doc.report_option=='My Team' || doc.report_option=='All'"
				
			}
	
	

	]
};
