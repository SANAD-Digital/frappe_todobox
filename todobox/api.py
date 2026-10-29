"""Stable public endpoints: todobox.api.<method>.

The logic lives in todobox.services.*; this module only re-exports the whitelisted methods
so the URLs used by the UI stay stable.
"""

from todobox.services.analytics import get_analytics
from todobox.services.checklist import (
	add_checklist_item,
	remove_checklist_item,
	toggle_checklist_item,
)
from todobox.services.calendar import get_calendar
from todobox.services.day_plan import drop_from_day, get_day_plan, reorder_day
from todobox.services.language import set_my_language
from todobox.services.live import get_pulse
from todobox.services.doc_actions import (
	add_reference_comment,
	get_doc_actions,
	get_reference_detail,
)
from todobox.services.notifications import (
	get_notifications,
	mark_all_notifs_read,
	mark_notif_read,
)
from todobox.services.query import count_queries, delete_view, get_saved_views, save_view
from todobox.services.settings import get_settings_api as get_settings
from todobox.services.settings import save_settings, search_link_doctypes
from todobox.services.tags import search_tags
from todobox.services.team import get_workload, search_users, user_link_query
from todobox.services.templates import delete_task_template, get_task_templates, save_task_template
from todobox.services.todos import (
	add_cc,
	add_comment,
	cancel_todo,
	create_todos,
	discard_upload,
	forward_todo,
	get_counts,
	get_todo,
	list_todos,
	remind_todo,
	remove_cc,
	reopen_todo,
	snooze_todo,
	unsnooze_todo,
	update_todo,
)
from todobox.services.users import get_active_users

__all__ = [
	"add_checklist_item",
	"add_cc",
	"add_comment",
	"cancel_todo",
	"add_reference_comment",
	"count_queries",
	"create_todos",
	"delete_task_template",
	"delete_view",
	"discard_upload",
	"drop_from_day",
	"forward_todo",
	"get_active_users",
	"get_analytics",
	"get_counts",
	"get_pulse",
	"get_calendar",
	"get_day_plan",
	"get_doc_actions",
	"get_notifications",
	"get_reference_detail",
	"get_saved_views",
	"get_settings",
	"get_task_templates",
	"get_todo",
	"get_workload",
	"list_todos",
	"mark_all_notifs_read",
	"mark_notif_read",
	"remind_todo",
	"remove_cc",
	"reopen_todo",
	"remove_checklist_item",
	"reorder_day",
	"save_settings",
	"save_task_template",
	"save_view",
	"search_link_doctypes",
	"search_tags",
	"search_users",
	"set_my_language",
	"snooze_todo",
	"toggle_checklist_item",
	"unsnooze_todo",
	"update_todo",
	"user_link_query",
]
