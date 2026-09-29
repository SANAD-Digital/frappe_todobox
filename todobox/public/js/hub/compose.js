/* ToDoBox: create task / reassign + Frappe utilities (date, upload, rich text) */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /* formatting tools in "New task": wrap the selected text in HTML tags */
  composeBodyRef = (el) => { this.composeBodyEl = el; };
  applyRich = (kind) => {
    const el = this.composeBodyEl, c = this.state.compose;
    if (!el || !c) return;
    const v = c.body || '', a = el.selectionStart || 0, b = el.selectionEnd || 0;
    const sel = v.slice(a, b) || (kind === 'list' ? '' : __('text'));
    let ins;
    if (kind === 'list') {
      const lines = (sel || '').split('\n').filter((x) => x.trim());
      ins = '<ul>' + (lines.length ? lines : ['']).map((x) => '<li>' + x.trim() + '</li>').join('') + '</ul>';
    } else {
      const tag = { bold: 'b', italic: 'i', code: 'code' }[kind];
      ins = '<' + tag + '>' + sel + '</' + tag + '>';
    }
    const body = v.slice(0, a) + ins + v.slice(b);
    this.setState({ compose: { ...c, body } }, () => {
      try { el.focus(); const p = a + ins.length; el.setSelectionRange(p, p); } catch (e) { }
    });
  };
  /** Text with tags: newlines become <br> so they survive rendering */
  bodyToHtml(body) {
    const t = body || '';
    if (!/<(b|i|code|ul|li)>/.test(t)) return t;
    return t.replace(/\n(?!\s*<\/?(ul|li)>)/g, '<br>');
  }

  /* ---------- compose / forward ---------- */
  openCompose = () => this.setState({ compose: { to: [], cc: [], subject: '', body: '', priority: 'Medium', date: (this.api && this.api.TODAY) || new Date().toISOString().slice(0, 10), ref: null, labels: [], checklist: [], template: null, files: [] }, composeCCOpen: false, notifsOpen: false, composeTagPicker: false, composeNewTag: '', ppl: null }, this.loadComposeSuggest);

  /* =========================================================================
     Frappe utilities (frappe-web.bundle.js + frappe_shim.js): date formatting, upload, calls
     ========================================================================= */
  pf() { return window.frappe || null; }

  fmtUserDate(v) {
    if (!v) return __('No date');
    const P = this.pf();
    try { if (P && P.datetime && P.datetime.str_to_user) return P.datetime.str_to_user(v); } catch (e) { }
    return v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4);
  }

  /** Date picker: Frappe's real ControlDate / ControlDatetime in a small popover under the button
      (js/todobox/controls.js → TMControls.pickDate). opts: fieldtype 'Datetime', title, quick… */
  openFrappeDate(ev, value, onPick, opts) {
    const anchor = ev && (ev.currentTarget || ev.target);
    const go = () => window.TMControls.pickDate({ anchor, value, onPick, ...(opts || {}) });
    if (window.TMControls) go(); else (window.__tmcReady || Promise.resolve()).then(go);
    return true;
  }

  closeDateOverlay() { if (window.TMControls) window.TMControls.closeDatePop(); }

  /* ---------- Frappe controls outside the compose drawer (reassign, snooze) ---------- */
  fxSlot(key, make) {
    const cache = this._fxSlots || (this._fxSlots = {});
    if (!cache[key]) {
      cache[key] = (el) => {
        const ctls = this._fx || (this._fx = {});
        if (el) {
          if (ctls[key] && el.contains(ctls[key].wrap)) return;
          if (ctls[key]) { ctls[key].destroy(); delete ctls[key]; }
          (window.__tmcReady || Promise.resolve()).then(() => window.TMControls.ready()).then(() => {
            if (!el.isConnected || ctls[key]) return;
            ctls[key] = make(el);
          }, (e) => console.error(e));
        } else if (ctls[key]) { ctls[key].destroy(); delete ctls[key]; }
      };
    }
    return cache[key];
  }
  /** Frappe's invalid state on a mounted fxSlot control (cleared by the next change) + focus */
  fxInvalid(key) {
    const c = this._fx && this._fx[key];
    if (!c || !c.set_error) return;
    c.set_error(true);
    if (!c._fxErrHook) {
      c._fxErrHook = true;
      const prev = c.opts.onChange;
      c.opts.onChange = (v) => { c.set_error(false); if (prev) prev(v); };
    }
    setTimeout(() => c.focus(), 0);
  }
  fxVals() {
    const X = () => window.TMControls, A = () => this.api || {};
    this._fwdNames = this._fwdNames || {};
    return {
      /* snooze dialog: a single Frappe Date field (date only; snoozes until the start of that day) */
      snoozeUntil: this.fxSlot('snoozeUntil', (el) => {
        const one = typeof this.state.snoozeFor === 'string' ? (this.state.tasks || []).find((t) => t.name === this.state.snoozeFor) : null;
        const ctl = new (X().Field)(el, { value: (one && one.snooze_until && String(one.snooze_until).slice(0, 10)) || null, label: __('Snooze until'), reqd: 1,
          onChange: () => ctl.set_error(false) },
        { fieldtype: 'Date', fieldname: 'snooze_until' });
        setTimeout(() => ctl.focus(), 50);
        return ctl;
      }),
      fwdTo: this.fxSlot('fwdTo', (el) => new (X().Link)(el, {
        value: (this.state.forward && this.state.forward.to) || null, inputId: 'tm-fwd-to', label: __('To'), reqd: 1,
        doctype: 'User', filters: { enabled: 1, user_type: 'System User', name: ['!=', A().ME || ''] },
        display: (id) => ((A().USERS || {})[id] || {}).name || this._fwdNames[id] || id,
        remember: (row) => { if (row.description) this._fwdNames[row.value] = row.description; },
        onChange: (v) => {
          if (this._fx && this._fx.fwdTo) this._fx.fwdTo.set_error(false);
          this.setState((st) => (st.forward ? { forward: { ...st.forward, to: v || null } } : null));
        },
      })),
      fwdReason: this.fxSlot('fwdReason', (el) => new (X().Data)(el, {
        value: (this.state.forward && this.state.forward.reason) || '', inputId: 'tm-fwd-reason',
        label: __('Forward reason (logged as a comment in the thread)'),
        onChange: (v) => this.setState((st) => (st.forward ? { forward: { ...st.forward, reason: v || '' } } : null)),
      })),
    };
  }

  /** Attach a file to a new task: Frappe's FileUploader (linked to the task after creation) */
  attachToCompose = () => {
    const P = this.pf();
    if (!P || !P.ui) {
      if (this.composeFileInput.current) this.composeFileInput.current.click();
      return;
    }
    if (!P.ui.FileUploader) {
      if (this.composeFileInput.current) this.composeFileInput.current.click();
      return;
    }
    new P.ui.FileUploader({
      folder: 'Home/Attachments',
      allow_multiple: true,
      on_success: (file) => {
        if (!file || !this.state.compose) return;
        this.setState((st) => (st.compose ? {
          compose: { ...st.compose, files: [...(st.compose.files || []), { name: file.name, label: file.file_name || file.file_url, url: file.file_url }] },
        } : {}));
      },
    });
  };
  composeFileInput = React.createRef();
  onComposeLocalFiles = (e) => {
    const picked = Array.from(e.target.files || []).map((f) => ({ name: null, label: f.name, url: '' }));
    e.target.value = '';
    if (!picked.length) return;
    this.setState((st) => (st.compose ? { compose: { ...st.compose, files: [...(st.compose.files || []), ...picked] } } : {}));
  };
  removeComposeFile = (i) => {
    const f = ((this.state.compose && this.state.compose.files) || [])[i];
    this.setState((st) => ({ compose: { ...st.compose, files: (st.compose.files || []).filter((_, n) => n !== i) } }));
    if (f && f.name) this.discardUploads([f.name]);
  };
  discardUploads(names) {
    const P = this.pf();
    if (!P || !names.length) return;
    names.forEach((name) => P.call({ method: 'todobox.api.discard_upload', args: { name }, error: () => { } }));
  }

  /* ---------- tags in the compose drawer ---------- */
  addComposeTag = (label) => {
    const lb = String(label || '').trim();
    if (!lb) return;
    this.setState((st) => {
      if (!st.compose) return {};
      const labels = st.compose.labels || [];
      return { compose: { ...st.compose, labels: labels.includes(lb) ? labels : [...labels, lb] }, composeNewTag: '' };
    });
  };
  removeComposeTag = (lb) => this.setState((st) => ({ compose: { ...st.compose, labels: (st.compose.labels || []).filter((x) => x !== lb) } }));

  /** Safe HTML for display in the thread (allowlist); returns a stable ref that puts the content in the element.
      (the inline template is read from the DOM, so attribute names like dangerouslySetInnerHTML get lowercased) */
  richHtml(raw) {
    const str = String(raw == null ? '' : raw);
    const cache = this._richCache || (this._richCache = new Map());
    if (cache.has(str)) return cache.get(str);
    const html = this.sanitizeRich(str);
    const ref = (el) => { if (el && el.__ttHtml !== html) { el.innerHTML = html; el.__ttHtml = html; } };
    if (cache.size > 300) cache.clear();
    cache.set(str, ref);
    return ref;
  }
  sanitizeRich(str) {
    const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (!/<[a-z][\s\S]*>/i.test(str)) return esc(str).replace(/\n/g, '<br>');
    const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'sub', 'sup']);
    const doc = new DOMParser().parseFromString('<div>' + str + '</div>', 'text/html');
    const walk = (node) => {
      Array.from(node.children).forEach((el) => {
        const tag = el.tagName.toLowerCase();
        if (!ALLOWED.has(tag)) {
          if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'].includes(tag)) { el.remove(); return; }
          el.replaceWith(...Array.from(el.childNodes));
          return;
        }
        Array.from(el.attributes).forEach((a) => {
          const n = a.name.toLowerCase();
          const v = a.value || '';
          const okAttr = ['class', 'style', 'href', 'src', 'alt', 'title', 'data-list', 'colspan', 'rowspan', 'dir', 'contenteditable'].includes(n);
          if (!okAttr || n.startsWith('on') || ((n === 'href' || n === 'src') && /^\s*javascript:/i.test(v)) || (n === 'style' && /url\s*\(|expression/i.test(v))) el.removeAttribute(a.name);
        });
        if (tag === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        walk(el);
      });
    };
    const root = doc.body.firstChild;
    walk(root);
    return root.innerHTML;
  }
  plainText(raw) { return String(raw == null ? '' : raw).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

  closeCompose = () => {
    const c = this.state.compose;
    if (c && c.files) this.discardUploads(c.files.map((f) => f.name).filter(Boolean));
    this.closeDateOverlay();
    this.setState({ compose: null, composeNewCheck: '', composeChecklistOpen: false, ppl: null, composeTagPicker: false, composeNewTag: '' });
  };
  personChip = (k, U, s) => {
    const w = (s.workload || {})[k] || { open: 0, overdue: 0, mins: 0 };
    const inTo = s.compose ? s.compose.to.includes(k) : false;
    const base = 'display:flex;align-items:center;gap:7px;height:32px;padding:0 11px;border-radius:99px;cursor:pointer;font-size:12px;border:1px solid ';
    return {
      name: U[k].name, initials: U[k].initials, avatar: this.ava(k, 20),
      loadText: w.open,
      loadTitle: __('{0} — {1} open tasks, {2} overdue', [U[k].name, w.open, w.overdue]),
      loadStyle: 'min-width:19px;height:19px;padding:0 5px;display:grid;place-items:center;border-radius:99px;font-family:var(--font);font-variant-numeric:tabular-nums;font-size:10px;font-weight:600;color:' +
        (w.overdue ? '#fff' : 'var(--fg2)') + ';background:' + (w.overdue ? 'var(--red)' : 'var(--sunk)') + ';',
      toStyle: base + (inTo ? 'var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:600;' : 'var(--line2);background:transparent;'),
      onTo: () => this.setState((st) => ({ compose: { ...st.compose, to: st.compose.to.includes(k) ? st.compose.to.filter((x) => x !== k) : [...st.compose.to, k] } })),
    };
  };
  patchChecklist = (fn) => this.setState((st) => ({ compose: { ...st.compose, checklist: fn(st.compose.checklist || []) } }));
  addComposeCheck = () => {
    const txt = (this.state.composeNewCheck || '').trim();
    if (!txt || !this.state.compose) return;
    this.patchChecklist((l) => [...l, txt]);
    this.setState({ composeNewCheck: '' });
  };
  editComposeCheck = (i, val) => this.patchChecklist((l) => l.map((c, n) => (n === i ? val : c)));
  delComposeCheck = (i) => this.patchChecklist((l) => l.filter((_, n) => n !== i));
  submitCompose = async () => {
    const c = this.state.compose;
    if (!c || !c.to.length || !c.subject.trim()) { this.toast(__('Add a recipient and a subject')); return; }
    const attachments = (c.files || []).map((f) => f.name).filter(Boolean);
    this.closeDateOverlay();
    const created = await this.api.createTodos({ to: c.to, cc: c.cc, subject: c.subject, body: this.bodyToHtml(c.body), attachments, priority: c.priority, date: c.date, reference_type: c.ref ? c.ref.type : null, reference_name: c.ref ? c.ref.name : null, ref_amount: c.ref ? c.ref.amount : null, labels: c.labels, checklist: c.checklist || [] });
    if (!created.length) { this.toast(__('Could not create the task')); return; }
    this.setState({ compose: null, folder: 'sent', activeView: null, search: '', searchInput: '', composeTagPicker: false, composeNewTag: '' });
    const ruleNote = created[0].rule_applied ? ' · ' + __('Rule: {0}', [created[0].rule_applied]) : '';
    this.toast(__('Created {0} task(s)', [created.length]) + ruleNote);
    this.load(created[0].name);
    this.refreshAfterChange();
  };
  openForward = () => {
    if (!this.state.sel || !this.guardLocked(this.taskByName(this.state.sel))) return;
    this.setState({ forward: { to: null, mode: 'full', reason: '', busy: false }, ppl: null });
  };
  closeForward = () => { this.pplClose(); this.setState({ forward: null }); };
  submitForward = async () => {
    const f = this.state.forward;
    if (!f || f.busy) return;
    if (!f.to) {
      this.toast(__('Choose a recipient'));
      const ctl = this._fx && this._fx.fwdTo;
      if (ctl) { ctl.set_error(true); ctl.focus(); }
      return;
    }
    this.setState({ forward: { ...f, busy: true } });
    const res = await this.api.forwardTodo(this.state.sel, f);
    if (!res || !res.new_name) { this.setState((st) => (st.forward ? { forward: { ...st.forward, busy: false } } : null)); return; }
    const toName = res.to_name || (this.api.USERS[f.to] || {}).name || f.to;
    const label = f.mode === 'full' ? __('Task forwarded in full to {0}', [toName]) : __('Parallel task (delegation) created for {0}', [toName]);
    this.setState({ forward: null, ppl: null });
    this.toast(label);
    this.load();
    this.refreshAfterChange && this.refreshAfterChange();
  };
});

