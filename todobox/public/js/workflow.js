/* =============================================================================
   workflow.js: the "Required actions" layer, wired to real Frappe Workflow
   Source: todobox.workflow_api
     · pending: what the Desk form would offer me (frappe.model.workflow.get_transitions + permissions)
     · frappe.model.workflow.apply_workflow, through apply_action
   The UI calls synchronous functions reading from memory; refresh() updates them from the server.
   ============================================================================= */

/* translation: window.__ from frappe_shim.js */
const __ = (t, r) => (typeof window !== 'undefined' && window.__ ? window.__(t, r) : (r ? String(t).replace(/\{(\d+)\}/g, (m, i) => (r[i] !== undefined ? r[i] : m)) : t));

/* --------------------------------------------------------------- transport */
/* frappe.call from frappe_shim.js: shows server messages and calls error on failure */
export function call(method, args) {
  return new Promise((resolve, reject) => {
    window.frappe.call({
      method: 'todobox.workflow_api.' + method,
      args: args || {},
      callback: (r) => resolve(r ? r.message : null),
      error: (e) => reject(e),
    });
  });
}

/* ------------------------------------------------------- live stores for the UI */
const withDefault = (target, mk) => new Proxy(target, {
  get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? mk(k) : undefined)),
});

const _users = {};
const _doctypes = {};
const _workflows = {};
const _tones = {};

export let ME = 'Administrator';
export let DOCS = [];
export let ACTION_LOG = [];
export let LOADED = false;

export const WF_USERS = withDefault(_users, (k) => ({
  name: k, role: '', initials: (k || '?').slice(0, 2), color: '',
}));
export const DOCTYPES = withDefault(_doctypes, (k) => ({ ar: k, icon: 'i-copy' }));
export const WORKFLOWS = withDefault(_workflows, () => ({ states: [], transitions: [], final: [] }));
export const STATE_TONE = withDefault(_tones, () => 'fg2');

let repaint = () => { };
export function setRepaint(fn) { repaint = typeof fn === 'function' ? fn : () => { }; }

const replaceMap = (target, src) => {
  Object.keys(target).forEach((k) => delete target[k]);
  Object.assign(target, src || {});
};

/* a document is identified by doctype + name: the same name may exist in two doctypes */
export const docKey = (d) => (d ? d.doctype + '\u0000' + d.name : '');
/** The document by name; doctype (when known) tells apart the same name in two doctypes */
export function findDoc(name, doctype) {
  return (doctype && DOCS.find((x) => x.name === name && x.doctype === doctype)) || DOCS.find((x) => x.name === name) || null;
}
export function findByKey(key) { return DOCS.find((x) => docKey(x) === key) || null; }

/* documents with an action on its way to the server (one at a time per document) */
const _busy = new Set();

/** GET all data: definitions + documents + log
    (throttled: one call in flight, no repeat within 15 seconds unless force;
     force during a call runs once more after it, since that call may have read older data) */
let _lastAt = 0;
let _inflight = null;
let _again = false;
export function refresh(force = false) {
  if (_inflight) { if (force) _again = true; return _inflight; }
  if (!force && LOADED && Date.now() - _lastAt < 15000) return Promise.resolve(true);
  _inflight = _refresh().finally(() => { _inflight = null; _lastAt = Date.now(); })
    .then((ok) => { if (!_again) return ok; _again = false; return refresh(true); });
  return _inflight;
}
async function _refresh() {
  let d = null;
  try { d = await call('get_workflow_inbox', {}); } catch (e) { d = null; }
  if (!d) { LOADED = true; return false; }

  ME = d.me || ME;
  replaceMap(_users, d.users);
  replaceMap(_doctypes, d.doctypes);
  replaceMap(_workflows, d.workflows);
  replaceMap(_tones, d.stateTones);
  DOCS = (d.docs || []).map((x) => {
    const doc = { comments: [], files: [], items: [], checks: [], trail: [], actions: [], ...x };
    /* its action is still on the way: this answer may predate it */
    if (_busy.has(docKey(doc))) { doc.pending = 0; doc.actions = []; }
    return doc;
  });
  ACTION_LOG = d.log || [];
  LOADED = true;
  return true;
}

/** Document details on open: items/comments/attachments/refreshed trail */
export async function loadDoc(name, doctype) {
  const d = findDoc(name, doctype);
  if (!d || d._detailed) return;
  d._detailed = true;
  let r = null;
  try { r = await call('get_doc_detail', { doctype: d.doctype, docname: d.name }); } catch (e) { r = null; }
  if (!r) { d._detailed = false; return; }
  Object.assign(d, {
    items: r.items || [], comments: r.comments || [], files: r.files || [],
    trail: r.trail || d.trail, fields: r.fields || d.fields, state: r.state || d.state,
    timeline: r.timeline || [], next_actions: r.next_actions || {},
  });
  repaint();
}

