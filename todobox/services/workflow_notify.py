"""Workflow notifications: when a document moves to a new workflow state, the people who can take the
next decision are notified (the same users Frappe's Workflow Action targets: the transition's role,
approval access and read permission), and so is the document's owner when someone else moved it.
They appear in the ToDoBox bell under "Actions" and open the Required-actions screen.
"""

import frappe
from frappe import _
from frappe.model.workflow import get_workflow_name, get_workflow_state_field
from frappe.workflow.doctype.workflow_action.workflow_action import (
	get_next_possible_transitions,
	get_users_next_action_data,
)

from todobox.services.notifications import create_notification_log, user_lang

MAX_RECIPIENTS = 50


def on_workflow_change(doc, method=None):
	"""doc_events "*" on_update / on_update_after_submit / on_cancel."""
	if frappe.flags.in_import or frappe.flags.in_migrate or frappe.flags.in_install or frappe.flags.in_patch:
		return
	workflow = get_workflow_name(doc.doctype)
	if not workflow:
		return
	field = get_workflow_state_field(workflow)
	state = doc.get(field)
	if not state or not doc.has_value_changed(field):
		return
	try:
		_notify(doc, workflow, state)
	except Exception:
		# a notification must never block the transition itself
		frappe.log_error(title="ToDoBox: workflow notification failed")


def _notify(doc, workflow, state):
	me = frappe.session.user
	transitions = get_next_possible_transitions(workflow, state, doc)
	deciders = [u for u in get_users_next_action_data(transitions, doc) if u not in (me, "Guest")]
	for user in deciders[:MAX_RECIPIENTS]:
		lang = user_lang(user)
		create_notification_log(
			for_user=user,
			subject=_("{0} {1} is waiting for your decision ({2})", lang=lang).format(
				_(doc.doctype, lang=lang), doc.name, _(state, lang=lang)
			),
			document_type=doc.doctype,
			document_name=doc.name,
			from_user=me,
			notif_type="Alert",
			dedupe=False,
			kind="wf",
		)

	# the owner follows their document ("Sent & following up"); not on create, it is their own move
	owner = doc.owner
	if owner and owner not in (me, "Guest") and owner not in deciders and doc.get_doc_before_save():
		lang = user_lang(owner)
		create_notification_log(
			for_user=owner,
			subject=_("{0} moved {1} {2} to: {3}", lang=lang).format(
				frappe.utils.get_fullname(me), _(doc.doctype, lang=lang), doc.name, _(state, lang=lang)
			),
			document_type=doc.doctype,
			document_name=doc.name,
			from_user=me,
			notif_type="Alert",
			dedupe=False,
			kind="wf_update",
		)
