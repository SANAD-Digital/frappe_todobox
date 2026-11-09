"""Per-user rule of a Workflow Transition.

A transition may name document fields holding users (``todobox_users_by_doc_field``, comma separated):

- ``todobox_use_and_condition_between_users``: the current user must be in all of them (default: in any).
- ``todobox_use_and_condition``: how that result combines with the transition's ``condition``:
  ``(condition) and (users)`` when set, else ``(condition) or (users)``.

No user fields: the rule passes. Administrator gets no bypass here, exactly like the logic this replaces:
it passes only when a field names it, or when the rule has no user fields.

Stock Frappe filters on ``condition`` on its own (get_transitions, apply_workflow), so an "or" rule can
never open a transition whose condition is false: it can only restrict.
"""

import frappe
from frappe import _
from frappe.model.workflow import (
	WorkflowPermissionError,
	get_workflow_name,
	get_workflow_safe_globals,
	get_workflow_state_field,
)
from frappe.model.workflow import get_transitions as stock_get_transitions
from frappe.utils import cint, cstr

def user_fields(row) -> list[str]:
	return [f.strip() for f in cstr(row.get("todobox_users_by_doc_field")).split(",") if f.strip()]


def _eval_condition(condition, doc) -> bool:
	context = frappe._dict(doc) if isinstance(doc, dict) else doc.as_dict()
	try:
		return bool(frappe.safe_eval(condition, get_workflow_safe_globals(), {"doc": context}))
	except Exception:
		# fail closed: a broken expression must not open the transition
		frappe.log_error(title="ToDoBox: workflow transition condition failed")
		return False


def row_passes(doc, row, user=None) -> bool:
	"""The rule of one Workflow Transition row. Nothing is written back to the row (it may be cached)."""
	fields = user_fields(row)
	if not fields:
		return True

	user = user or frappe.session.user
	matches = [doc.get(f) == user for f in fields]
	users_ok = all(matches) if cint(row.get("todobox_use_and_condition_between_users")) else any(matches)

	condition = row.get("condition")
	if not condition:
		return users_ok
	if cint(row.get("todobox_use_and_condition")):
		return users_ok and _eval_condition(condition, doc)
	return users_ok or _eval_condition(condition, doc)


def _matching_rows(doc, transition) -> list:
	"""The Workflow Transition rows behind a transition: get_transitions dicts may lack the rule fields."""
	workflow_name = get_workflow_name(doc.get("doctype"))
	if not workflow_name:
		return []

	state = transition.get("state") or doc.get(get_workflow_state_field(workflow_name))
	rows = [
		row
		for row in frappe.get_cached_doc("Workflow", workflow_name).transitions
		if row.state == state
		and row.action == transition.get("action")
		and row.next_state == transition.get("next_state")
	]
	allowed = transition.get("allowed")
	if allowed:
		return [row for row in rows if row.allowed == allowed] or rows

	# the same move may exist once per role: only the rows of the user's roles apply
	roles = set(frappe.get_roles())
	return [row for row in rows if row.allowed in roles] or rows


def user_rule_passes(doc, transition) -> bool:
	"""Whether the current user satisfies the transition's user rule on this document."""
	rows = _matching_rows(doc, transition)
	if not rows:
		return row_passes(doc, transition)
	return any(row_passes(doc, row) for row in rows)


@frappe.whitelist()
def get_transitions(doc, workflow=None, raise_exception=False) -> list[dict]:
	"""Replaces frappe.model.workflow.get_transitions over HTTP (override_whitelisted_methods)."""
	from frappe.model.document import Document

	if not isinstance(doc, Document):
		doc = frappe.get_doc(frappe.parse_json(doc))
		doc.load_from_db()

	# a client can only send a string here; stock code expects a Workflow document
	workflow = None if isinstance(workflow, str) else workflow
	return [t for t in stock_get_transitions(doc, workflow, raise_exception) if user_rule_passes(doc, t)]


def enforce_user_rule(doc) -> None:
	"""Rejects a state change whose transition rule the current user does not satisfy, however it was
	requested (apply_workflow, bulk approval, doc.save with a new state).

	The rule is read from the document as it was before this save, so nobody can pass it by writing
	their own name into the field in the same request. A transition the user's roles do not allow at all
	is left to stock validate_workflow."""
	workflow_name = get_workflow_name(doc.doctype)
	before = doc.get_doc_before_save() if workflow_name else None
	if not before:
		return

	field = get_workflow_state_field(workflow_name)
	old_state, new_state = before.get(field), doc.get(field)
	if not old_state or old_state == new_state:
		return

	roles = set(frappe.get_roles())
	rows = [
		row
		for row in frappe.get_cached_doc("Workflow", workflow_name).transitions
		if row.state == old_state and row.next_state == new_state and row.allowed in roles
	]
	# another transition to the same state whose condition is false opens nothing (Administrator holds every role)
	if rows and not any(
		row_passes(before, row) and (not row.condition or _eval_condition(row.condition, before)) for row in rows
	):
		frappe.throw(
			_("You are not allowed to move this document from {0} to {1}.", context="ToDoBox").format(
				frappe.bold(_(old_state)), frappe.bold(_(new_state))
			),
			WorkflowPermissionError,
		)
