"""Stable public endpoints: todobox.api.<method>.

The logic lives in todobox.services.*; this module only re-exports the whitelisted methods
so the URLs used by the UI stay stable.
"""

from todobox.services.analytics import get_analytics
from todobox.services.checklist import (
	add_checklist_item,
	apply_task_template,
	remove_checklist_item,
	toggle_checklist_item,
)
from todobox.services.day_plan import drop_from_day, get_day_plan, reorder_day
from todobox.services.language import get_languages, set_my_language
from todobox.services.doc_actions import (
	add_reference_comment,
	get_doc_actions,
	get_reference_detail,
	run_doc_action,
)
from todobox.services.notifications import (
	create_notification,
	get_notifications,
	mark_all_notifs_read,
	mark_notif_read,
)
from todobox.services.query import count_queries, delete_view, get_saved_views, save_view
from todobox.services.tags import search_tags
from todobox.services.team import get_workload, search_users
from todobox.services.templates import delete_task_template, get_task_templates, save_task_template
from todobox.services.todos import (
	add_comment,
	apply_workflow_action,
	create_todos,
	discard_upload,
	forward_todo,
	get_counts,
	get_todo,
	get_todo_folder,
	get_workflow_items,
	list_todos,
	remind_todo,
	snooze_todo,
	unsnooze_todo,
	update_todo,
)
from todobox.services.users import get_active_users

__all__ = [
	"add_checklist_item",
	"add_comment",
	"add_reference_comment",
	"apply_task_template",
	"apply_workflow_action",
	"count_queries",
	"create_notification",
	"create_todos",
	"delete_task_template",
	"delete_view",
	"discard_upload",
	"drop_from_day",
	"forward_todo",
	"get_active_users",
	"get_languages",
	"get_analytics",
	"get_counts",
	"get_day_plan",
	"get_doc_actions",
	"get_notifications",
	"get_reference_detail",
	"get_saved_views",
	"get_task_templates",
	"get_todo",
	"get_todo_folder",
	"get_workflow_items",
	"get_workload",
	"list_todos",
	"mark_all_notifs_read",
	"mark_notif_read",
	"remind_todo",
	"remove_checklist_item",
	"reorder_day",
	"run_doc_action",
	"save_task_template",
	"save_view",
	"search_tags",
	"search_users",
	"set_my_language",
	"snooze_todo",
	"toggle_checklist_item",
	"unsnooze_todo",
	"update_todo",
]
