"""«Required actions» over Frappe Workflow.

A document is pending when the Desk form would offer me an action on it: readable by get_list, in a
state with a transition allowed to my roles, and allowed_transitions() leaves at least one action.
Returns workflow definitions, documents, trail and the user's decision log to the UI.
"""

import hashlib
import html
import json
import os
import re

import frappe
from frappe import _
from frappe.desk.form.meta import get_code_files_via_hooks
from frappe.model.workflow import (
	WorkflowStateError,
	apply_workflow,
	get_transitions,
	get_workflow_name,
	get_workflow_state_field,
	has_approval_access,
)
from frappe.utils import add_days, cint, flt, fmt_money, get_datetime, now_datetime

from todobox.services.common import TRANSLATION_CONTEXT, can, derive_subject, loads, share_with, split_csv, todo_has
from todobox.services.notifications import create_notification_log
from todobox.services.org import can_assign
from todobox.services.wf_engine import next_actions_of, timeline_of
from todobox.services.wf_rules import user_rule_passes

# form events that only run in the Desk form (frappe/public/js/frappe/form/workflow.js)
FORM_HOOKS = ("before_workflow_action", "after_workflow_action")

AVATAR_COLORS = [
	"#8a5a2b", "#3f4ea8", "#6a4fa6", "#2e7757", "#976420",
	"#4a6b7c", "#a4553c", "#5b6a4a", "#7c5a8a", "#b0443a",
]

DOCTYPE_ICONS = {
	"Sales Order": "i-tag",
	"Sales Invoice": "i-copy",
	"Purchase Order": "i-tag",
	"Purchase Invoice": "i-copy",
	"Quotation": "i-copy",
	"Material Request": "i-clipboard",
	"Leave Application": "i-calendar",
	"Attendance Request": "i-clock",
	"Employee Advance": "i-coins",
	"Payment Entry": "i-coins",
}

STYLE_TONE = {
	"Success": "green",
	"Danger": "red",
	"Warning": "amber",
	"Primary": "primary",
	"Info": "primary",
	"Inverse": "fg3",
	"": "fg2",
}

REJECT_WORDS = ("reject", "cancel", "رفض", "إلغاء", "الغاء", "ارجاع", "إرجاع")
RETURN_WORDS = ("return", "revert", "draft", "إعادة", "اعادة")


# ------------------------------------------------------------------ helpers
def _hours_since(dt):
	if not dt:
		return 0
	return max(0.0, round((now_datetime() - get_datetime(dt)).total_seconds() / 3600.0, 2))


def _initials(name):
	parts = [p for p in (name or "").split(" ") if p]
	if not parts:
		return "?"
	if len(parts) == 1:
		return parts[0][:2]
	return parts[0][:1] + parts[1][:1]


def _color(email):
	h = int(hashlib.md5((email or "").encode("utf-8")).hexdigest()[:8], 16)
	return AVATAR_COLORS[h % len(AVATAR_COLORS)]


def _req_cache(key):
	"""Per-request cache (cleared automatically when the request ends)."""
	store = getattr(frappe.local, "todobox_cache", None)
	if store is None:
		store = frappe.local.todobox_cache = {}
	return store.setdefault(key, {})


def state_field(doctype):
	"""The field holding the document's workflow state (Workflow.workflow_state_field)."""
	name = get_workflow_name(doctype)
	return (name and get_workflow_state_field(name)) or "workflow_state"


def _active_workflows():
	"""{doctype: Workflow doc} for every active Workflow whose doctype the user can read."""
	out = {}
	for wf in frappe.get_all("Workflow", filters={"is_active": 1}, fields=["name", "document_type"]):
		if wf.document_type in out:
			continue
		try:
			out[wf.document_type] = frappe.get_cached_doc("Workflow", wf.name)
		except frappe.DoesNotExistError:
			continue
	return out


def _state_styles(states):
	"""Color style from the Workflow State master (not the child table)."""
	if not states:
		return {}
	c = _req_cache("state_styles")
	if not c:
		c.update({r.name: (r.style or "") for r in frappe.get_all("Workflow State", fields=["name", "style"])})
	return {st: c.get(st, "") for st in states}


def _tone_for(transition, state_index, styles):
	"""(tone, destructive): visual only. Green for forward, amber for return, red for reject/cancel."""
	action = (transition.action or "").lower()
	nxt = frappe.scrub(transition.next_state or "")
	style = styles.get(transition.next_state, "")

	if style == "Danger" or any(w in action for w in REJECT_WORDS) or any(w in nxt for w in REJECT_WORDS):
		return "red", 1
	cur_i = state_index.get(transition.state, 0)
	nxt_i = state_index.get(transition.next_state, 0)
	if nxt_i < cur_i or any(w in action for w in RETURN_WORDS):
		return "amber", 0
	return "green", 0


