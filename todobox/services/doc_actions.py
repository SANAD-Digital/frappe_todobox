"""Actions on the document linked to a task: only real Workflow transitions (or Submit), with the user's permissions."""

import frappe
from frappe import _
from frappe.model.workflow import get_transitions, get_workflow_name

from todobox.services.common import can

from todobox.services.workflow import (
	STYLE_TONE,
	_initials,
	_state_styles,
	action_allowed,
	apply_action,
	doc_detail,
	workflow_payload,
)

SUBMIT_ID = "__submit"


def _reference(name):
	"""The task and its linked document, after checking read access on both."""
	todo = frappe.get_doc("ToDo", name)
	if not frappe.has_permission("ToDo", "read", doc=todo):
		frappe.throw(_("You do not have access to this task"), frappe.PermissionError)
	if not (todo.reference_type and todo.reference_name):
		return todo, None
	if not frappe.db.exists(todo.reference_type, todo.reference_name):
		return todo, None
	ref = frappe.get_doc(todo.reference_type, todo.reference_name)
	if not can(ref.doctype, "read", doc=ref):
		return todo, None
	return todo, ref


def _available(ref):
	"""[{id, label, tone, next}]: allowed Workflow transitions, or Submit for a submittable doc without Workflow."""
	wf_name = get_workflow_name(ref.doctype)
	if wf_name:
		wfp = workflow_payload(frappe.get_cached_doc("Workflow", wf_name))
		state = ref.get(wfp["workflow_state_field"] or "workflow_state")
		tones = {t["action"]: t["tone"] for t in wfp["transitions"] if t["state"] == state}
		return [
			{
				"id": t.get("action"),
				"label": _(t.get("action")),
				"tone": tones.get(t.get("action"), "green"),
				"next": _(t.get("next_state")),
			}
			for t in get_transitions(ref, raise_exception=False) or []
			if action_allowed(ref, t.get("next_state"), wfp)
		]
	if (
		frappe.get_meta(ref.doctype).is_submittable
		and ref.docstatus == 0
		and can(ref.doctype, "submit", doc=ref)
	):
		return [{"id": SUBMIT_ID, "label": _("Submit"), "tone": "green", "next": _("Submitted")}]
	return []


def _status_of(ref):
	return ref.get("workflow_state") or ref.get("status") or (_("Submitted") if ref.docstatus == 1 else _("Draft"))


@frappe.whitelist()
def get_doc_actions(name):
	_todo, ref = _reference(name)
	if not ref:
		return {"actions": [], "ref_status": "", "readable": 0}
	return {
		"actions": _available(ref),
		"ref_status": _(_status_of(ref)),
		# the task's linked-document tabs are shown only when the user can read the document
		"readable": 1,
		"has_workflow": 1 if get_workflow_name(ref.doctype) else 0,
	}


@frappe.whitelist()
def get_reference_detail(name):
	"""Linked-document tabs of a task (Data / Comments / Attachments / History), same payload as the
	Required-actions preview. {"readable": 0} when the task has no document the user can read."""
	_todo, ref = _reference(name)
	if not ref:
		return {"readable": 0}
	wf_name = get_workflow_name(ref.doctype)
	out = doc_detail(ref, with_trail=bool(wf_name))
	users = {r[0] for r in out["comments"]} | {r[1] for r in out["trail"] if r[1]}
	styles = _state_styles([r[0] for r in out["trail"] if r[0]])
	out.update(
		{
			"readable": 1,
			"doctype": ref.doctype,
			"title": _(ref.doctype) + " " + ref.name,
			"has_workflow": 1 if wf_name else 0,
			"state_tones": {st: STYLE_TONE.get(style, "fg2") for st, style in styles.items()},
			"state_labels": {r[0]: _(r[0]) for r in out["trail"] if r[0]},
			"users": {
				u: {"name": frappe.utils.get_fullname(u), "initials": _initials(frappe.utils.get_fullname(u))}
				for u in users
			},
			"can_print": 1 if can(ref.doctype, "print", doc=ref) else 0,
		}
	)
	return out


@frappe.whitelist()
def add_reference_comment(name, text):
	"""Comment on the task's linked document (read access on the task and the document is required)."""
	text = (text or "").strip()
	if not text:
		frappe.throw(_("Comment cannot be empty"))
	_todo, ref = _reference(name)
	if not ref:
		frappe.throw(_("This task is not linked to a document you can access"), frappe.PermissionError)
	ref.add_comment("Comment", text)
	frappe.db.commit()
	return {"ok": 1}


@frappe.whitelist()
def run_doc_action(name, action_id):
	"""Runs an action the user can really take on the linked document (Workflow transition or Submit)."""
	todo, ref = _reference(name)
	if not ref:
		frappe.throw(_("This task is not linked to a document you can access"))
	action = next((a for a in _available(ref) if a["id"] == action_id), None)
	if not action:
		frappe.throw(_("This action is not available for you at this stage"), frappe.PermissionError)

	if action_id == SUBMIT_ID:
		ref.submit()
	else:
		apply_action(ref.doctype, ref.name, action_id)
	ref.reload()
	status = _(_status_of(ref))
	todo.add_comment("Info", _("{0} — {1} is now {2}").format(action["label"], ref.name, status))
	frappe.db.commit()
	return {"status": "success", "actionLabel": action["label"], "reference_name": ref.name, "ref_status": status}
