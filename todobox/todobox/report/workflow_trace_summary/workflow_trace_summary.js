// Copyright (c) 2023, ToDoBox contributors
// For license information, please see license.txt
/* eslint-disable */


frappe.query_reports["Workflow Trace Summary"] = {
	"filters": [
		{
			"fieldname":"from_date",
			"label": __("From"),
			"fieldtype": "Date",
			"default": frappe.datetime.add_months(frappe.datetime.get_today(), -1),
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
		{
			"fieldname": 'show_open',
			"label": __('Show Open'),
			"fieldtype": 'Check',
		},
		{
			"fieldname": 'today_completed',
			"label": __("Today's Completed Transactions", null, "ToDoBox"),
			"fieldtype": 'Check',

		}
			

]
};