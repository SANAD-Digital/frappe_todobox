/* =============================================================================
   ToDoBox — data layer (ES module)
   Every function talks to todobox.api through window.ToDoBoxBridge
   (public/js/todobox/bridge.js). The signatures are what the hub/ parts use.
   ============================================================================= */

/* translation: window.__ from frappe_shim.js */
const __ = (t, r) => (typeof window !== 'undefined' && window.__ ? window.__(t, r) : (r ? String(t).replace(/\{(\d+)\}/g, (m, i) => (r[i] !== undefined ? r[i] : m)) : t));

export let ME = (typeof frappe !== 'undefined' && frappe.session && frappe.session.user) ? frappe.session.user : 'Administrator';

export const USERS = {};

const pad = (n) => String(n).padStart(2, '0');
const base = new Date();
const dayISO = (o) => { const x = new Date(base); x.setDate(x.getDate() + o); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export let TODAY = dayISO(0);

const bridge = () => window.ToDoBoxBridge;
const API = 'todobox.api.';
const srv = (method, args) => bridge().callOrNull(API + method, args || {});
/** Call through the bridge; any unexpected exception returns the fallback instead of breaking the UI */
async function safe(fn, fallback = null) {
  try { return await fn(); } catch (e) { console.error('ToDoBox API error:', e); return fallback; }
}


/* ---------------------------------------------------------------------------
   Folders
   --------------------------------------------------------------------------- */
export const FOLDERS = [
  { id: 'inbox',   label: __('Inbox'),          icon: 'inbox' },
  { id: 'overdue', label: __('Overdue'),        icon: 'clock' },
  { id: 'today',   label: __('Today'),          icon: 'calendar' },
  { id: 'sent',    label: __('Sent'),           icon: 'send' },
  { id: 'fwd',     label: __('Forwarded'),      icon: 'forward' },
  { id: 'cc',      label: __('CC to me'),       icon: 'copy' },
  { id: 'waiting', label: __('Awaiting reply'), icon: 'hourglass' },
  { id: 'snoozed', label: __('Snoozed'),        icon: 'moon' },
  { id: 'done',    label: __('Completed'),      icon: 'check-circle' },
  { id: 'team',    label: __('My team'),        icon: 'users' },
];

/* last message (not event) in the thread */
export function lastMessage(t) {
  const msgs = (t.thread || []).filter((x) => x.kind !== 'event');
  return msgs[msgs.length - 1] || null;
}
/* days I've been waiting for the other party to reply */
export function waitingDays(t) {
  if (t.status !== 'Open' || t.assigned_by !== ME || t.allocated_to === ME) return null;
  const m = lastMessage(t);
  if (!m || m.user !== ME) return null;
  const diff = Math.floor((new Date(TODAY) - new Date(m.ts.slice(0, 10))) / 86400000);
  return diff;
}


let _usersAt = 0;
let _usersInflight = null;
async function syncUsers(force = false) {
  if (!force && Date.now() - _usersAt < 300000 && Object.keys(USERS).length) return;
  if (_usersInflight) return _usersInflight;
  _usersInflight = _syncUsers().finally(() => { _usersInflight = null; });
  return _usersInflight;
}
async function _syncUsers() {
  const data = await safe(() => bridge().getUsers());
  if (data && data.users) {
    Object.assign(USERS, data.users);
    if (data.me) ME = data.me;
    if (data.today) TODAY = data.today;
    _usersAt = Date.now();
  }
}

export async function listTodos({ folder = 'inbox', quick = 'all', search = '', label = null, sort = 'modified' } = {}) {
  return safe(async () => {
    await syncUsers();
    return await bridge().listTodos({ folder, quick, search, label, sort });
  }, []);
}

export const SORTS = [
  { id: 'modified', label: __('Recently updated') },
  { id: 'due', label: __('Due soonest') },
  { id: 'priority', label: __('Priority') },
  { id: 'oldest', label: __('Oldest created') },
];

export async function getCounts() { return (await safe(() => bridge().getCounts())) || {}; }

/* task with its thread and attachments */
export async function getTodo(name) { return safe(() => bridge().getTodo(name)); }

export async function updateTodo(name, patch) { return safe(() => bridge().updateTodo(name, patch)); }

export async function addComment(name, { kind = 'reply', html = '', mentions = [] }) { return safe(() => bridge().addComment(name, kind, html, mentions)); }

/* a separate ToDo per recipient sharing thread_id; [] on failure (Frappe shows the reason) */
export async function createTodos({ to = [], cc = [], subject = '', body = '', priority = 'Medium', date = TODAY, reference_type = null, reference_name = null, labels = [], checklist = [], ref_amount = null, template = null, attachments = [] }) {
  const res = await safe(() => bridge().createTodos({ to, cc, subject, body, priority, date, reference_type, reference_name, labels, checklist, ref_amount, template, attachments }));
  return res && res.names && res.names.length ? res.names.map((n) => ({ name: n, rule_applied: null })) : [];
}

/* reassign: validation and permissions on the server; null on rejection (Frappe shows the reason) */
export async function forwardTodo(name, { to, mode = 'full', reason = '' }) {
  return safe(() => bridge().forwardTodo(name, { to, mode, reason }));
}

/* server-side recipient search (don't load all users); results are merged into USERS for name display */
export async function searchUsers(txt, exclude) {
  const rows = (await srv('search_users', { txt: txt || '', limit: 20, exclude: JSON.stringify(exclude || []) })) || [];
  rows.forEach((u) => {
    if (!USERS[u.id]) USERS[u.id] = { name: u.name, initials: u.initials, color: u.color, user_image: u.user_image };
  });
  return rows;
}

/* Live updates: frappe.realtime "list_update" on ToDo, plus a refresh when returning to the tab.
   Bursts of notifications are coalesced into one refresh. */
let subs = [];
let _rtWired = false;
let _rtTimer = null;
let _hiddenAt = 0;
function emitRealtime() {
  clearTimeout(_rtTimer);
  _rtTimer = setTimeout(() => subs.forEach((s) => { try { s(); } catch (e) { console.error(e); } }), 800);
}
function wireRealtime() {
  if (_rtWired) return;
  _rtWired = true;
  try {
    const rt = window.frappe && window.frappe.realtime;
    if (rt) {
      rt.on('list_update', (data) => { if (!data || data.doctype === 'ToDo') emitRealtime(); });
      rt.doctype_subscribe('ToDo');
    }
  } catch (e) { /* no socket.io: refresh only on returning to the tab */ }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { _hiddenAt = Date.now(); return; }
    if (_hiddenAt && Date.now() - _hiddenAt > 30000) emitRealtime();
  });
}
export function onRealtime(fn) {
  subs.push(fn);
  wireRealtime();
  return () => { subs = subs.filter((s) => s !== fn); };
}