/** The user really opened the document (not a prefetch or an automatic selection): stamps "received" */
const _received = new Set();
export function markReceived(name, doctype) {
  const key = doctype + '::' + name;
  if (!name || !doctype || _received.has(key)) return;
  _received.add(key);
  window.frappe.call({
    method: 'todobox.services.wf_engine.mark_received',
    args: { doctype, name },
    callback: (r) => {
      const d = findDoc(name, doctype);
      if (r && r.message && d && d._detailed) { d._detailed = false; loadDoc(name, doctype); }
    },
    error: () => {},
  });
}

/* ------------------------------------------------------------------ engine */
export const wf = (dt) => WORKFLOWS[dt];

/** Buttons available to me now, computed on the server via get_transitions */
export function getTransitions(d) {
  return d && d.pending ? (d.actions || []) : [];
}

/** Displayed path: the states marked show_in_statusbar in status_no order, when the workflow has
    those (optional custom fields); otherwise the non-optional workflow states */
export function path(d) {
  const w = wf(d.doctype);
  const done = {};
  (d.trail || []).forEach((tr) => { done[tr[0]] = tr; });
  const marked = (w.states || []).filter((st) => st.show_in_statusbar);
  const list = marked.length
    ? marked.sort((a, b) => (a.status_no || 0) - (b.status_no || 0))
    : (w.states || []).filter((st) => !st.is_optional_state);
  const currentPos = list.findIndex((st) => st.state === d.state);
  return list.map((st, i) => {
    const tr = done[st.state];
    return {
      state: st.state,
      status: st.state === d.state ? 'current' : (currentPos === -1 ? (tr ? 'done' : 'next') : (i < currentPos ? 'done' : 'next')),
      by: tr ? tr[1] : null, hours: tr ? tr[2] : null, note: tr ? tr[3] : '',
    };
  });
}

/** Does the action lead to an "optional" state in the workflow? */
export function isOptionalTarget(d, t) {
  const st = (wf(d.doctype).states || []).find((x) => x.state === t.next_state);
  return !!(st && st.is_optional_state);
}

export function derailed(d) {
  const st = (wf(d.doctype).states || []).find((x) => x.state === d.state);
  return !!(st && st.is_optional_state);
}

/** Key fields, provided by the server from each doctype's Meta */
export function govFields(d) { return (d && d.fields) || []; }

export const headlineParty = (d) => (d && d.party) || '';

export function pendingHours(d) { return (d && d.since) || 0; }
export function agingTone(h) { return h < 24 ? 'fg3' : h < 72 ? 'amber' : 'red'; }
export function sinceText(h) {
  if (h < 1) return __('Just now');
  if (h < 24) { const hh = Math.round(h); return hh === 1 ? __('1 hour ago') : __('{0} hours ago', [hh]); }
  const dd = Math.round(h / 24);
  return dd === 1 ? __('1 day ago') : __('{0} days ago', [dd]);
}
/** Short format for cards: now / 3h / 2d */
export function sinceShort(h) {
  if (h < 1) return __('now');
  if (h < 24) return __('{0} h', [Math.round(h)]);
  return __('{0} d', [Math.round(h / 24)]);
}
export function tsOf(h) {
  const t = new Date(Date.now() - (h || 0) * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate()) + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
}

/* ------------------------------------------------------- list queries */
/* list cache, invalidated on any change to DOCS/ACTION_LOG */
let _memo = { docs: null, log: null, pending: null, sent: null, decisions: null };
function lists() {
  if (_memo.docs !== DOCS || _memo.log !== ACTION_LOG) {
    const byAge = (a, b) => pendingHours(b) - pendingHours(a);
    const actionable = (d) => d.pending && (d.actions || []).length;
    _memo = {
      docs: DOCS, log: ACTION_LOG,
      pending: DOCS.filter(actionable).sort(byAge),
      sent: DOCS.filter((d) => d.owner === ME && !actionable(d)).sort(byAge),
      decisions: ACTION_LOG.slice().sort((a, b) => a.hours - b.hours),
    };
  }
  return _memo;
}
const touch = () => { DOCS = DOCS.slice(); };
export function pendingForMe() { return lists().pending; }
export function sentByMe() { return lists().sent; }
export function myDecisions() { return lists().decisions; }
export function currentHolder(d) {
  if (d && d.holder) return d.holder;
  const t = (wf(d.doctype).transitions || []).find((x) => x.state === d.state && !x.destructive);
  return t ? t.allowed : '—';
}

/* ----------------------------------------------------------------- action */
/** POST apply_action (Frappe's apply_workflow): optimistic locally, then confirmed by the server.
    res.done resolves to the server's answer ({undo_action, queued, ...}), or null when it failed
    (the local change is then restored; Frappe's own error is shown by frappe.call). */
