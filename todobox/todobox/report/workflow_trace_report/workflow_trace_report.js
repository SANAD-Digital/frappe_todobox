// Copyright (c) 2022, Champion and contributors
// For license information, please see license.txt
/* eslint-disable */

frappe.query_reports["Workflow Trace Report"] = {
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
		{"fieldname":"employee",
		 "label": __("Employee"),
		 "fieldtype": "Link",
		  "options":"Employee"
		
		},
		{
			"fieldname": 'department',
			"label": __('Department'),
			"fieldtype": 'Link',
			"options": "Department",
		},
		{
			"fieldname": 'designation',
			"label": __('Designation'),
			"fieldtype": 'Link',
			"options": "Designation",
		},
		{
			"fieldname": 'branch',
			"label": __('Branch'),
			"fieldtype": 'Link',
			"options": "Branch",
		},
	]
};