/* task templates: DocType "ToDoBox Task Template" (loaded from the server) */
export const TASK_TEMPLATES = [];


/* ---------- 1. Act on the linked document from within the task ---------- */
/** Linked document actions from the server (real workflow transitions, with user permissions) */
export async function getDocActions(name) { return (await srv('get_doc_actions', { name })) || { actions: [], ref_status: '' }; }
export async function runDocAction(name, actionId) { return srv('run_doc_action', { name, action_id: actionId }); }
/** Linked-document tabs of a task: { readable, fields, items, comments, files, trail, has_workflow, users, ... } */
export async function getReferenceDetail(name) { return srv('get_reference_detail', { name }); }
export async function addReferenceComment(name, text) { return srv('add_reference_comment', { name, text }); }

/* ---------- 2. Smart snooze ---------- */
/** until: 'YYYY-MM-DD HH:mm:ss' — the date & time the user chose (Frappe Datetime control) */
export async function snoozeTodo(name, until) {
  return safe(() => bridge().snoozeTodo(name, until));
}
export async function unsnooze(name) { return safe(() => bridge().unsnoozeTodo(name)); }

/* ---------- 3. Follow-up: reminders on stale tasks ---------- */
export async function remindTodo(name, text) { return srv('remind_todo', { name, text: text || '' }); }
export const STALE_DAYS = 3;

/* ---------- 4. Checklist (checklist_items -> ToDoBox Checklist Item) ---------- */
export async function toggleChecklist(name, itemId) { return safe(() => bridge().toggleChecklistItem(name, itemId)); }
export async function addChecklistItem(name, label) { return safe(() => bridge().addChecklistItem(name, label)); }
export async function removeChecklistItem(name, itemId) { return safe(() => bridge().removeChecklistItem(name, itemId)); }
/* add the template's missing steps to an existing task's checklist */
export async function applyTemplate(name, templateId) { return safe(() => bridge().applyTaskTemplate(name, templateId)); }

/* task templates: load all (including disabled) into TASK_TEMPLATES */
export async function loadTemplates() {
  const rows = await safe(() => bridge().getTaskTemplates(true));
  if (Array.isArray(rows)) TASK_TEMPLATES.splice(0, TASK_TEMPLATES.length, ...rows);
  return TASK_TEMPLATES.map((t) => ({ ...t, checklist: [...(t.checklist || [])] }));
}
export async function saveTemplate(tpl) { return safe(() => bridge().saveTaskTemplate(tpl)); }
export async function deleteTemplate(id) { return safe(() => bridge().deleteTaskTemplate(id)); }

/* ---------- 5. Analytics: get_analytics({period, date_from, date_to, scope, user}) ---------- */
export async function getAnalytics(q) { return srv('get_analytics', q || {}); }

/* ---------- 6. Member workload when assigning ---------- */
export async function getWorkload() { return (await srv('get_workload')) || {}; }