def finished_states(wf):
	"""States where a document is done: it has no live exit other than to docstatus 2. A live exit leaves
	the state and is one apply_workflow can carry out (a submitted document cannot go back to draft; a
	cancelled one goes nowhere). "Approved" that can only be cancelled is final; a submitted state that
	still moves on to another submitted state is not. "Sent & following up" stops at a final state and the
	tasks linked to the document are closed (workflow_notify)."""
	status = {s.state: cint(s.doc_status) for s in wf.states}
	live = {
		t.state
		for t in wf.transitions
		if t.next_state != t.state and status.get(t.next_state, 0) != 2 and status.get(t.next_state, 0) >= status.get(t.state, 0)
	}
	return [s.state for s in wf.states if s.state not in live or cint(s.doc_status) == 2]


def _reads_form_hook(path):
	try:
		with open(path, encoding="utf-8") as f:
			text = f.read()
	except OSError:
		return False
	return any(hook in text for hook in FORM_HOOKS)


def needs_form(doctype):
	"""True when the doctype's form code handles before/after_workflow_action: those run only in the
	Desk form, so the action must be taken there. Looks at enabled Client Scripts, hooks doctype_js and
	the doctype's own .js (the form loads all three)."""
	c = _req_cache("needs_form")
	if doctype not in c:
		scripts = frappe.get_all("Client Script", filters={"dt": doctype, "enabled": 1}, pluck="script")
		found = any(hook in (script or "") for script in scripts for hook in FORM_HOOKS)
		if not found:
			meta = frappe.get_meta(doctype)
			files = list(get_code_files_via_hooks("doctype_js", doctype))
			if not meta.custom:
				files.append(
					os.path.join(
						frappe.get_module_path(meta.module), "doctype", frappe.scrub(doctype), frappe.scrub(doctype) + ".js"
					)
				)
			found = any(_reads_form_hook(path) for path in files)
		c[doctype] = found
	return c[doctype]


def workflow_payload(wf):
	state_index = {s.state: i for i, s in enumerate(wf.states)}
	styles = _state_styles([s.state for s in wf.states])
	state_meta = frappe.get_meta("Workflow Document State")
	# optional custom fields on the workflow's states (stepper order)
	extras = [f for f in ("show_in_statusbar", "status_no") if state_meta.has_field(f)]
	states = []
	for s in wf.states:
		row = {
			"state": s.state,
			"doc_status": cint(s.doc_status),
			"is_optional_state": cint(getattr(s, "is_optional_state", 0)),
			"style": styles.get(s.state, ""),
		}
		for f in extras:
			row[f] = cint(s.get(f))
		states.append(row)
	transitions = []
	for t in wf.transitions:
		tone, destructive = _tone_for(t, state_index, styles)
		transitions.append({
			"state": t.state,
			"action": t.action,
			"next_state": t.next_state,
			"allowed": _(t.allowed),
			"allowed_role": t.allowed,
			"allow_self_approval": cint(t.allow_self_approval),
			"tone": tone,
			"destructive": destructive,
			"conditionText": t.condition or "",
		})
	final = finished_states(wf)
	return {
		"document_type": wf.document_type,
		"workflow_state_field": wf.workflow_state_field,
		"is_active": 1,
		"send_email_alert": cint(wf.send_email_alert),
		"enable_action_confirmation": cint(wf.get("enable_action_confirmation")),
		"needs_form": 1 if needs_form(wf.document_type) else 0,
		"states": states,
		"transitions": transitions,
		"final": final,
	}


def _state_tones(wf_payload):
	tones = {}
	for wfp in wf_payload.values():
		for s in wfp["states"]:
			tones[s["state"]] = STYLE_TONE.get(s.get("style") or "", "fg2")
	return tones


# ------------------------------------------------------- pending documents
def _quiet(fn, default):
	"""Run a check whose failure means "skip this one": nothing it logged reaches the page as a popup."""
	log = frappe.local.message_log if hasattr(frappe.local, "message_log") else None
	size = len(log) if log is not None else 0
	try:
		return fn()
	except Exception:
		return default
	finally:
		if log is not None:
			del log[size:]


def _pending_rows(workflows, roles, limit):
	"""[(modified, doctype, name)] newest first: what get_list lets me read in a state where a transition
	is allowed to my roles. Only candidates: allowed_transitions decides per document."""
	rows = []
	for dt, wf in workflows.items():
		states = list({t.state for t in wf.transitions if t.allowed in roles})
		if not states:
			continue
		found = _quiet(
			lambda: frappe.get_list(
				dt,
				filters={wf.workflow_state_field: ("in", states)},
				fields=["name", "modified"],
				order_by="modified desc",
				limit=limit * PENDING_SCAN,
			),
			[],
		)
		rows += [(get_datetime(r.modified), dt, r.name) for r in found]
	rows.sort(key=lambda r: r[0], reverse=True)
	return rows


