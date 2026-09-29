"""«Required actions» over Frappe Workflow.

Same matching as the Workflow Action Report of snd_workflow: open Workflow Actions matched by user
(Workflow Action Permitted User, when that app is installed) and then by role (Permitted Role).
Returns workflow definitions, documents, trail and the user's decision log to the UI.
"""

import hashlib
import json

import frappe
from frappe import _
from frappe.model.workflow import apply_workflow, get_transitions, get_workflow_name
from frappe.utils import add_days, cint, flt, fmt_money, get_datetime, now_datetime

from todobox.services.common import TRANSLATION_CONTEXT, can

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
RETURN_WORDS = ("return", "revert", "draft", "إعادة", "اعادة", "رفع")


# ------------------------------------------------------------------ helpers
def _hours_since(dt):
	if not dt:
		return 0
	return max(0.0, round((now_datetime() - get_datetime(dt)).total_seconds() / 3600.0, 2))


def _initials(name):
	parts = [p for p in (name or "").split(" ") if p]
	if not parts:
		return "؟"
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


def _has_permitted_users_table():
	c = _req_cache("perm_users_table")
	if "v" not in c:
		c["v"] = _has_permitted_users_table_uncached()
	return c["v"]


def _has_permitted_users_table_uncached():
	return frappe.db.exists("DocType", "Workflow Action Permitted User") and frappe.db.has_column(
		"Workflow Action", "snd_wf_permitted_users_count"
	)


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
	"""Button color: green for forward, amber for return, red for reject/cancel."""
	action = (transition.action or "").lower()
	nxt = frappe.scrub(transition.next_state or "")
	style = styles.get(transition.next_state, "")

	if style == "Danger" or any(w in action for w in REJECT_WORDS) or any(w in nxt for w in REJECT_WORDS):
		return "red", 1, 1
	cur_i = state_index.get(transition.state, 0)
	nxt_i = state_index.get(transition.next_state, 0)
	if nxt_i < cur_i or any(w in action for w in RETURN_WORDS):
		return "amber", 1, 0
	return "green", 0, 0


