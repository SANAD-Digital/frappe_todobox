// Copyright (c) 2022, Champion and contributors
// For license information, please see license.txt
/* eslint-disable */

frappe.query_reports["Workflow Action Report"] = {
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
			fieldname: 'employee',
			label: __('Employee'),
			fieldtype: 'Link',
			"options": "Employee",
		},
		{
			fieldname: 'workflow_state',
			label: __('Workflow State', null, "ToDoBox"),
			fieldtype: 'MultiSelectList',
			get_data: function(txt) {
				return frappe.db.get_link_options('Workflow State', txt, {
				});
			}		
		},
		{
			fieldname: 'docType',
			label: __('DocType'),
			fieldtype: 'MultiSelectList',
			get_data: function(txt) {
				return frappe.db.get_link_options('DocType', txt, {
				});
			}		
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
			
	],
};