def _doc_rows(doctype, names):
	"""{name: row} without child tables, one query, remembered for the request."""
	c = _req_cache("doc_rows")
	missing = [n for n in names if (doctype, n) not in c]
	if missing:
		for r in frappe.get_all(doctype, filters={"name": ("in", missing)}, fields=["*"]):
			c[(doctype, r.name)] = r
	return {n: c[(doctype, n)] for n in names if (doctype, n) in c}


def _light_doc(doctype, row):
	return frappe.get_doc({**row, "doctype": doctype})


def _actions_doc(doc, wfp):
	"""The document to evaluate transitions on: conditions may read child tables, so only then load it whole."""
	field = wfp["workflow_state_field"]
	state = doc.get(field)
	if any(t["state"] == state and t.get("conditionText") for t in wfp["transitions"]):
		return frappe.get_doc(doc.doctype, doc.name)
	return doc


def _pending_docs(workflows, wf_payload, roles, limit):
	"""{(doctype, name): transitions} for up to `limit` documents the form would offer me an action on."""
	rows = _pending_rows(workflows, roles, limit)
	out = {}
	for start in range(0, len(rows), PENDING_BATCH):
		if len(out) >= limit:
			break
		batch = rows[start : start + PENDING_BATCH]
		by_type = {}
		for _m, dt, name in batch:
			by_type.setdefault(dt, []).append(name)
		loaded = {dt: _doc_rows(dt, names) for dt, names in by_type.items()}
		for _m, dt, name in batch:
			row = loaded[dt].get(name)
			if not row or len(out) >= limit:
				continue
			wfp = wf_payload[dt]
			doc = _light_doc(dt, row)
			trs = _quiet(lambda: allowed_transitions(_actions_doc(doc, wfp), wfp) if can(dt, "read", doc=doc) else [], [])
			if trs:
				out[(dt, name)] = trs
	return out


def _state_holders(wfp, state):
	"""Who decides at this state: the roles of the transitions leaving it (the workflow itself, not a
	Workflow Action row that may be stale)."""
	roles = dict.fromkeys(t["allowed_role"] for t in wfp["transitions"] if t["state"] == state)
	return [_(role, context=TRANSLATION_CONTEXT) for role in roles]


# ------------------------------------------------------------- document data
def _doc_party(doc, meta):
	"""Card title: the document's Title Field value if set, otherwise the document name."""
	tf = meta.title_field
	if tf and tf != "name":
		val = doc.get(tf)
		if val not in (None, ""):
			return frappe.utils.strip_html(str(val))[:120]
	return doc.name


BIG_FIELDTYPES = ("Currency", "Float", "Int", "Percent")


def _list_view_fields(meta):
	"""List view fields as in Frappe: List View Settings if present, else in_list_view from Meta."""
	c = _req_cache("list_view_fields")
	if meta.name not in c:
		c[meta.name] = _list_view_fields_uncached(meta)
	return c[meta.name]


def _list_view_fields_uncached(meta):
	from frappe.model import no_value_fields, table_fields

	names = []
	if frappe.db.exists("List View Settings", meta.name):
		try:
			names = [f.get("fieldname") for f in json.loads(frappe.db.get_value("List View Settings", meta.name, "fields") or "[]")]
		except Exception:
			names = []
	if not names:
		names = [df.fieldname for df in meta.fields if df.in_list_view]
	# title field comes first, as in List View
	if meta.title_field and meta.title_field != "name":
		names = [meta.title_field] + [n for n in names if n != meta.title_field]
	out = []
	for fieldname in names:
		df = meta.get_field(fieldname)
		if df and df.fieldtype not in no_value_fields and df.fieldtype not in table_fields and fieldname not in [d.fieldname for d in out]:
			out.append(df)
	return out


def _gov_fields(doc, meta):
	"""Fields shown in the Data tab: the document's List View fields."""
	from frappe.utils.formatters import format_value

	allowed = doc.get_permlevel_access("read") if hasattr(doc, "get_permlevel_access") else [0]
	out = []
	for df in _list_view_fields(meta):
		if cint(df.permlevel) and cint(df.permlevel) not in allowed:
			continue
		value = doc.get(df.fieldname)
		if value in (None, ""):
			continue
		text = frappe.utils.strip_html(str(format_value(value, df, doc) or "")).strip()
		if df.fieldtype == "Select":
			text = _(text)
		if df.fieldtype == "Check":
			text = _("Yes") if cint(value) else _("No")
		if not text:
			continue
		out.append([_(df.label or df.fieldname), text, 1 if df.fieldtype in BIG_FIELDTYPES else None])
	return out