/* =============================================================================
   "New task": drawer with real Frappe controls (make_control via js/todobox/controls.js)
   Template: templates/includes/todobox_compose.html (layout only + ref slots)
   Applied after all hub/ parts (on top of render.js), adding the "tmc" value to the template.
   ============================================================================= */
(function () {
  const src = (document.currentScript && document.currentScript.src) || '';
  const ver = (src.split('?v=')[1] || '').split('&')[0];
  const base = '/assets/todobox/';
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = base + 'css/todobox_compose.css?v=' + ver;
  document.head.appendChild(css);
  window.__tmcReady = window.TMControls ? Promise.resolve() : new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = base + 'js/todobox/controls.js?v=' + ver;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  /* extra drawer icons in the same <use href="#..."> system */
  const addIcons = () => {
    if (document.getElementById('i-tmc-expand')) return;
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    box.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
      '<symbol id="i-tmc-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></symbol>' +
      '<symbol id="i-tmc-collapse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></symbol>' +
      '</defs></svg>';
    document.body.appendChild(box);
  };
  if (document.body) addIcons(); else document.addEventListener('DOMContentLoaded', addIcons);

  /* late parts are composed on top of TTCompose output (after render.js) */
  const late = window.TTLateParts = window.TTLateParts || [];
  if (!window.TTCompose.__tmcWrapped) {
    const orig = window.TTCompose;
    window.TTCompose = function (B, React) { return late.reduce((C, part) => part(C, React), orig(B, React)); };
    window.TTCompose.__tmcWrapped = true;
  }
})();