export function applyWorkflow(name, action, user, note, mentions, doctype) {
  const d = findDoc(name, doctype);
  if (!d) return null;
  const key = docKey(d);
  if (_busy.has(key)) return { busy: true };
  const t = getTransitions(d).find((x) => x.action === action);
  if (!t) return { error: __('This action is no longer available — the document status has changed') };

  const prev = d.state;
  const snapshot = { state: d.state, actions: d.actions, pending: d.pending, trail: (d.trail || []).slice(), comments: (d.comments || []).slice() };
  d.state = t.next_state;
  d.actions = [];
  d.pending = 0;
  d.trail = [...(d.trail || []), [t.next_state, ME, 0, note || '']];
  if (note) d.comments = [...(d.comments || []), [ME, 0, note]];
  const logRow = {
    doc: d.name, doctype: d.doctype, title: d.title_is_name ? '' : (d.party || ''), action, tone: t.tone || 'green', kind: 'decision',
    from: prev, to: t.next_state, hours: 0, ts: new Date().toISOString().replace('T', ' ').slice(0, 19),
    waited: typeof pendingHours === 'function' ? pendingHours(d) : null, note: note || '', exists: true, now: t.next_state, moved_on: false, final: false, holder: '', by: ME,
  };
  ACTION_LOG = [logRow, ...ACTION_LOG];
  touch();
  _busy.add(key);

  const done = call('apply_action', { doctype: d.doctype, docname: d.name, action, note: note || '', mentions: JSON.stringify(mentions || []) })
    .then((r) => r || { ok: 1 }, () => {
      /* only this document's row: other documents may have decisions in flight */
      Object.assign(d, snapshot);
      ACTION_LOG = ACTION_LOG.filter((x) => x !== logRow);
      touch();
      repaint();
      return null;
    })
    .then((r) => { _busy.delete(key); refresh(true).then(() => repaint()); return r; });

  return { ok: true, prev, next: t.next_state, doc: d, done };
}

/** Undo = the real reverse action the server named (undo_action), not deleting from the log */
export function undoWorkflow(name, action, prev, doctype) {
  const d = doctype ? DOCS.find((x) => x.name === name && x.doctype === doctype) : findDoc(name);
  const dt = doctype || (d && d.doctype);
  if (!dt || !action) return { error: __('Document not found') };
  const key = docKey({ doctype: dt, name });
  if (_busy.has(key)) return { busy: true };
  const snapshot = d ? { state: d.state, actions: d.actions, pending: d.pending } : null;
  if (d) { d.state = prev; d.actions = []; d.pending = 0; touch(); }
  _busy.add(key);
  const done = call('apply_action', { doctype: dt, docname: name, action, note: __('Decision reverted') })
    .then((r) => r || { ok: 1 }, () => {
      if (d) { Object.assign(d, snapshot); touch(); repaint(); }
      return null;
    })
    .then((r) => { _busy.delete(key); refresh(true).then(() => repaint()); return r; });
  return { ok: true, done };
}

export function addWfComment(name, user, text, mentions, doctype) {
  const d = findDoc(name, doctype);
  if (!d) return;
  d.comments = [...(d.comments || []), [ME, 0, text]];
  call('add_comment', { doctype: d.doctype, docname: d.name, text, mentions: JSON.stringify(mentions || []) }).then(() => repaint());
}

export function nudge(name, doctype) {
  const d = findDoc(name, doctype);
  if (!d) return '';
  call('nudge', { doctype: d.doctype, docname: d.name }).then(() => repaint());
  return currentHolder(d);
}

/* review checklist: local per browser (not stored on the document) */
const CK_KEY = 'todobox_wf_checks';
const readChecks = () => { try { return JSON.parse(localStorage.getItem(CK_KEY) || '{}'); } catch (e) { return {}; } };
const writeChecks = (o) => { try { localStorage.setItem(CK_KEY, JSON.stringify(o)); } catch (e) { } };

export function hydrateChecks() {
  const store = readChecks();
  /* d.name alone: what older versions stored */
  DOCS.forEach((d) => { const c = store[docKey(d)] || store[d.name]; if (c) d.checks = c; });
}
export function toggleWfCheck(name, id, doctype) {
  const d = findDoc(name, doctype);
  if (!d) return;
  d.checks = (d.checks || []).map((c) => (c.id === id ? { ...c, done: !c.done } : c));
  const store = readChecks(); store[docKey(d)] = d.checks; writeChecks(store);
}
export function addWfCheck(name, label, doctype) {
  const d = findDoc(name, doctype);
  if (!d) return;
  d.checks = [...(d.checks || []), { id: 'ck' + Math.random().toString(36).slice(2, 7), label, done: false }];
  const store = readChecks(); store[docKey(d)] = d.checks; writeChecks(store);
}