def _items(doc, meta):
	table = None
	for df in meta.get_table_fields():
		if df.fieldname in ("items", "leaves", "accounts"):
			table = df.fieldname
			break
	if not table:
		return []
	rows = []
	for r in (doc.get(table) or [])[:50]:
		label = r.get("item_name") or r.get("description") or r.get("item_code") or r.get("account") or "—"
		rows.append([frappe.utils.strip_html(str(label))[:90], flt(r.get("qty") or 1), flt(r.get("rate") or 0)])
	return rows


def _trail_sources(doctype, names):
	"""Completed Workflow Actions of all documents, in one query."""
	done = {}
	if not names:
		return done
	for d in frappe.get_all(
		"Workflow Action",
		filters={"reference_doctype": doctype, "reference_name": ("in", names), "status": "Completed"},
		fields=["reference_name", "workflow_state", "completed_by", "modified"],
		order_by="modified asc",
	):
		done.setdefault(d.reference_name, []).append(d)
	return done


def _trail(doc, sources=None):
	"""Document trail: the completed Workflow Actions, then the current state."""
	done = sources if sources is not None else _trail_sources(doc.doctype, [doc.name])
	rows = [[d.workflow_state, d.completed_by or doc.owner, _hours_since(d.modified), ""] for d in done.get(doc.name, [])]
	state = doc.get(state_field(doc.doctype))
	if not rows or rows[-1][0] != state:
		rows.append([state, doc.modified_by or doc.owner, _hours_since(doc.modified), ""])
	if rows and rows[0][0] != state and _hours_since(doc.creation) > rows[0][2]:
		rows.insert(0, [rows[0][0], doc.owner, _hours_since(doc.creation), ""])
	return rows


def _comments(doctype, names):
	out = {}
	if not names:
		return out
	rows = frappe.get_all(
		"Comment",
		filters={"reference_doctype": doctype, "reference_name": ("in", names), "comment_type": "Comment"},
		fields=["reference_name", "owner", "content", "creation"],
		order_by="creation asc",
	)
	for r in rows:
		out.setdefault(r.reference_name, []).append(
			[r.owner, _hours_since(r.creation), html.unescape(frappe.utils.strip_html(r.content or ""))[:400]]
		)
	return out


def _files(doctype, names):
	out = {}
	if not names:
		return out
	rows = frappe.get_all(
		"File",
		filters={"attached_to_doctype": doctype, "attached_to_name": ("in", names)},
		fields=["attached_to_name", "file_name", "file_size", "file_type", "file_url"],
		order_by="creation asc",
	)
	for r in rows:
		size = "{:.0f} KB".format((r.file_size or 0) / 1024) if r.file_size else "—"
		out.setdefault(r.attached_to_name, []).append(
			[r.file_name or _("File"), r.file_type or _("File"), size, r.file_url or ""]
		)
	return out


def _linked_todo(doctype, names):
	"""{document: its open task, leaving out those I archived}; my own task when I have one (mine = 1)."""
	out = {}
	if not names:
		return out
	me = frappe.session.user
	for r in frappe.get_all(
		"ToDo",
		filters={"reference_type": doctype, "reference_name": ("in", names), "status": "Open"},
		fields=[
			"name",
			"reference_name",
			"description",
			"allocated_to",
			*[c for c in ("archived_by", "subject") if todo_has(c)],
		],
	):
		# one I archived is gone from my view, here too
		if me in split_csv(r.get("archived_by")):
			continue
		mine = r.allocated_to == me
		cur = out.get(r.reference_name)
		if not cur or (mine and not cur["mine"]):
			out[r.reference_name] = {
				"name": r.name,
				"text": derive_subject(r)[:90],
				"mine": 1 if mine else 0,
			}
	return out


def _required_ptypes(doc, next_state, wfp):
	"""What Document.save will check for this move: always write, plus submit or cancel when the
	docstatus changes that way."""
	status = {st["state"]: cint(st["doc_status"]) for st in wfp["states"]}
	target = status.get(next_state, 0)
	ptypes = ["write"]
	if target == 1 and cint(doc.docstatus) == 0:
		ptypes.append("submit")
	elif target == 2:
		ptypes.append("cancel")
	return ptypes


def action_allowed(doc, next_state, wfp):
	"""The DocType permissions the action needs (see _required_ptypes)."""
	cache = _req_cache("action_perm")
	for ptype in _required_ptypes(doc, next_state, wfp):
		key = (doc.doctype, doc.name, ptype, cint(doc.docstatus))
		if key not in cache:
			try:
				cache[key] = can(doc.doctype, ptype, doc=doc)
			except Exception:
				cache[key] = False
		if not cache[key]:
			return False
	return True