def workflow_payload(wf):
	state_index = {s.state: i for i, s in enumerate(wf.states)}
	styles = _state_styles([s.state for s in wf.states])
	states = [
		{
			"state": s.state,
			"doc_status": cint(s.doc_status),
			"is_optional_state": cint(getattr(s, "is_optional_state", 0)),
			"style": styles.get(s.state, ""),
		}
		for s in wf.states
	]
	transitions = []
	for t in wf.transitions:
		tone, needs_note, destructive = _tone_for(t, state_index, styles)
		transitions.append({
			"state": t.state,
			"action": t.action,
			"next_state": t.next_state,
			"allowed": _(t.allowed),
			"allowed_role": t.allowed,
			"allow_self_approval": cint(t.allow_self_approval),
			"tone": tone,
			"needsNote": needs_note,
			"destructive": destructive,
			"conditionText": t.condition or "",
		})
	non_final = {t.state for t in wf.transitions}
	final = [s.state for s in wf.states if s.state not in non_final]
	return {
		"document_type": wf.document_type,
		"workflow_state_field": wf.workflow_state_field,
		"is_active": 1,
		"send_email_alert": cint(wf.send_email_alert),
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


# ------------------------------------------------------- open actions
def _open_actions_for_me(me, roles):
	"""Same logic as the Workflow Action report: match by user first, then by role."""
	if not frappe.db.exists("DocType", "Workflow Action"):
		return []

	by_user = frappe.db.sql(
		"""
		SELECT ac.name, ac.reference_doctype, ac.reference_name, ac.workflow_state, ac.creation
		FROM `tabWorkflow Action` ac
		WHERE ac.status = 'Open' AND ac.user = %(me)s
		""",
		{"me": me},
		as_dict=True,
	)

	if _has_permitted_users_table():
		by_user += frappe.db.sql(
			"""
			SELECT ac.name, ac.reference_doctype, ac.reference_name, ac.workflow_state, ac.creation
			FROM `tabWorkflow Action Permitted User` pu
			INNER JOIN `tabWorkflow Action` ac ON pu.parent = ac.name
			WHERE ac.status = 'Open' AND pu.user = %(me)s
			""",
			{"me": me},
			as_dict=True,
		)
		role_cond = "AND ac.snd_wf_permitted_users_count = 0"
	else:
		role_cond = ""

	by_role = []
	if roles:
		by_role = frappe.db.sql(
			f"""
			SELECT ac.name, ac.reference_doctype, ac.reference_name, ac.workflow_state, ac.creation
			FROM `tabWorkflow Action Permitted Role` pr
			INNER JOIN `tabWorkflow Action` ac ON pr.parent = ac.name
			WHERE ac.status = 'Open' AND pr.role IN %(roles)s {role_cond}
			""",
			{"roles": tuple(roles)},
			as_dict=True,
		)

	seen, out = set(), []
	for a in by_user + by_role:
		key = (a.reference_doctype, a.reference_name)
		if key in seen:
			continue
		seen.add(key)
		out.append(a)
	return out


def _holders(action_names):
	"""Current decision holders (roles or users) for each Workflow Action."""
	out = {}
	if not action_names:
		return out
	rows = frappe.get_all(
		"Workflow Action Permitted Role",
		filters={"parent": ("in", action_names)},
		fields=["parent", "role"],
	)
	for r in rows:
		out.setdefault(r.parent, []).append(_(r.role, context=TRANSLATION_CONTEXT))
	if _has_permitted_users_table():
		urows = frappe.get_all(
			"Workflow Action Permitted User",
			filters={"parent": ("in", action_names)},
			fields=["parent", "user"],
		)
		full_names = dict(
			frappe.get_all(
				"User", filters={"name": ("in", list({u.user for u in urows}) or [""])}, fields=["name", "full_name"], as_list=True
			)
		)
		names = {u.user: full_names.get(u.user) or u.user for u in urows}
		for u in urows:
			out[u.parent] = [names[u.user]] + [x for x in out.get(u.parent, []) if x != names[u.user]]
	return out


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


def _trail_sources(doctype, names, meta):
	"""Fetch trail sources for all documents in just two queries."""
	trace, done = {}, {}
	if not names:
		return trace, done
	if meta.has_field("snd_wf_trace"):
		child = meta.get_field("snd_wf_trace").options
		for t in frappe.get_all(
			child,
			filters={"parent": ("in", names), "parenttype": doctype, "parentfield": "snd_wf_trace"},
			fields=["parent", "workflow_state", "user", "date"],
			order_by="idx asc",
		):
			trace.setdefault(t.parent, []).append(t)
	for d in frappe.get_all(
		"Workflow Action",
		filters={"reference_doctype": doctype, "reference_name": ("in", names), "status": "Completed"},
		fields=["reference_name", "workflow_state", "completed_by", "modified"],
		order_by="modified asc",
	):
		done.setdefault(d.reference_name, []).append(d)
	return trace, done


def _trail(doc, meta, sources=None):
	"""Document trail: Workflow Trace if present, else completed Workflow Actions."""
	trace, done = sources or _trail_sources(doc.doctype, [doc.name], meta)
	rows = [[t.workflow_state, t.user, _hours_since(t.date), ""] for t in trace.get(doc.name, [])]
	if not rows:
		rows = [[d.workflow_state, d.completed_by or doc.owner, _hours_since(d.modified), ""] for d in done.get(doc.name, [])]
	state = doc.get("workflow_state")
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
			[r.owner, _hours_since(r.creation), frappe.utils.strip_html(r.content or "")[:400]]
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
	out = {}
	if not names:
		return out
	for r in frappe.get_all(
		"ToDo",
		filters={"reference_type": doctype, "reference_name": ("in", names), "status": "Open"},
		fields=["name", "reference_name", "description"],
	):
		out.setdefault(r.reference_name, {"name": r.name, "text": frappe.utils.strip_html(r.description or "")[:90]})
	return out


PTYPE_FOR_DOCSTATUS = {0: "write", 1: "submit", 2: "cancel"}


def _can_print(doctype):
	cache = _req_cache("can_print")
	if doctype not in cache:
		cache[doctype] = can(doctype, "print")
	return cache[doctype]


def action_allowed(doc, next_state, wfp):
	"""DocType permission needed for the action: write/submit/cancel based on the next state's docstatus."""
	status = {st["state"]: cint(st["doc_status"]) for st in wfp["states"]}
	ptype = PTYPE_FOR_DOCSTATUS.get(status.get(next_state, 0), "write")
	cache = _req_cache("action_perm")
	key = (doc.doctype, doc.name, ptype)
	if key not in cache:
		try:
			cache[key] = can(doc.doctype, ptype, doc=doc)
		except Exception:
			cache[key] = False
	return cache[key]


def _build_docs(doctype, names, workflows, pending_map, holders):
	"""Build the document bundle for one doctype with as few queries as possible."""
	meta = frappe.get_meta(doctype)
	comments = _comments(doctype, names)
	files = _files(doctype, names)
	todos = _linked_todo(doctype, names)
	sources = _trail_sources(doctype, names, meta)
	# document rows in one query, without child tables (items are loaded when a document is opened)
	rows = {r.name: r for r in frappe.get_all(doctype, filters={"name": ("in", names)}, fields=["*"])}
	has_conditions = any(t.get("conditionText") for t in workflows[doctype]["transitions"])
	out = []
	for name in names:
		row = rows.get(name)
		if not row:
			continue
		doc = frappe.get_doc({**row, "doctype": doctype})
		# silent check (common.can): no "does not have doctype access" popup for documents skipped here
		if not can(doctype, "read", doc=doc):
			continue
		pend = pending_map.get(name)
		try:
			# transition conditions may depend on child tables; only then load the full document
			tdoc = frappe.get_doc(doctype, name) if (pend and has_conditions) else doc
			trs = get_transitions(tdoc, raise_exception=False) if pend else []
		except Exception:
			trs = []
		wfp = workflows[doctype]
		tmap = {t["action"]: t for t in wfp["transitions"] if t["state"] == doc.get("workflow_state")}
		actions = []
		for t in trs:
			if not action_allowed(tdoc, t.get("next_state"), wfp):
				continue
			base = tmap.get(t.get("action"), {})
			actions.append({
				"action": t.get("action"),
				"next_state": t.get("next_state"),
				"tone": base.get("tone", "green"),
				"needsNote": base.get("needsNote", 0),
				"destructive": base.get("destructive", 0),
				"allowed": _(t.get("allowed")),
			})
		party = _doc_party(doc, meta)
		out.append({
			"doctype": doctype,
			"name": doc.name,
			"state": doc.get("workflow_state"),
			"owner": doc.owner,
			"party": party,
			"title_is_name": 1 if party == doc.name else 0,
			"amount": flt(doc.get("grand_total") or doc.get("total") or 0),
			"amountText": fmt_money(doc.get("grand_total") or 0, currency=doc.get("currency"))
			if meta.has_field("grand_total") else "",
			"pending": 1 if pend else 0,
			"can_print": 1 if _can_print(doctype) else 0,
			"actions": actions,
			"holder": " · ".join(holders.get(pend or pending_map.get(name + "__holder"), [])),
			"since": _hours_since(pending_map.get(name + "__creation") or doc.modified),
			"fields": _gov_fields(doc, meta),
			"items": [],
			"trail": _trail(doc, meta, sources),
			"comments": comments.get(name, []),
			"files": files.get(name, []),
			"checks": [],
			"todo": (todos.get(name) or {}).get("text", ""),
			"todo_name": (todos.get(name) or {}).get("name", ""),
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
		dt: {"ar": _(dt), "icon": DOCTYPE_ICONS.get(dt, "i-copy"), "short": _(dt)}
		for dt in workflows
	}

	# 1) awaiting my decision, from open Workflow Actions
	actions = _open_actions_for_me(me, roles)
	actions = [a for a in actions if a.reference_doctype in workflows][:limit]
	holders = _holders([a.name for a in actions])

	by_type, pending_map = {}, {}
	for a in actions:
		by_type.setdefault(a.reference_doctype, []).append(a.reference_name)
		pending_map[a.reference_name] = a.name
		pending_map[a.reference_name + "__creation"] = a.creation

	# 2) sent by me: my documents not yet in a final state
	for dt, wfp in wf_payload.items():
		final = wfp["final"]
		filters = {"owner": me, "workflow_state": ("not in", final or ["__none__"])}
		try:
			mine = frappe.get_all(dt, filters=filters, pluck="name", limit=25, order_by="modified desc")
		except Exception:
			mine = []
		for n in mine:
			if n not in pending_map:
				by_type.setdefault(dt, []).append(n)

	# current decision holder for any open document (including ones I sent)
	holder_map = {}
	for dt, names in by_type.items():
		for a in frappe.get_all(
			"Workflow Action",
			filters={"reference_doctype": dt, "reference_name": ("in", list(set(names))), "status": "Open"},
			fields=["name", "reference_name", "creation"],
		):
			holder_map[a.reference_name] = a.name
			pending_map.setdefault(a.reference_name + "__creation", a.creation)
	holders.update(_holders([n for n in holder_map.values() if n not in holders]))
	for name, action in holder_map.items():
		pending_map.setdefault(name + "__holder", action)

	docs = []
	for dt, names in by_type.items():
		docs += _build_docs(dt, list(dict.fromkeys(names)), wf_payload, pending_map, holders)

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


def _decision_log(me, wf_payload, limit=200):
	"""My decisions: the actual action (from the old->new transition), how long it waited on me, my note, and the document's current state."""
	doctypes = list(wf_payload)
	if not doctypes:
		return []
	versions = frappe.db.sql(
		"""
		SELECT ref_doctype, docname, creation, data FROM `tabVersion`
		WHERE owner = %(me)s AND ref_doctype IN %(dts)s AND creation >= %(since)s AND data LIKE %(like)s
		ORDER BY creation DESC LIMIT %(limit)s
		""",
		{"me": me, "dts": doctypes, "since": add_days(now_datetime(), -LOG_DAYS), "like": "%workflow_state%", "limit": cint(limit)},
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

	# current decision holder for unfinished documents
	open_actions = {}
	for dt, names in by_dt.items():
		for a in frappe.get_all(
			"Workflow Action",
			filters={"reference_doctype": dt, "reference_name": ("in", list(names)), "status": "Open"},
			fields=["name", "reference_name"],
		):
			open_actions[(dt, a.reference_name)] = a.name
	holders = _holders(list(open_actions.values()))

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
				note = frappe.utils.strip_html(c.content or "").strip()[:300]
				break
		now_state = now_rows.get(key)
		holder_action = open_actions.get(key)
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
			"holder": "، ".join((holders.get(holder_action) or [])[:2]) if holder_action else "",
			"by": me,
		})
	return out


def _primary_role(user):
	roles = [
		r for r in frappe.get_roles(user)
		if r not in ("All", "Guest", "Desk User", "Employee", "Employee Self Service")
	]
	return _(roles[0]) if roles else _("User")


@frappe.whitelist()
def apply_action(doctype, docname, action, note=None):
	"""Apply a real workflow action and save the note as a comment on the document."""
	doc = frappe.get_doc(doctype, docname)
	doc.check_permission("read")
	prev = doc.get("workflow_state")
	# check DocType permission before any change (even the comment)
	tr = next((t for t in get_transitions(doc) if t.get("action") == action), None)
	if not tr:
		frappe.throw(_("This action is not available for you at this stage"), frappe.PermissionError)
	wfp = workflow_payload(frappe.get_cached_doc("Workflow", get_workflow_name(doctype)))
	if not action_allowed(doc, tr.get("next_state"), wfp):
		frappe.throw(_("You do not have permission to perform this action"), frappe.PermissionError)
	note = (note or "").strip()
	if note:
		doc.add_comment("Comment", note)
	doc = apply_workflow(doc, action)
	frappe.db.commit()
	return {"ok": 1, "prev": prev, "next": doc.get("workflow_state"), "name": doc.name}


@frappe.whitelist()
def add_comment(doctype, docname, text):
	text = (text or "").strip()
	if not text:
		frappe.throw(_("Comment cannot be empty"))
	doc = frappe.get_doc(doctype, docname)
	doc.check_permission("read")
	doc.add_comment("Comment", text)
	frappe.db.commit()
	return {"ok": 1}


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
	if _has_permitted_users_table():
		for u in frappe.get_all("Workflow Action Permitted User", filters={"parent": action}, pluck="user"):
			targets.add(u)
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
		frappe.get_doc({
			"doctype": "Notification Log",
			"for_user": u,
			"type": "Alert",
			"document_type": doctype,
			"document_name": docname,
			"subject": _("Reminder: {0} is waiting for your decision").format(docname),
			"from_user": frappe.session.user,
		}).insert(ignore_permissions=True)
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
		"trail": _trail(doc, meta) if with_trail else [],
		"fields": _gov_fields(doc, meta),
		"state": doc.get("workflow_state"),
	}
