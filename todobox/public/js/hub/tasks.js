/* ToDoBox: task actions: snooze, follow-up, checklist, complete, keyboard, attachments and permissions */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /* ---------- smart snooze ---------- */
  /** names: one task, or several (bulk) — the dialog has a single Frappe Datetime field */
  openSnooze = (names) => {
    const list = [].concat(names || this.state.sel || []);
    if (list.length === 1 && !this.guardLocked(this.taskByName(list[0]))) return;
    this.setState({ snoozeFor: names || this.state.sel });
  };
  closeSnooze = () => this.setState({ snoozeFor: null });
  saveSnooze = async () => {
    const ctl = this._fx && this._fx.snoozeUntil;
    const day = ctl && ctl.get_value(); /* Date field → 'YYYY-MM-DD'; the API takes a datetime: start of that day */
    const until = day ? String(day).slice(0, 10) + ' 00:00:00' : null;
    if (!until) { if (ctl) { ctl.set_error(true); ctl.focus(); } return; }
    const names = [].concat(this.state.snoozeFor || []);
    this.setState({ snoozeFor: null });
    let res = null;
    for (const name of names) res = await this.api.snoozeTodo(name, until);
    if (res) this.toast(__('Snoozed until {0}', [this.fmtSnooze(res)]));
    this.load();
    this.refreshAfterChange();
  };
  /** the server returns {until: 'YYYY-MM-DD HH:mm:ss'} (system time zone) → user date format, no seconds */
  fmtSnooze(res) {
    const v = (res && (res.until || res.snoozeUntil)) || '';
    if (!v) return '';
    try { return frappe.datetime.str_to_user(v).replace(/(\d{1,2}:\d{2}):\d{2}/, '$1'); } catch (e) { return String(v).slice(0, 16); }
  }
  cancelSnooze = async () => {
    await this.api.unsnooze(this.state.sel);
    this.toast(__('Task moved back to Inbox'));
    this.load(this.state.sel);
  };

  /* ---------- follow-up ---------- */
  sendReminder = async () => {
    const name = this.state.sel;
    const res = await this.api.remindTodo(name);
    if (!res) { this.toast(__('Could not send the reminder')); return; }
    this.toast(__('Reminder sent and logged in the conversation'));
    this.load(name);
    this.loadAux();
    this.loadTemplates();
  };

  /* ---------- act on the linked document ---------- */
  runDoc = async (actionId) => {
    const name = this.state.sel;
    if (!this.guardLocked(this.taskByName(name))) return;
    this.setState({ docBusy: true });
    const res = await this.api.runDocAction(name, actionId);
    this.setState({ docBusy: false });
    if (res) this.toast(__('{0} — {1} is now {2}', [res.actionLabel, res.reference_name, res.ref_status]));
    this.load(name);
    this.loadDocActions(name);
    if ((this.state.refDocs || {})[name]) this.loadRefDetail(name, true);
    this.refreshAfterChange();
  };

  /* ---------- checklist ---------- */
  toggleCheck = async (id) => {
    const name = this.state.sel;
    if (!this.guardLocked(this.taskByName(name))) return;
    await this.api.toggleChecklist(name, id);
    this.load(name);
  };
  addCheck = async () => {
    if (!this.guardAddCheck(this.selTask())) return;
    const txt = this.state.newCheck.trim();
    if (!txt) return;
    await this.api.addChecklistItem(this.state.sel, txt);
    this.setState({ newCheck: '' });
    this.load(this.state.sel);
  };

  
  removeCheck = async (id) => {
    if (!this.guardManage(this.selTask())) return;
    const name = this.state.sel;
    await this.api.removeChecklistItem(name, id);
    this.load(name);
  };
  applyTemplateToSel = async (templateId) => {
    if (!this.guardManage(this.selTask())) return;
    const name = this.state.sel;
    const t = this.state.templates.find((x) => x.id === templateId);
    if (!name || !t) return;
    const res = await this.api.applyTemplate(name, templateId);
    if (res) this.toast(__('Added steps from template "{0}"', [t.label]));
    this.load(name);
  };

  markRead(name) {
    const t = (this.state.tasks || []).find((x) => x.name === name);
    if (t && t.read) return;
    this.api.updateTodo(name, { read: true });
  }
  selected() { return this.state.tasks.find((t) => t.name === this.state.sel) || null; }
  toast(text) {
    this.setState({ toast: text });
    this.timers.push(setTimeout(() => this.setState({ toast: null }), 2600));
  }

  /* ---------- actions (optimistic) ---------- */
  complete = async (name) => {
    const task = this.state.tasks.find((t) => t.name === name);
    if (!task || !this.guardLocked(task)) return;
    /* "closed" animation (fx-close.js): the row slides out, then leaves state */
    if (this.fxClosing && this.fxClosing(name)) return;
    if (this.fxClose) await this.fxClose(name);
    const tasks = this.state.tasks.filter((t) => t.name !== name);
    const sel = this.state.sel === name ? (tasks[0] ? tasks[0].name : null) : this.state.sel;
    this.setState({ tasks, sel, undo: { kind: 'done', name, text: __('Completed "{0}…" — moved to Completed', [task.subject.slice(0, 28)]) } });
    this.timers.push(setTimeout(() => this.setState((s) => (s.undo && s.undo.name === name ? { undo: null } : {})), 6000));
    await this.api.updateTodo(name, { status: 'Closed' });
    await this.api.addComment(name, { kind: 'event', html: __('completed the task') });
    this.setState({ counts: await this.api.getCounts() });
    this.refreshAfterChange();
  };
  snooze = (name) => this.openSnooze(name);
  doUndo = async () => {
    const u = this.state.undo;
    if (!u) return;
    await this.api.updateTodo(u.name, { status: 'Open' });
    this.setState({ undo: null });
    this.toast(__('Undone'));
    this.load(u.name);
  };
  /** Actions for the task's linked document (from the server) */
  loadDocActions = async (name) => {
    const t = (this.state.tasks || []).find((x) => x.name === name);
    if (!t || !t.reference_name || !this.api.getDocActions) return;
    const r = await this.api.getDocActions(name);
    this.setState((st) => ({ docActs: { ...(st.docActs || {}), [name]: r || { actions: [] } } }));
  };

  open = (name) => {
    this.markRead(name);
    this.loadDocActions(name);
    this.setState((s) => ({
      sel: name, mobileScreen: 'detail', pane: 'detail', draft: '', showEvents: false,
      tasks: s.tasks.map((t) => (t.name === name ? { ...t, read: true } : t)),
    }));
  };

  /** Open a task by name even if it's not in the current list (e.g. a task linked to a document) */
  openTask = async (name) => {
    if (!name) return;
    this.setState({ screen: 'mail', pane: 'detail', mobileScreen: 'detail' });
    if (!(this.state.tasks || []).some((t) => t.name === name)) {
      let t = null;
      try { t = await this.api.getTodo(name); } catch (e) { t = null; }
      if (!t) { this.toast(__('You do not have access to this task')); return; }
      this.setState((st) => ({ tasks: [t, ...st.tasks.filter((x) => x.name !== name)] }));
    }
    this.open(name);
  };

  /** A notification opens its item inside the list it belongs to: the ToDo's folder for me
      (Inbox, CC to me, Sent, …) or the Required-actions screen for a workflow document */
  openNotifTarget = (n) => {
    if (!n) return;
    if (n.docname && !n.todo) {
      this.wfGo('pending');
      this.wfOpenDoc(n.docname);
      this.scrollToRow(n.docname);
      return;
    }
    if (!n.todo) return;
    const folder = n.folder || 'inbox';
    this.setState({ screen: 'mail', folder, label: null, activeView: null, search: '', searchInput: '', loading: true, sel: null },
      () => Promise.resolve(this.load()).catch(() => {}).then(() => this.openTask(n.todo)).then(() => this.scrollToRow(n.todo)));
  };

  /** Bring a list row (task or workflow document) into view once it has rendered; retries briefly
      because the list may still be loading */
  scrollToRow(name, tries = 25) {
    const esc = window.CSS && CSS.escape ? CSS.escape(name) : String(name).replace(/"/g, '\\"');
    const el = document.querySelector('[data-row="' + esc + '"]');
    if (el) {
      const smooth = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    if (tries > 0) setTimeout(() => this.scrollToRow(name, tries - 1), 120);
  }

  /* ---------- keyboard ---------- */
  onKey = (e) => {
    const typing = /INPUT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable;
    if (this.filePvKey(e)) { e.preventDefault(); return; }
    if (!typing && this.qlKey(e)) { e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.setState({ cmdk: true, cmdq: '' }); return; }
    if (e.key === 'Escape') {
      /* layered: close the innermost open surface first */
      const st = this.state;
      if (st.savingView) { this.setState({ savingView: false, saveViewErr: null }); return; }
      if (st.themeMenu) { this.closeThemeMenu(true); return; }
      if (st.automation && (st.ruleForm || st.recForm)) { this.setState({ ruleForm: null, recForm: null }); return; }
      if (!typing && st.screen === 'templates' && (st.tplSel || st.tplDraft) && !st.compose && !st.forward && !st.cmdk && !st.shortcuts) { this.setState({ tplSel: null, tplDraft: null, tplConfirmDel: false }); return; }
    }
    if (e.key === 'Escape') { this.setState({ dateEdit: null, cmdk: false, shortcuts: false, compose: null, forward: null, ppl: null, checked: [], notifsOpen: false, snoozeFor: null, automation: null, wfConfirm: null, userMenu: false, themeMenu: false }); return; }
    if (typing) return;
    /* two-key "g then x" sequences: resolved against the palette command list (single source of truth) */
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const pk = e.key.toLowerCase();
      if (this._gAt && Date.now() - this._gAt < 1500) {
        this._gAt = 0;
        const cmd = this.paletteCommands().find((c) => c.key === 'g ' + pk);
        if (cmd) { e.preventDefault(); cmd.onDo(); return; }
      } else if (pk === 'g' && !e.shiftKey) { this._gAt = Date.now(); e.preventDefault(); return; }
    }
    if (this.state.screen === 'wf') { if (this.wfKey(e)) { e.preventDefault(); } return; }
    const sel = this.state.sel;
    const idx = this.state.tasks.findIndex((t) => t.name === sel);
    const go = (n) => { const t = this.state.tasks[n]; if (t) this.open(t.name); };
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); this.openCompose(); }
    else if (/^[esfr]$/.test(k) && sel && this.isLocked(this.taskByName(sel))) { e.preventDefault(); this.guardLocked(this.taskByName(sel)); }
    else if (k === 'e' && sel) { e.preventDefault(); this.complete(sel); }
    else if (k === 's' && sel) { e.preventDefault(); this.openSnooze(sel); }
    else if (k === 'f' && sel) { e.preventDefault(); this.openForward(); }
    else if (k === 'r' && sel) { e.preventDefault(); this.setState({ tab: 'reply', composerOpen: true }); }
    else if (k === 'k' && sel) { e.preventDefault(); this.setState({ tab: 'comment', composerOpen: true }); }
    else if (k === '?') { e.preventDefault(); this.setState({ shortcuts: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(Math.max(0, idx - 1)); }
  };

  /* ---------- composer ---------- */
  fileInput = React.createRef();

  /** Attach a file to an existing task: Frappe's FileUploader linked directly to the ToDo */
  attachToTodo = () => {
    const name = this.state.sel;
    if (!name) return;
    const P = this.pf();
    if (!P || !P.ui) { if (this.fileInput.current) this.fileInput.current.click(); return; }
    if (!P.ui.FileUploader) {
      if (this.fileInput.current) this.fileInput.current.click();
      return;
    }
    const added = [];
    let timer = null;
    new P.ui.FileUploader({
      doctype: 'ToDo',
      docname: name,
      folder: 'Home/Attachments',
      allow_multiple: true,
      on_success: (file) => {
        if (!file) return;
        added.push(file.file_name || file.file_url);
        clearTimeout(timer);
        timer = setTimeout(() => this.afterTodoAttach(name, added.splice(0)), 300);
      },
    });
  };
  onTodoLocalFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const name = this.state.sel;
    const P = this.pf();
    if (!files.length || !name) return;
    const done = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f, f.name);
      fd.append('doctype', 'ToDo');
      fd.append('docname', name);
      fd.append('is_private', '1');
      fd.append('folder', 'Home/Attachments');
      try {
        const r = await fetch('/api/method/upload_file', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Frappe-CSRF-Token': (P && P.csrf_token) || '' } });
        if (r.ok) done.push(f.name);
      } catch (err) { /* */ }
    }
    if (done.length) this.afterTodoAttach(name, done);
    else this.toast(__('Could not upload the file'));
  };
  afterTodoAttach = async (name, labels) => {
    if (!labels.length) return;
    await this.api.addComment(name, { kind: 'event', html: __('Added attachment {0}', [labels.map((l) => '«' + l + '»').join(', ')]) });
    this.toast(__('Attached {0} file(s)', [labels.length]));
    this.load(name);
  };

  /** Completed / cancelled tasks are read-only: only comments and attachments are allowed */
  isLocked(t) { return !!(t && t.status && t.status !== 'Open'); }
  guardLocked(t) {
    if (!this.isLocked(t)) return true;
    this.toast(__('This task is completed — you can only add comments and attachments'));
    return false;
  }
  taskByName(name) { return (this.state.tasks || []).find((x) => x.name === name); }

  /** Priority, date, subject, removing steps and templates: task creator only (the assignee can tick and add steps) */
  canManage(t) {
    if (!t || this.isLocked(t)) return false;
    const me = this.api && this.api.ME;
    return !t.assigned_by || t.assigned_by === me || me === 'Administrator';
  }
  guardManage(t) {
    if (!this.guardLocked(t)) return false;
    if (this.canManage(t)) return true;
    this.toast(__('Only the task creator can edit priority, date, subject and checklist'));
    return false;
  }
  /** Adding checklist steps: task creator or assignee */
  canAddCheck(t) {
    if (!t || this.isLocked(t)) return false;
    return this.canManage(t) || t.allocated_to === (this.api && this.api.ME);
  }
  guardAddCheck(t) {
    if (!this.guardLocked(t)) return false;
    if (this.canAddCheck(t)) return true;
    this.toast(__('Only the task creator or assignee can add checklist steps'));
    return false;
  }
  selTask() { return (this.state.tasks || []).find((x) => x.name === this.state.sel); }

  setDueDate = async (name, date) => {
    if (!this.guardManage((this.state.tasks || []).find((x) => x.name === name))) return;
    this.setState((st) => ({ tasks: st.tasks.map((x) => (x.name === name ? { ...x, date } : x)) }));
    await this.api.updateTodo(name, { date });
    this.toast(__('Due: {0}', [date]));
  };

  /** Copy the task link (Frappe ToDo form) to the clipboard */
  copyTaskLink = (name) => {
    if (!name) return;
    this.copyText(location.origin + '/desk/todo/' + encodeURIComponent(name), __('Task link copied'), __('Could not copy the link'));
  };

  /** Copy any text to the clipboard (async API, then execCommand, then the Desk helper) and toast the result */
  copyText = async (text, okMsg, failMsg) => {
    const val = text == null ? '' : String(text);
    const done = () => this.toast(okMsg || __('Copied'));
    try {
      const nav = navigator;
      if (nav.clipboard && window.isSecureContext !== false) { await nav.clipboard.writeText(val); done(); return; }
    } catch (e) { /* try the fallback */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = val; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, val.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) { done(); return; }
    } catch (e) { /* */ }
    try { const f = this.pf(); if (f && f.utils && f.utils.copy_to_clipboard) { f.utils.copy_to_clipboard(val); return; } } catch (e) { }
    this.toast(failMsg || __('Could not copy'));
  };

  setLabels = async (name, labels) => {
    if (!this.guardLocked(this.taskByName(name))) return;
    this.setState((st) => ({ tasks: st.tasks.map((x) => (x.name === name ? { ...x, labels: labels } : x)) }));
    await this.api.updateTodo(name, { labels: labels });
  };

  /** Composer keys: Enter sends, Shift+Enter = new line (the @mention popup handles Enter first; IME composing is left alone) */
  onComposerEnter = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229))) return;
    e.preventDefault();
    this.send(false);
  };

  /** Scroll the task conversation to its last message once it has rendered */
  scrollThreadEnd = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const box = document.querySelector('.tt-thread');
        const last = box && box.lastElementChild;
        if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } catch (e) { /* */ }
    }));
  };

  send = async (alsoComplete) => {
    if (this._sending) return;
    const draft = this.state.draft || '';
    const txt = draft.trim();
    if (!txt) { this.toast(__('Write some text first')); return; }
    const name = this.state.sel;
    const locked = this.isLocked(this.taskByName(name));
    if (locked) alsoComplete = false;
    const mentions = this.mentionEmails(txt);
    this._sending = true;
    this.setState({ sending: true, draft: '', mention: null });
    const res = await this.api.addComment(name, { kind: locked ? 'comment' : this.state.tab, html: txt, mentions: mentions });
    this._sending = false;
    if (!res) {
      /* failed (the API returns null on error): put the text back */
      this.setState((st) => ({ sending: false, draft: st.draft ? draft + '\n' + st.draft : draft }));
      this.toast(__('Could not send, please try again'));
      return;
    }
    this.mentionReset();
    this.setState({ sending: false });
    if (alsoComplete) { this.complete(name); return; }
    await this.load(name);
    if (this.state.sel === name) this.scrollThreadEnd();
  };

  cyclePriority(t) {
    if (!this.guardManage(t)) return;
    const o = ['High', 'Medium', 'Low'];
    const next = o[(o.indexOf(t.priority) + 1) % 3];
    this.api.updateTodo(t.name, { priority: next });
    this.setState((s) => ({ tasks: s.tasks.map((x) => (x.name === t.name ? { ...x, priority: next } : x)) }));
  }
  bumpDate(t) {
    if (!this.guardManage(t)) return;
    const d = new Date(t.date); d.setDate(d.getDate() + 1);
    const nd = d.toISOString().slice(0, 10);
    this.api.updateTodo(t.name, { date: nd });
    this.setState((s) => ({ tasks: s.tasks.map((x) => (x.name === t.name ? { ...x, date: nd } : x)) }));
    this.toast(__('Due: {0}', [nd]));
  }
});