def allowed_transitions(doc, wfp):
	"""What I may do on this document now: what the Desk form offers (get_transitions + self approval),
	what Document.save would then permit, and the per-user rule. Read access is required, as in get_transitions."""
	try:
		transitions = get_transitions(doc, raise_exception=True)
	except WorkflowStateError:
		return []
	user = frappe.session.user
	return [
		t
		for t in transitions
		if has_approval_access(user, doc, t)
		and action_allowed(doc, t.get("next_state"), wfp)
		and user_rule_passes(doc, t)
	]


def _build_docs(doctype, names, workflows, pending, since_map):
	"""Build the document bundle for one doctype with as few queries as possible."""
	meta = frappe.get_meta(doctype)
	comments = _comments(doctype, names)
	files = _files(doctype, names)
	todos = _linked_todo(doctype, names)
	sources = _trail_sources(doctype, names)
	# document rows in one query, without child tables (items are loaded when a document is opened)
	rows = _doc_rows(doctype, names)
	wfp = workflows[doctype]
	field = wfp["workflow_state_field"]
	out = []
	for name in names:
		row = rows.get(name)
		if not row:
			continue
		doc = _light_doc(doctype, row)
		# silent check (common.can): no "does not have doctype access" popup for documents skipped here
		if not can(doctype, "read", doc=doc):
			continue
		state = doc.get(field)
		trs = pending.get((doctype, name)) or []
		tmap = {t["action"]: t for t in wfp["transitions"] if t["state"] == state}
		actions = []
		for t in trs:
			base = tmap.get(t.get("action"), {})
			actions.append({
				"action": t.get("action"),
				"next_state": t.get("next_state"),
				"tone": base.get("tone", "green"),
				"destructive": base.get("destructive", 0),
				"allowed": _(t.get("allowed")),
			})
		party = _doc_party(doc, meta)
		out.append({
			"doctype": doctype,
			"name": doc.name,
			"state": state,
			"owner": doc.owner,
			"party": party,
			"title_is_name": 1 if party == doc.name else 0,
			"amount": flt(doc.get("grand_total") or doc.get("total") or 0),
			"amountText": fmt_money(doc.get("grand_total") or 0, currency=doc.get("currency"))
			if meta.has_field("grand_total") else "",
			"pending": 1 if actions else 0,
			"can_print": 1 if can(doctype, "print", doc=doc) else 0,
			"actions": actions,
			"holder": " · ".join(_state_holders(wfp, state)),
			"since": _hours_since(since_map.get((doctype, name, state)) or doc.modified),
			"fields": _gov_fields(doc, meta),
			"items": [],
			"trail": _trail(doc, sources),
			"comments": comments.get(name, []),
			"files": files.get(name, []),
			"checks": [],
			"todo": (todos.get(name) or {}).get("text", ""),
			"todo_name": (todos.get(name) or {}).get("name", ""),
			"todo_mine": (todos.get(name) or {}).get("mine", 0),
		})
	return out


# ---------------------------------------------------------------- Endpoints
@frappe.whitelist()
def get_workflow_inbox(limit=120):
	"""Required-actions bundle: definitions + awaiting my decision + sent by me + my decision log."""
	me = frappe.session.user
	roles = frappe.get_roles(me)
	limit = cint(limit) or 120
	workflows = _active_workflows()
	if not workflows:
		return {"me": me, "users": {}, "doctypes": {}, "workflows": {}, "stateTones": {}, "docs": [], "log": []}

	wf_payload = {dt: workflow_payload(wf) for dt, wf in workflows.items()}
	doctypes = {
		dt: {"ar": _(dt), "icon": DOCTYPE_ICONS.get(dt, "i-copy")}
		for dt in workflows
	}

	# 1) awaiting my decision: what the form would offer me
	pending = _pending_docs(workflows, wf_payload, roles, limit)
	by_type = {}
	for dt, name in pending:
		by_type.setdefault(dt, []).append(name)

	# 2) sent by me: my documents not yet in a final state
	for dt, wfp in wf_payload.items():
		final = wfp["final"]
		filters = {"owner": me, wfp["workflow_state_field"]: ("not in", final or ["__none__"])}
		try:
			mine = frappe.get_all(dt, filters=filters, pluck="name", limit=25, order_by="modified desc")
		except Exception:
			mine = []
		for n in mine:
			if (dt, n) not in pending:
				by_type.setdefault(dt, []).append(n)

	# how long it has waited: since the open Workflow Action of its current state, else its last change
	since_map = {}
	for dt, names in by_type.items():
		for a in frappe.get_all(
			"Workflow Action",
			filters={"reference_doctype": dt, "reference_name": ("in", list(set(names))), "status": "Open"},
			fields=["reference_name", "workflow_state", "creation"],
			order_by="creation desc",
		):
			since_map.setdefault((dt, a.reference_name, a.workflow_state), a.creation)

	docs = []
	for dt, names in by_type.items():
		docs += _build_docs(dt, list(dict.fromkeys(names)), wf_payload, pending, since_map)

	# 3) my decision log, from Version: every workflow transition I made, here or in the Frappe desk
	log = _decision_log(me, wf_payload)

	# 4) users referenced in the payload
	emails = {me}
	for d in docs:
		emails.add(d["owner"])
		emails.update([t[1] for t in d["trail"] if t[1]])
		emails.update([c[0] for c in d["comments"] if c[0]])
	users = {}
	emps = {}
	if frappe.db.exists("DocType", "Employee"):
		for e in frappe.get_all(
			"Employee",
			filters={"user_id": ("in", list(emails))},
			fields=["user_id", "designation", "employee_name"],
		):
			emps.setdefault(e.user_id, e)
	for u in frappe.get_all(
		"User", filters={"name": ("in", list(emails))}, fields=["name", "full_name"]
	):
		emp = emps.get(u.name)
		full = (emp and emp.employee_name) or u.full_name or u.name
		users[u.name] = {
			"name": full,
			"role": (emp and emp.designation) or _primary_role(u.name),
			"initials": _initials(full),
			"color": _color(u.name),
		}

	return {
		"me": me,
		"users": users,
		"doctypes": doctypes,
		"workflows": wf_payload,
		"stateTones": _state_tones(wf_payload),
		"docs": docs,
		"log": log,
	}