(window.TTLateParts = window.TTLateParts || []).push((Base, React) => class extends Base {
  /* ---------- state ---------- */
  tmcBlank() {
    return { to: [], cc: [], subject: '', body: '', priority: 'Medium', date: (this.api && this.api.TODAY) || new Date().toISOString().slice(0, 10), ref: null, labels: [], checklist: [], template: null, files: [] };
  }
  tmcDirty(c) {
    return !!(c && ((c.to || []).length || (c.cc || []).length || String(c.subject || '').trim() || this.plainText(c.body) ||
      (c.checklist || []).length || (c.labels || []).length || (c.ref && c.ref.type) || (c.files || []).length));
  }
  tmcDraftKey() { return 'todobox_compose_draft:' + ((this.api && this.api.ME) || ''); }
  tmcReadDraft() {
    try { const d = JSON.parse(localStorage.getItem(this.tmcDraftKey()) || 'null'); return d && d.compose ? d : null; } catch (e) { return null; }
  }
  tmcWriteDraft(c) {
    try { localStorage.setItem(this.tmcDraftKey(), JSON.stringify({ at: Date.now(), compose: { ...c, files: [] } })); } catch (e) { /* storage unavailable */ }
  }
  tmcClearDraft() { try { localStorage.removeItem(this.tmcDraftKey()); } catch (e) { /* */ } }

  openCompose = () => {
    if (this.state.compose) { this.tmcFocus('subject'); return; }
    this.setState({ compose: this.tmcBlank(), composeCCOpen: false, notifsOpen: false, composeTagPicker: false, composeNewTag: '', ppl: null }, this.loadComposeSuggest);
  };
  /* direct close (for legacy callers); draft and uploads are handled in tmcOnClose */
  closeCompose = () => this.setState({ compose: null, composeNewCheck: '', composeChecklistOpen: false, ppl: null, composeTagPicker: false, composeNewTag: '' });
  tmcRequestClose = () => {
    const s = this.state;
    if (!s.compose || s.tmcBusy) return;
    if (this.tmcDirty(s.compose) && !s.tmcConfirm) { this.setState({ tmcConfirm: true }); return; }
    this.closeCompose();
  };
  openRecurringFromCompose = ((orig) => () => { this._tmcNoDraft = true; if (orig) orig(); })(this.openRecurringFromCompose);

  tmcPatch = (patch, errKey) => this.setState((st) => {
    if (!st.compose) return null;
    const up = { compose: { ...st.compose, ...patch }, tmcConfirm: false };
    if (errKey && st.tmcErr && st.tmcErr[errKey]) { const e = { ...st.tmcErr }; delete e[errKey]; up.tmcErr = e; }
    return up;
  });

  /* ---------- lifecycle ---------- */
  /* StreamableLogic.componentDidUpdate(prevProps) has no prevState: keep the previous compose ourselves */
  componentDidUpdate(pp) {
    if (super.componentDidUpdate) super.componentDidUpdate(pp);
    const c = this.state.compose, pc = this._tmcPrev || null;
    this._tmcPrev = c;
    if (c && !pc) this.tmcOnOpen();
    else if (!c && pc) this.tmcOnClose(pc);
    if (c) {
      this.tmcSync();
      if (c !== pc && pc && this.tmcDirty(c)) this.tmcSaveSoon();
    }
  }
  componentWillUnmount() {
    if (super.componentWillUnmount) super.componentWillUnmount();
    window.removeEventListener('keydown', this.tmcWinKey, true);
  }
  tmcOnOpen() {
    this._tmcSent = false;
    this._tmcNoDraft = false;
    window.addEventListener('keydown', this.tmcWinKey, true);
    const draft = this.tmcDirty(this.state.compose) ? null : this.tmcReadDraft();
    this.setState({ tmcErr: {}, tmcConfirm: false, tmcBusy: false, tmcShow: {}, tmcPending: 0, tmcSaved: false,
      tmcRestore: draft && this.tmcDirty(draft.compose) ? draft : null });
    setTimeout(() => this.tmcFocus('subject'), 60);
  }
  tmcOnClose(prev) {
    window.removeEventListener('keydown', this.tmcWinKey, true);
    if (this._tmcSaveT) clearTimeout(this._tmcSaveT);
    if (this._tmcSent) this.tmcClearDraft();
    else {
      if (!this._tmcNoDraft && this.tmcDirty(prev)) this.tmcWriteDraft(prev);
      const names = (prev.files || []).map((f) => f.name).filter(Boolean);
      if (names.length) this.discardUploads(names);
    }
    this.setState({ tmcConfirm: false, tmcBusy: false, tmcRestore: null, tmcErr: {} });
  }
  tmcSaveSoon() {
    clearTimeout(this._tmcSaveT);
    this._tmcSaveT = setTimeout(() => {
      const c = this.state.compose;
      if (!c || !this.tmcDirty(c)) return;
      this.tmcWriteDraft(c);
      const up = {};
      if (!this.state.tmcSaved) up.tmcSaved = true;
      if (this.state.tmcRestore) up.tmcRestore = null; /* a new draft replaced the old one */
      if (Object.keys(up).length) this.setState(up);
    }, 700);
  }
  tmcRestoreDraft = () => {
    const d = this.state.tmcRestore;
    if (!d) return;
    const c = { ...this.tmcBlank(), ...d.compose, files: [] };
    (c.to || []).concat(c.cc || []).forEach((id) => { if (this.api.USERS && !this.api.USERS[id]) this.api.searchUsers(id, []).then(() => this.forceUpdate()); });
    this.setState({ compose: c, tmcRestore: null, composeCCOpen: !!(c.cc && c.cc.length) });
    this.toast(__('Draft restored'));
  };
  tmcDiscardDraft = () => { this.tmcClearDraft(); this.setState({ tmcRestore: null }); };

  /* ---------- keyboard ---------- */
  /* inside the drawer: Ctrl/Cmd+Enter sends, Esc closes; other keys don't reach app shortcuts */
  tmcRootKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.tmcSubmit(); return; }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (window.TMControls && window.TMControls.closeTopPopover()) return;
      if (this.state.tmcConfirm) { this.setState({ tmcConfirm: false }); return; }
      this.tmcRequestClose();
      return;
    }
    e.stopPropagation();
  };
  /* focus outside the drawer (e.g. body after clicking empty space): the drawer is modal */
  tmcWinKey = (e) => {
    if (!this.state.compose) return;
    const t = e.target;
    if (t && t.closest && (t.closest('.tmc') || t.closest('.tmc-dp-anchor') || t.closest('.datepickers-container'))) return;
    if (document.querySelector('.tm-msg-backdrop')) return;
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { this.tmcRootKey(e); e.stopImmediatePropagation(); return; }
    if (!(e.ctrlKey || e.metaKey || e.altKey)) e.stopImmediatePropagation();
  };
  tmcRootRef = (el) => {
    if (this._tmcRoot === el) return;
    if (this._tmcRoot) {
      this._tmcRoot.removeEventListener('keydown', this.tmcRootKey);
      this._tmcRoot.removeEventListener('paste', this.tmcPaste, true);
    }
    this._tmcRoot = el;
    if (el) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('dir', window.TT_DIR || 'ltr');
      el.addEventListener('keydown', this.tmcRootKey);
      el.addEventListener('paste', this.tmcPaste, true);
    }
  };
  /* pasting an image/file anywhere in the drawer = attachment (not embedded in the text) */
  tmcPaste = (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    this.setState((st) => ({ tmcShow: { ...(st.tmcShow || {}), files: true } }), () => {
      const ctl = this._tmcCtl && this._tmcCtl.files;
      if (ctl) ctl.addFiles(files);
    });
  };

  /* ---------- controls ---------- */
  tmcFocus(key) {
    const ctl = this._tmcCtl && this._tmcCtl[key];
    if (ctl) ctl.focus();
  }
  /** scroll a section that was just added (Link a document, Use a template, …) into view in the drawer */
  tmcReveal(k) {
    const el = document.querySelector('.tmc [data-tmc-sec="' + k + '"]');
    if (!el) return;
    const smooth = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }));
  }
  tmcSlot(key) {
    const cache = this._tmcSlots || (this._tmcSlots = {});
    if (!cache[key]) {
      cache[key] = (el) => {
        const ctls = this._tmcCtl || (this._tmcCtl = {});
        if (el) {
          if (ctls[key] && ctls[key].wrap.parentNode === el) return;
          if (ctls[key]) { ctls[key].destroy(); delete ctls[key]; }
          const mount = () => {
            if (!el.isConnected || ctls[key] || !this.state.compose || !window.TMControls) return;
            ctls[key] = this.tmcMake(key, el);
          };
          window.__tmcReady.then(() => window.TMControls && window.TMControls.ready()).then(mount, (e) => console.error(e));
        } else if (ctls[key]) { ctls[key].destroy(); delete ctls[key]; }
      };
    }
    return cache[key];
  }
  /** tag suggestions for every tag field: Frappe's Tag list, plus tags already on the loaded tasks */
  tmcTagPool(q) {
    const ql = String(q || '').toLowerCase();
    const inUse = [...(this.state.tasks || []).flatMap((t) => t.labels || []), ...(this.state.templates || []).flatMap((t) => t.labels || [])]
      .filter((t) => t && (!ql || String(t).toLowerCase().includes(ql)));
    const fromTags = this.api && this.api.searchTags ? this.api.searchTags(q) : Promise.resolve([]);
    return fromTags.then((tags) => [...new Set([...(tags || []), ...inUse])]);
  }
  tmcMake(key, el) {
    const X = window.TMControls, A = this.api, c = this.state.compose;
    const users = (id) => (A.USERS && A.USERS[id]) || { name: id };
    const search = (q, ex) => A.searchUsers(q, ex);
    switch (key) {
      case 'to':
        return new X.UserMulti(el, { value: c.to, inputId: 'tmc-to', label: __('To'), reqd: 1, placeholder: __('Search people by name or email…'), search, user: users,
          onChange: (v) => this.tmcPatch({ to: v }, 'to') });
      case 'cc':
        return new X.UserMulti(el, { value: c.cc, inputId: 'tmc-cc', label: __('CC'), description: __('CC users are notified and can follow the task'), placeholder: __('Add people to keep in the loop…'), search, user: users,
          onChange: (v) => this.tmcPatch({ cc: v }) });
      case 'subject':
        return new X.Data(el, { value: c.subject, inputId: 'tmc-subject', label: __('Subject'), reqd: 1, maxlength: 140,
          onChange: (v) => this.tmcPatch({ subject: v }, 'subject'), onEnter: () => this.tmcFocus('body') });
      case 'body':
        return new X.TextEditor(el, { value: c.body, label: __('Details'),
          onChange: (v) => this.tmcPatch({ body: v }) });
      case 'date':
        return new X.DateControl(el, { value: c.date, inputId: 'tmc-date', label: __('Due date'), onChange: (v) => this.tmcPatch({ date: v }, 'date') });
      case 'priority':
        return new X.Select(el, { value: c.priority, inputId: 'tmc-priority', label: __('Priority'),
          options: [{ value: 'Low', label: __('Low') }, { value: 'Medium', label: __('Medium') }, { value: 'High', label: __('High') }],
          onChange: (v) => this.tmcPatch({ priority: v || 'Medium' }) });
      case 'ref_type':
        return new X.Link(el, { value: c.ref && c.ref.type, inputId: 'tmc-ref-type', label: __('Document type'),
          doctype: 'DocType', filters: { istable: 0, issingle: 0 },
          onChange: (v) => this.tmcPatch({ ref: v ? { type: v, name: null } : null }, 'ref') });
      case 'ref_name':
        return new X.Link(el, { value: c.ref && c.ref.name, inputId: 'tmc-ref-name', label: __('Document'),
          disabled: !(c.ref && c.ref.type),
          dynamic: () => { const r = this.state.compose && this.state.compose.ref; return (r && r.type) || ''; },
          display: (v) => { const r = this.state.compose && this.state.compose.ref; return r && r.title && r.title !== v ? v + ' · ' + r.title : v; },
          remember: (row) => { this._tmcRefTitle = row.label && row.label !== row.value ? row.label : (row.description || ''); },
          onOpen: (v) => { const r = this.state.compose && this.state.compose.ref; if (r && r.type && window.frappe.set_route) window.frappe.set_route('Form', r.type, v); },
          onChange: (v) => this.tmcPatch({ ref: { ...(this.state.compose.ref || {}), name: v, title: v ? (this._tmcRefTitle || '') : '' } }, 'ref') });
      case 'template':
        return new X.Link(el, { value: c.template, inputId: 'tmc-template', placeholder: __('Search templates…'), ariaLabel: __('Template'),
          description: __('Fills in the subject, checklist and priority'),
          doctype: 'ToDoBox Task Template', filters: { enabled: 1 },
          display: (id) => { const t = (A.TASK_TEMPLATES || []).find((x) => x.id === id); return t ? t.label : id; },
          onChange: (id) => this.tmcApplyTemplate(id) });
      case 'tags':
        return new X.TagsInput(el, { value: c.labels, placeholder: __('Add tags…'), ariaLabel: __('Tags'), suggestions: (q) => this.tmcTagPool(q),
          onChange: (v) => this.tmcPatch({ labels: v }) });
      case 'checklist':
        return new X.Checklist(el, { value: c.checklist, placeholder: __('Add a step… (Enter)'), onChange: (v) => this.tmcPatch({ checklist: v }) });
      case 'files':
        return new X.Attach(el, { value: c.files,
          onChange: (v) => this.tmcPatch({ files: v }, 'files'),
          onDiscard: (name) => this.discardUploads([name]),
          onPending: (n) => this.setState((st) => { const e = { ...(st.tmcErr || {}) }; if (!n) delete e.files; return { tmcPending: n, tmcErr: e }; }) });
      default: return null;
    }
  }
  /* external values (template, draft restore...) are reflected on controls without firing onChange */
  tmcSync() {
    const c = this.state.compose, ctl = this._tmcCtl;
    if (!c || !ctl) return;
    const vals = { to: c.to, cc: c.cc, subject: c.subject, body: c.body, date: c.date, priority: c.priority,
      ref_type: c.ref ? c.ref.type : null, ref_name: c.ref ? c.ref.name : null, template: c.template, tags: c.labels, checklist: c.checklist, files: c.files };
    Object.keys(ctl).forEach((k) => { if (k in vals) ctl[k].set_value(vals[k]); });
    if (ctl.ref_name) ctl.ref_name.setDisabled(!(c.ref && c.ref.type));
    /* Frappe's own invalid state on the fields the send check flagged */
    const err = this.state.tmcErr || {};
    [['to', 'to'], ['subject', 'subject'], ['ref_name', 'ref']].forEach(([k, e]) => { if (ctl[k] && ctl[k].set_error) ctl[k].set_error(!!err[e]); });
  }
  tmcApplyTemplate(id) {
    const A = this.api;
    const t = (A.TASK_TEMPLATES || []).find((x) => x.id === id);
    this.setState((st) => {
      const c = st.compose;
      if (!c) return null;
      if (!t) return { compose: { ...c, template: null } };
      const prev = (A.TASK_TEMPLATES || []).find((x) => x.id === c.template);
      const subjFree = !String(c.subject || '').trim() || (prev && c.subject === (prev.subject || prev.label));
      const bodyFree = !this.plainText(c.body) || (prev && c.body === prev.body);
      return {
        compose: { ...c, template: t.id, subject: subjFree ? (t.subject || t.label) : c.subject, body: bodyFree ? (t.body || '') : c.body,
          checklist: (t.checklist || []).slice(), priority: t.priority || c.priority },
        tmcErr: { ...(st.tmcErr || {}), subject: undefined },
      };
    });
  }

  /* ---------- submit ---------- */
  tmcValidate(c) {
    const err = {};
    if (!(c.to || []).length) err.to = __('Add at least one recipient');
    if (!String(c.subject || '').trim()) err.subject = __('Enter a subject');
    if (c.ref && c.ref.type && !c.ref.name) err.ref = __('Choose a document, or remove the link');
    if (this.state.tmcPending) err.files = __('Wait for the uploads to finish');
    return err;
  }
  tmcSubmit = async () => {
    if (!this.state.compose || this.state.tmcBusy) return;
    /* pending input (step/tag) not yet added is added before sending */
    const ctl = this._tmcCtl || {};
    if (ctl.checklist) ctl.checklist.addTyped(true);
    if (ctl.tags) ctl.tags.addTyped();
    await new Promise((r) => this.setState({}, r));
    const c = this.state.compose;
    const err = this.tmcValidate(c);
    const keys = Object.keys(err);
    if (keys.length) {
      this.setState({ tmcErr: err, tmcConfirm: false, tmcShow: { ...(this.state.tmcShow || {}), ...(err.ref ? { ref: true } : {}) } });
      const first = ['to', 'subject', 'date', 'ref', 'files'].find((k) => err[k]);
      setTimeout(() => this.tmcFocus(first === 'ref' ? 'ref_name' : first), 30);
      return;
    }
    this.setState({ tmcBusy: true, tmcConfirm: false });
    let created = [];
    try {
      created = await this.api.createTodos({
        to: c.to, cc: c.cc, subject: c.subject.trim(), body: this.bodyToHtml(c.body),
        attachments: (c.files || []).map((f) => f.name).filter(Boolean),
        priority: c.priority, date: c.date,
        reference_type: c.ref && c.ref.name ? c.ref.type : null, reference_name: c.ref && c.ref.name ? c.ref.name : null,
        ref_amount: null, labels: c.labels,
        checklist: (c.checklist || []).map((x) => String(x).trim()).filter(Boolean), template: c.template,
      });
    } catch (e) { created = []; }
    if (!created || !created.length) {
      this.setState({ tmcBusy: false });
      this.toast(__('Could not create the task'));
      return;
    }
    this._tmcSent = true;
    this.tmcClearDraft();
    const first = created[0].name;
    this.setState({ compose: null, tmcBusy: false, folder: 'sent', activeView: null, label: null, search: '', searchInput: '', composeTagPicker: false, composeNewTag: '' }, async () => {
      try { await this.load(first); } catch (e) { /* the list shows its own error */ }
      if ((this.state.tasks || []).some((t) => t.name === first) && this.state.view === 'desktop') this.open(first);
    });
    const ruleNote = created[0].rule_applied ? ' · ' + __('Rule: {0}', [created[0].rule_applied]) : '';
    this.toast(__('Created {0} task(s)', [created.length]) + ruleNote);
    this.refreshAfterChange();
  };

  /* ---------- template values ---------- */
  renderVals() {
    const v = super.renderVals();
    v.fx = this.fxVals();
    v.tmc = this.state.compose && this.api ? this.tmcVals() : { slot: {}, err: {}, hasErr: {}, fieldCls: {}, show: {}, hide: {}, addChips: [], suggest: [] };
    return v;
  }
  tmcVals() {
    const s = this.state, c = s.compose, A = this.api;
    const err = s.tmcErr || {};
    const shown = s.tmcShow || {};
    const has = {
      ref: !!(c.ref && c.ref.type), template: !!c.template, checklist: !!(c.checklist || []).length,
      tags: !!(c.labels || []).length, files: !!(c.files || []).length || !!s.tmcPending,
    };
    const show = {};
    Object.keys(has).forEach((k) => { show[k] = !!(has[k] || shown[k]); });
    const hideFn = (k, clear) => () => {
      if (clear) this.tmcPatch(clear, k);
      this.setState((st) => ({ tmcShow: { ...(st.tmcShow || {}), [k]: false } }));
    };
    const fc = (k) => 'tmc-field' + (err[k] ? ' has-error' : '');
    const n = (c.to || []).length;
    const busy = !!s.tmcBusy;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const suggest = n ? [] : (s.composeSuggest || []).filter((u) => u && u.id).slice(0, 5).map((u) => ({
      /* the 5 people this user assigns to most (people.js loadComposeSuggest) */
      name: u.name, title: u.name,
      onPick: () => this.tmcPatch({ to: [...(this.state.compose.to || []), u.id] }, 'to'),
    }));
    const slot = {};
    ['to', 'cc', 'subject', 'body', 'date', 'priority', 'ref_type', 'ref_name', 'template', 'tags', 'checklist', 'files'].forEach((k) => { slot[k] = this.tmcSlot(k); });
    const restore = s.tmcRestore;
    let restoreText = '';
    if (restore) {
      const subj = String((restore.compose && restore.compose.subject) || '').trim();
      const when = new Date(restore.at || Date.now());
      const t = when.toLocaleString((window.TT_LANG || 'en') + '-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
      restoreText = subj ? __('Unsent draft “{0}” from {1}', [subj.length > 40 ? subj.slice(0, 40) + '…' : subj, t]) : __('You have an unsent draft from {0}', [t]);
    }
    return {
      cls: 'tmc' + ((s.tmcWide || (window.matchMedia && window.matchMedia('(max-width: 759px)').matches)) ? ' is-wide is-full' : '') + (busy ? ' is-busy' : ''),
      rootRef: this.tmcRootRef, slot,
      requestClose: this.tmcRequestClose,
      headSub: s.tmcSaved ? __('Draft saved') : __('One task per recipient'),
      toggleExpand: () => this.setState((st) => ({ tmcWide: !st.tmcWide })),
      expandLabel: s.tmcWide ? __('Collapse') : __('Expand'),
      expandIcon: s.tmcWide ? '#i-tmc-collapse' : '#i-tmc-expand',
      restoreOpen: !!restore, restoreText, restoreDraft: this.tmcRestoreDraft, discardDraft: this.tmcDiscardDraft,
      ccOpen: !!(s.composeCCOpen || (c.cc || []).length),
      ccExpanded: !!(s.composeCCOpen || (c.cc || []).length),
      ccToggleLabel: (c.cc || []).length ? __('CC ({0})', [c.cc.length]) : s.composeCCOpen ? __('Hide CC') : '+ ' + __('CC'),
      toggleCC: () => {
        if ((c.cc || []).length) { this.tmcFocus('cc'); return; }
        this.setState((st) => ({ composeCCOpen: !st.composeCCOpen }), () => { if (this.state.composeCCOpen) this.tmcFocus('cc'); });
      },
      hasSuggest: suggest.length > 0, suggest,
      err: { to: err.to || '', subject: err.subject || '', date: err.date || '', ref: err.ref || '', files: err.files || '' },
      hasErr: { to: !!err.to, subject: !!err.subject, date: !!err.date, ref: !!err.ref, files: !!err.files },
      fieldCls: { to: fc('to'), subject: fc('subject'), date: fc('date'), ref: fc('ref') },
      show,
      hide: {
        ref: hideFn('ref', { ref: null }), template: hideFn('template', { template: null }), checklist: hideFn('checklist', { checklist: [] }),
        tags: hideFn('tags', { labels: [] }),
        files: () => { const names = (c.files || []).map((f) => f.name).filter(Boolean); if (names.length) this.discardUploads(names); hideFn('files', { files: [] })(); },
      },
      addChips: [
        ['ref', __('Link a document'), '#i-link', 'ref_type'], ['template', __('Use a template'), '#i-template', 'template'],
        ['checklist', __('Checklist'), '#i-list', 'checklist'], ['tags', __('Tags'), '#i-tag', 'tags'], ['files', __('Attachments'), '#i-paperclip', 'files'],
      ].filter(([k]) => !show[k]).map(([k, label, icon, focusKey]) => ({
        label, icon,
        onAdd: () => this.setState((st) => ({ tmcShow: { ...(st.tmcShow || {}), [k]: true } }), () => setTimeout(() => { this.tmcFocus(focusKey); this.tmcReveal(k); }, 0)),
      })),
      hasAddChips: Object.keys(show).some((k) => !show[k]),
      checkCount: __('{0} steps', [(c.checklist || []).length]),
      confirmOpen: !!s.tmcConfirm, keepEditing: () => this.setState({ tmcConfirm: false }), confirmClose: () => this.closeCompose(),
      onRecurring: this.openRecurringFromCompose,
      notice: n > 1 ? __('{0} tasks will be created — one per recipient', [n]) : '',
      kbdHint: (mac ? '⌘' : 'Ctrl') + '+Enter',
      busy, busyAria: busy ? 'true' : 'false',
      sendCls: 'tmc-btn tmc-btn-primary tmc-send' + (busy ? ' is-busy' : ''),
      sendLabel: busy ? __('Sending…') : n > 1 ? __('Send to {0}', [n]) : __('Send'),
      submit: this.tmcSubmit,
    };
  }
});
