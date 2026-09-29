"""Stable public endpoints for "Required actions" (Frappe Workflow): todobox.workflow_api.<method>."""

# get_transitions is Frappe's own whitelisted method, re-exported for URL compatibility with the old module
from frappe.model.workflow import get_transitions

from todobox.services.workflow import add_comment, apply_action, get_doc_detail, get_workflow_inbox, nudge

__all__ = ["add_comment", "apply_action", "get_doc_detail", "get_transitions", "get_workflow_inbox", "nudge"]