LOG_DAYS = 180

# pending: candidates fetched per doctype (× limit), so documents with no resulting action do not use up
# the limit; they are evaluated in batches until the limit is reached
PENDING_SCAN = 3
PENDING_BATCH = 50


def _decision_log(me, wf_payload, limit=200):
	"""My decisions: the actual action (from the old->new transition), how long it waited on me, my note, and the document's current state."""
	doctypes = list(wf_payload)
	if not doctypes:
		return []
	fields = list({wf_payload[dt]["workflow_state_field"] or "workflow_state" for dt in doctypes})
	likes = {f"like{i}": f"%{field}%" for i, field in enumerate(fields)}
	versions = frappe.db.sql(
		f"""
		SELECT ref_doctype, docname, creation, data FROM `tabVersion`
		WHERE owner = %(me)s AND ref_doctype IN %(dts)s AND creation >= %(since)s
		AND ({" OR ".join(f"data LIKE %({k})s" for k in likes)})
		ORDER BY creation DESC LIMIT %(limit)s
		""",
		{"me": me, "dts": doctypes, "since": add_days(now_datetime(), -LOG_DAYS), "limit": cint(limit), **likes},
		as_dict=True,
	)
	moves = []
	for v in versions:
		wfp = wf_payload[v.ref_doctype]
		field = wfp["workflow_state_field"] or "workflow_state"
		try:
			changed = json.loads(v.data or "{}").get("changed") or []
		except Exception:
			continue
		ch = next((c for c in changed if c and c[0] == field and c[1] != c[2]), None)
		if ch:
			moves.append((v, wfp, ch[1] or "", ch[2] or ""))
	if not moves:
		return []

	by_dt = {}
	for v, _w, _a, _b in moves:
		by_dt.setdefault(v.ref_doctype, set()).add(v.docname)

	# current state + title
	now_rows, titles = {}, {}
	for dt, names in by_dt.items():
		meta = frappe.get_meta(dt)
		field = wf_payload[dt]["workflow_state_field"] or "workflow_state"
		tf = meta.title_field if meta.title_field and meta.title_field != "name" and meta.has_field(meta.title_field) else None
		fields = ["name", field] + ([tf] if tf else [])
		for r in frappe.get_all(dt, filters={"name": ("in", list(names))}, fields=fields):
			now_rows[(dt, r.name)] = r.get(field)
			if tf and r.get(tf):
				titles[(dt, r.name)] = frappe.utils.strip_html(str(r.get(tf)))[:120]

	# when the document reached me: the Workflow Action I completed for that state
	arrivals = {}
	for dt, names in by_dt.items():
		for a in frappe.get_all(
			"Workflow Action",
			filters={"reference_doctype": dt, "reference_name": ("in", list(names)), "completed_by": me, "status": "Completed"},
			fields=["reference_name", "workflow_state", "creation", "modified"],
		):
			arrivals.setdefault((dt, a.reference_name, a.workflow_state), []).append(a)

	# my note for the decision: my comment on the document at most two minutes before the transition
	notes = {}
	for dt, names in by_dt.items():
		for c in frappe.get_all(
			"Comment",
			filters={"reference_doctype": dt, "reference_name": ("in", list(names)), "comment_type": "Comment", "owner": me},
			fields=["reference_name", "content", "creation"],
		):
			notes.setdefault((dt, c.reference_name), []).append(c)

	out = []
	for v, wfp, old, new in moves:
		key = (v.ref_doctype, v.docname)
		tr = next((t for t in wfp["transitions"] if t["state"] == old and t["next_state"] == new), None)
		when = get_datetime(v.creation)
		first_state = wfp["states"][0]["state"] if wfp["states"] else None
		kind = "submit" if (not old or old == first_state) else "decision"
		waited = None
		for a in (arrivals.get((v.ref_doctype, v.docname, old), []) if kind == "decision" else []):
			if abs((get_datetime(a.modified) - when).total_seconds()) < 600:
				waited = round(max(0.0, (when - get_datetime(a.creation)).total_seconds() / 3600.0), 1)
				break
		note = ""
		for c in notes.get(key, []):
			delta = (when - get_datetime(c.creation)).total_seconds()
			if -5 <= delta <= 120:
				note = html.unescape(frappe.utils.strip_html(c.content or "")).strip()[:300]
				break
		now_state = now_rows.get(key)
		out.append({
			"doc": v.docname,
			"doctype": v.ref_doctype,
			"title": titles.get(key, ""),
			"action": tr["action"] if tr else "Moved",
			"tone": tr["tone"] if tr else "fg2",
			"kind": kind,
			"from": old or "New",
			"to": new,
			"hours": _hours_since(when),
			"ts": str(when),
			"waited": waited,
			"note": note,
			"exists": now_state is not None,
			"now": now_state or "",
			"moved_on": bool(now_state) and now_state != new,
			"final": bool(now_state) and now_state in wfp["final"],
			"holder": "، ".join(_state_holders(wfp, now_state)[:2]) if now_state else "",
			"by": me,
		})
	return out


