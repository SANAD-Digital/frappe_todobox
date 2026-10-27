app_name = "todobox"
app_title = "ToDoBox"
app_publisher = "SANAD Digital"
app_description = "Inbox-style task management (ToDo, workflow actions, automation) for Frappe"
app_email = "dev@sanad.digital"
app_license = "agpl-3.0"

# Apps screen (/apps)
add_to_apps_screen = [
	{
		"name": "todobox",
		"logo": "/assets/todobox/images/todobox.svg",
		"title": "ToDoBox",
		"route": "/todobox",
	}
]

# Standalone UI: www/todobox handles every /todobox/* client route
website_route_rules = [
	{"from_route": "/todobox/<path:app_path>", "to_route": "todobox"},
]

# Installation / migration / uninstall (todobox/setup/install.py): custom fields on ToDo and Comment,
# indexes, default templates. Desktop icon and desk sidebar are declarative (desktop_icon/, workspace_sidebar/)
after_install = "todobox.setup.install.after_install"
after_migrate = "todobox.setup.install.after_migrate"
before_uninstall = "todobox.setup.install.before_uninstall"
after_uninstall = "todobox.setup.install.after_uninstall"

# Desk: remember the Desk's typeface (incl. a theme's) so /todobox renders with the same font
app_include_js = ["/assets/todobox/js/desk_font.js"]

# ToDo desk form: fill the checklist from a ToDoBox Task Template
doctype_js = {"ToDo": "public/js/todo.js"}

# Multi-company privacy (ERPNext): task templates belong to their creator's company (services/org.py)
permission_query_conditions = {
	"ToDoBox Task Template": "todobox.services.org.template_query_conditions",
}
has_permission = {
	"ToDoBox Task Template": "todobox.services.org.template_has_permission",
}

doc_events = {
	"ToDo": {
		"before_insert": "todobox.services.automation.apply_rules",
		"validate": "todobox.services.analytics.stamp_completed_on",
		"after_insert": [
			"todobox.services.notifications.on_todo_after_insert",
			"todobox.services.live.on_todo_change",
		],
		"on_update": [
			"todobox.services.tags.sync_todo_tags",
			"todobox.services.live.on_todo_change",
		],
		"on_trash": "todobox.services.live.on_todo_change",
	},
	"Comment": {
		"after_insert": "todobox.services.live.on_comment_insert",
	},
	"*": {
		"on_update": "todobox.services.workflow_notify.on_workflow_change",
		"on_update_after_submit": "todobox.services.workflow_notify.on_workflow_change",
		"on_cancel": "todobox.services.workflow_notify.on_workflow_change",
	},
}

scheduler_events = {
	"daily": ["todobox.services.automation.run_due_recurring"],
}