/* ---------- 7. Automation: "ToDoBox Rule" and "ToDoBox Recurring Task" (todobox.automation) ---------- */
let RULES = [];
let RECURRING = [];
let CAN_MANAGE_RULES = false;
let RECURRING_ROLES = [];
const AUTO = 'todobox.automation.';
/** Frappe Tag list (Desk's "Tag" DocType): names matching txt */
export async function searchTags(txt) { return (await srv('search_tags', { txt: txt || '', limit: 20 })) || []; }

const autoCall = (method, args) => bridge().callOrNull(AUTO + method, args || {});
export async function loadAutomation() {
  const res = await safe(() => autoCall('get_automation'));
  if (res) {
    RULES = res.rules || [];
    RECURRING = res.recurring || [];
    CAN_MANAGE_RULES = !!res.can_manage_rules;
    RECURRING_ROLES = res.roles || [];
  }
  return { rules: RULES.map((x) => ({ ...x })), recurring: RECURRING.map((x) => ({ ...x })), canManageRules: CAN_MANAGE_RULES, roles: RECURRING_ROLES.map((x) => ({ ...x })) };
}
export async function saveRule(rule) { return autoCall('save_rule', { data: rule }); }
/** filterable fields of ToDo or of a rule's reference DocType, cached per DocType: [{fieldname,label,fieldtype,options}] */
const RULE_FIELDS = {};
export function getRuleFields(doctype) {
  const dt = doctype || 'ToDo';
  if (!RULE_FIELDS[dt]) {
    RULE_FIELDS[dt] = autoCall('get_rule_fields', { doctype: dt }).then((rows) => {
      if (!Array.isArray(rows)) delete RULE_FIELDS[dt];
      return Array.isArray(rows) ? rows : [];
    });
  }
  return RULE_FIELDS[dt];
}
export async function toggleRule(id) { return autoCall('toggle_rule', { name: id }); }
export async function deleteRule(id) { return autoCall('delete_rule', { name: id }); }
export async function saveRecurring(rec) { return autoCall('save_recurring', { data: rec }); }
export async function toggleRecurring(id) { return autoCall('toggle_recurring', { name: id }); }
export async function deleteRecurring(id) { return autoCall('delete_recurring', { name: id }); }
export async function runRecurringNow(id) { return autoCall('run_recurring_now', { name: id }); }

/* ---------- 8. Saved views: "ToDoBox Saved View" per user ---------- */
export let SAVED_VIEWS = [];
export async function loadViews() {
  const rows = await safe(() => srv('get_saved_views'));
  if (Array.isArray(rows)) SAVED_VIEWS = rows;
  return SAVED_VIEWS.map((v) => ({ ...v }));
}
export async function saveView(label, query, sort) {
  const v = await safe(() => srv('save_view', { label, query, sort: sort || 'modified' }));
  if (v) SAVED_VIEWS = [...SAVED_VIEWS, v];
  return v;
}
export async function deleteView(id) {
  const rows = await safe(() => srv('delete_view', { id }));
  if (Array.isArray(rows)) SAVED_VIEWS = rows;
  return SAVED_VIEWS;
}
/** Task count per view in one call -> { id: count } */
export async function countViews(views) {
  const list = views || SAVED_VIEWS;
  if (!list.length) return {};
  const queries = {};
  list.forEach((v) => { queries[v.id] = v.query || ''; });
  return (await safe(() => srv('count_queries', { queries }))) || {};
}

/* ---------- 9. Notification center ---------- */
export const NOTIF_KINDS = {
  assign: { icon: 'user-plus', tone: 'primary', label: __('Assignment') },
  reply: { icon: 'reply', tone: 'green', label: __('Reply') },
  overdue: { icon: 'clock', tone: 'red', label: __('Overdue') },
  cc: { icon: 'copy', tone: 'fg2', label: __('CC') },
  rule: { icon: 'bolt', tone: 'fg2', label: __('Rule') },
  stale: { icon: 'hourglass', tone: 'amber', label: __('Stale') },
  remind: { icon: 'bell', tone: 'primary', label: __('Reminder') },
  wf: { icon: 'bolt', tone: 'amber', label: __('Required action') },
};
export async function getNotifications() {
  const res = await safe(() => bridge().getNotifications());
  return Array.isArray(res) ? res : [];
}
export async function markNotifRead(id) {
  await safe(() => bridge().markNotifRead(id));
  return getNotifications();
}
export async function markAllNotifsRead() {
  await safe(() => bridge().markAllNotifsRead());
  return getNotifications();
}

/* ---------- 10. Today plan ---------- */
export async function getDayPlan() { return (await safe(() => bridge().getDayPlan())) || []; }
export async function reorderDay(name, dir) { return (await srv('reorder_day', { name, direction: dir })) || getDayPlan(); }
export async function dropFromDay(name) { return (await srv('drop_from_day', { name })) || getDayPlan(); }