def _primary_role(user):
	roles = [
		r for r in frappe.get_roles(user)
		if r not in ("All", "Guest", "Desk User", "Employee", "Employee Self Service")
	]
	return _(roles[0]) if roles else _("User")


def _undo_action(doc, prev, wfp):
	"""The action that takes the document back to prev, if I may take it now. A move to a lower docstatus is
	never possible (apply_workflow: "Illegal Document Status"), so it is not an undo."""
	if not can(doc.doctype, "read", doc=doc):
		return None
	status = {st["state"]: cint(st["doc_status"]) for st in wfp["states"]}
	if status.get(prev, 0) < cint(doc.docstatus):
		return None
	return next((t.get("action") for t in allowed_transitions(doc, wfp) if t.get("next_state") == prev), None)


@frappe.whitelist()
def apply_action(doctype, docname, action, note=None, mentions=None):
	"""Apply a real workflow action, then save the note as a comment on the document.
	mentions (JSON list of users): as in add_comment. Frappe's own errors reach the caller unchanged.
	Returns {ok, prev, next, queued, name, undo_action}: queued = 1 when the submission went to the
	background (queue_in_background); undo_action = the action back to prev, when I may take it."""
	doc = frappe.get_doc(doctype, docname)
	doc.check_permission("read")
	wfp = workflow_payload(frappe.get_cached_doc("Workflow", get_workflow_name(doctype)))
	field = wfp["workflow_state_field"]
	prev = doc.get(field)
	if action not in [t.get("action") for t in allowed_transitions(doc, wfp)]:
		_refuse_if_frappe_would_allow(doc, action, wfp)
	transitions_next = next(
		(t.get("next_state") for t in wfp["transitions"] if t["state"] == prev and t["action"] == action), None
	)
	result = apply_workflow(doc, action)
	note = (note or "").strip()
	if note:
		content, mentioned = _with_mentions(note, mentions)
		for user in mentioned:
			share_with(doctype, docname, user)
		doc.add_comment("Comment", content)
	undo = None if result is None else _undo_action(result, prev, wfp)
	frappe.db.commit()
	return {
		"ok": 1,
		"prev": prev,
		"next": result.get(field) if result is not None else transitions_next,
		"queued": 1 if result is None else 0,
		"name": docname,
		"undo_action": undo,
	}


def _refuse_if_frappe_would_allow(doc, action, wfp):
	"""The action is outside allowed_transitions. When it is not a valid action, or self approval blocks
	it, return: apply_workflow raises its own error. Otherwise stop here: with Frappe's permission error
	when a DocType permission is missing, else because of the per-user rule."""
	try:
		transitions = get_transitions(doc, raise_exception=True)
	except WorkflowStateError:
		return
	t = next((t for t in transitions if t.get("action") == action), None)
	if not t or not has_approval_access(frappe.session.user, doc, t):
		return
	for ptype in _required_ptypes(doc, t.get("next_state"), wfp):
		doc.check_permission(ptype)
	frappe.throw(_("You do not have permission to perform this action"), frappe.PermissionError)


def _with_mentions(text, mentions):
	"""(comment html, mentioned users): each "@Full Name" of the given users, when I may assign to them,
	becomes Frappe's mention markup, so Frappe notifies them and the Desk timeline shows it as a mention."""
	me = frappe.session.user
	try:
		emails = loads(mentions, []) or []
	except ValueError:
		emails = []
	emails = [e for e in dict.fromkeys(emails) if isinstance(e, str) and e not in (me, "Guest") and can_assign(e)][:20]
	rows = frappe.get_all(
		"User", filters={"name": ["in", emails], "enabled": 1}, fields=["name", "full_name"]
	) if emails else []
	esc = frappe.utils.escape_html
	labels = {"@" + esc(r.full_name or r.name): r for r in rows}
	labels = {k: r for k, r in labels.items() if k in esc(text)}
	if not labels:
		return text, []

	def span(m):
		r = labels[m.group(0)]
		return (
			f'<span class="mention" data-id="{esc(r.name)}" data-value="{esc(r.full_name or r.name)}" '
			f'data-denotation-char="@">{m.group(0)}</span>'
		)

	pattern = "|".join(re.escape(k) for k in sorted(labels, key=len, reverse=True))
	return re.sub(pattern, span, esc(text)).replace("\n", "<br>"), [r.name for r in labels.values()]


@frappe.whitelist()
def add_comment(doctype, docname, text, mentions=None):
	"""A comment on the document. mentions (JSON list of users): Frappe notifies them (Comment.after_insert);
	like assign-to and forward, the document is shared with those who cannot read it, so they can open it."""
	text = (text or "").strip()
	if not text:
		frappe.throw(_("Comment cannot be empty"))
	doc = frappe.get_doc(doctype, docname)
	doc.check_permission("read")
	content, mentioned = _with_mentions(text, mentions)
	for user in mentioned:
		share_with(doctype, docname, user)
	doc.add_comment("Comment", content)
	frappe.db.commit()
	return {"ok": 1, "mentioned": mentioned}


@frappe.whitelist()
def nudge(doctype, docname):
	"""Reminder to current decision holders via Notification Log."""
	frappe.get_doc(doctype, docname).check_permission("read")
	action = frappe.db.get_value(
		"Workflow Action",
		{"reference_doctype": doctype, "reference_name": docname, "status": "Open"},
		"name",
	)
	if not action:
		return {"ok": 0, "sent": 0, "holder": ""}

	targets, labels = set(), []
	single = frappe.db.get_value("Workflow Action", action, "user")
	if single:
		targets.add(single)
	if not targets:
		for role in frappe.get_all("Workflow Action Permitted Role", filters={"parent": action}, pluck="role"):
			labels.append(_(role))
			for u in frappe.get_all("Has Role", filters={"role": role, "parenttype": "User"}, pluck="parent"):
				targets.add(u)

	for skip in (frappe.session.user, "Administrator", "Guest"):
		targets.discard(skip)
	for u in list(targets)[:25]:
		create_notification_log(
			for_user=u,
			subject=_("Reminder: {0} is waiting for your decision").format(docname),
			document_type=doctype,
			document_name=docname,
			notif_type="Alert",
			dedupe=False,
			kind="wf_remind",
		)
	frappe.db.commit()
	holder = " · ".join(labels) or ", ".join(frappe.utils.get_fullname(u) for u in list(targets)[:3])
	return {"ok": 1, "sent": len(targets), "holder": holder}


@frappe.whitelist()
def get_doc_detail(doctype, docname):
	"""Details for one document when opened (items, comments, attachments, refreshed trail)."""
	doc = frappe.get_doc(doctype, docname)
	doc.check_permission("read")
	return doc_detail(doc)


def doc_detail(doc, with_trail=True):
	"""Detail tabs payload for a document the caller has already checked read access on
	(shared by the Required-actions preview and the task's linked-document tabs)."""
	meta = frappe.get_meta(doc.doctype)
	return {
		"name": doc.name,
		"items": _items(doc, meta),
		"comments": _comments(doc.doctype, [doc.name]).get(doc.name, []),
		"files": _files(doc.doctype, [doc.name]).get(doc.name, []),
		"trail": _trail(doc) if with_trail else [],
		"fields": _gov_fields(doc, meta),
		"state": doc.get(state_field(doc.doctype)),
		"timeline": _quiet(lambda: timeline_of(doc), []) if with_trail else [],
		"next_actions": _quiet(lambda: next_actions_of(doc), {}) if with_trail else {},
	}
