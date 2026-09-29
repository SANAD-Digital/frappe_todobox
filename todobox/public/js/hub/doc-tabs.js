/* ToDoBox: document detail tabs (Data / Comments / Attachments / History)
   Shared by the Required-actions preview (workflow-ui.js) and the tabs of a task's linked document
   (reference_type / reference_name) in the task detail pane (render.js → d.*). */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {

  /** Underlined tab bar view-model: role=tab/aria-selected, roving tabindex, arrow/Home/End keys (RTL aware) */
  docTabItems(tabs, cur, onPick, prefix) {
    const ids = tabs.map((t) => t.id);
    const focusTab = (id) => setTimeout(() => { const el = document.getElementById(prefix + '-tab-' + id); if (el) el.focus(); }, 0);
    return tabs.map(({ id, label }) => {
      const on = cur === id;
      return {
        label, id: prefix + '-tab-' + id, panelId: prefix + '-panel',
        selected: on ? 'true' : 'false', tabIndex: on ? 0 : -1,
        style: 'height:34px;padding:0 14px;flex:0 0 auto;white-space:nowrap;border:0;border-bottom:2px solid ' + (on ? 'var(--primary)' : 'transparent') +
          ';background:transparent;cursor:pointer;font-size:12px;color:' + (on ? 'var(--fg)' : 'var(--fg3)') +
          ';font-weight:' + (on ? '700' : '400') + ';',
        onPick: () => onPick(id),
        onKey: (e) => {
          const rtl = (window.TT_DIR || 'ltr') === 'rtl';
          const i = ids.indexOf(id);
          let n = null;
          if (e.key === 'ArrowRight') n = ids[(i + (rtl ? -1 : 1) + ids.length) % ids.length];
          else if (e.key === 'ArrowLeft') n = ids[(i + (rtl ? 1 : -1) + ids.length) % ids.length];
          else if (e.key === 'Home') n = ids[0];
          else if (e.key === 'End') n = ids[ids.length - 1];
          if (n === null) return;
          e.preventDefault(); e.stopPropagation();
          onPick(n); focusTab(n);
        },
      };
    });
  }

  /** Panel content of a document detail payload (services.workflow.doc_detail):
      opt.userOf(email) → {name, role, initials}; opt.toneOf(state) → css tone; opt.stateLabel(state) */
  docPanelVals(doc, opt) {
    const o = opt || {}, W = this.W;
    const userOf = o.userOf || (() => ({}));
    const since = (h) => (W && W.sinceText ? W.sinceText(h) : '');
    const tsOf = (h) => (W && W.tsOf ? W.tsOf(h) : '');
    const comments = doc.comments || [], files = doc.files || [], items = doc.items || [];
    const trail = (doc.trail || []).slice().reverse();
    const numText = (v, digits) => {
      const n = Number(v);
      if (!isFinite(n)) return v == null ? '' : String(v);
      try { return n.toLocaleString((window.TT_LANG || 'en') + '-u-nu-latn', digits == null ? { maximumFractionDigits: 3 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }); } catch (e) { return String(n); }
    };
    return {
      /* key / value "spec sheet" (.tm-kv in todobox.css): every field looks alike, each value can be copied */
      fields: (doc.fields || []).map((f) => ({
        label: f[0], value: f[1],
      })),
      noFields: !(doc.fields || []).length,
      hasItems: items.length > 0,
      itemCount: String(items.length),
      /* item rows [label, qty, rate]: the rate column shows only when some row has one */
      itemsCls: 'tm-it' + (items.some((it) => Number(it[2]) > 0) ? '' : ' no-rate'),
      items: items.map((it, i) => ({ n: i + 1, label: it[0], qty: numText(it[1]), rate: Number(it[2]) > 0 ? numText(it[2], 2) : '—' })),
      comments: comments.map((c) => {
        const u = userOf(c[0]) || {};
        return {
          who: u.name || c[0], role: u.role || '', time: since(c[1]), text: c[2],
          avatar: 'width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:600;' + this.avaBg(c[0]),
          initials: u.initials || '?',
        };
      }),
      noComments: comments.length === 0,
      files: files.map((f, i) => {
        const isImg = this.fileKind(f[0], f[3]) === 'image';
        return {
          label: f[0], kind: f[1], size: f[2], thumb: isImg ? f[3] : '', noThumb: !isImg,
          onOpen: () => this.openFilePreview(files.map((x) => ({ name: x[0], url: x[3] })), i),
        };
      }),
      noFiles: files.length === 0,
      historyRows: trail.map((tr) => {
        const u = userOf(tr[1]) || {};
        return {
          state: o.stateLabel ? o.stateLabel(tr[0]) : tr[0], who: (u.name || tr[1]) + (u.role ? ' · ' + u.role : ''),
          time: tsOf(tr[2]), note: tr[3] || '', noteStyle: tr[3] ? 'font-size:11px;color:var(--fg2);line-height:1.7;margin-top:3px;' : 'display:none;',
          dot: 'width:9px;height:9px;flex:0 0 9px;border-radius:50%;margin-top:5px;background:var(--' + ((o.toneOf && o.toneOf(tr[0])) || 'fg2') + ');',
        };
      }),
    };
  }

  /* ------------------------------------------------------------------------------------------
     Linked-document tabs of a task: first tab = the task itself, then the document's tabs.
     Shown only when the server says the user can read the document (get_doc_actions.readable).
     The tab is remembered for the open task only; opening another task starts on "Task".
     ------------------------------------------------------------------------------------------ */
  /** Load (or refresh) the linked document payload; stale-while-revalidate after 30s */
  loadRefDetail = async (name, force) => {
    this._refReq = this._refReq || {};
    const cur = (this.state.refDocs || {})[name];
    if (this._refReq[name] || (!force && cur && Date.now() - (cur._at || 0) < 30000)) return;
    if (!this.api || !this.api.getReferenceDetail) return;
    this._refReq[name] = true;
    let r = null;
    try { r = await this.api.getReferenceDetail(name); } finally { this._refReq[name] = false; }
    const entry = r ? { ...r, _at: Date.now() } : (cur || { readable: 1, _failed: 1, _at: Date.now() });
    this.setState((st) => ({ refDocs: { ...(st.refDocs || {}), [name]: entry } }));
  };

  refPickTab = (sel, id) => {
    this.setState({ refTab: { task: sel.name, id } });
    if (id !== 'task') this.loadRefDetail(sel.name);
  };

  refComment = async (sel) => {
    const txt = (this.state.refCommentDraft || '').trim();
    if (!txt) { this.toast(__('Write a comment first')); return; }
    this.setState({ refCommentDraft: '' });
    const r = await this.api.addReferenceComment(sel.name, txt);
    if (!r) { this.setState({ refCommentDraft: txt }); return; }
    this.toast(__('Comment added to the document'));
    this.loadRefDetail(sel.name, true);
  };

  /** d.* values for the task detail pane (spread into d in render.js) */
  refTabVals(sel) {
    const s = this.state;
    const acts = (s.docActs || {})[sel.name];
    const rd = (s.refDocs || {})[sel.name];
    /* a task selected without open() (first load, refresh): fetch its document access once */
    if (sel.reference_name && !acts && this.loadDocActions) {
      this._actsReq = this._actsReq || {};
      if (!this._actsReq[sel.name]) { this._actsReq[sel.name] = true; this.loadDocActions(sel.name); }
    }
    const readable = !!(sel.reference_type && sel.reference_name && acts && acts.readable && !(rd && rd.readable === 0));
    if (!readable) return { hasRefTabs: false, refOnTask: true, refOnDoc: false, refPanelRole: undefined, refPanelId: undefined, refPanelLabel: undefined };

    const hasWf = !!((rd && rd.has_workflow) || acts.has_workflow);
    const tabs = [
      { id: 'task', label: __('ToDo') },
      { id: 'data', label: __('Data') },
      { id: 'comments', label: __('Comments') + (rd && (rd.comments || []).length ? ' (' + rd.comments.length + ')' : '') },
      { id: 'files', label: __('Attachments') + (rd && (rd.files || []).length ? ' (' + rd.files.length + ')' : '') },
      ...(hasWf ? [{ id: 'log', label: __('History') }] : []),
    ];
    let cur = s.refTab && s.refTab.task === sel.name ? s.refTab.id : 'task';
    if (!tabs.some((t) => t.id === cur)) cur = 'task';
    const prefix = 'tt-ref';
    const onDoc = cur !== 'task';
    const loaded = !!(rd && rd.readable && !rd._failed);
    const users = (rd && rd.users) || {}, U = (this.api && this.api.USERS) || {};
    const me = (this.api && this.api.ME) || '';
    const draft = s.refCommentDraft || '';
    const panel = loaded ? this.docPanelVals(rd, {
      userOf: (u) => users[u] || U[u] || {},
      toneOf: (st) => (rd.state_tones || {})[st],
      stateLabel: (st) => (rd.state_labels || {})[st] || st,
    }) : { fields: [], items: [], itemCount: '0', itemsCls: 'tm-it', comments: [], files: [], historyRows: [], hasItems: false, noComments: false, noFiles: false };

    return {
      hasRefTabs: true,
      refTabs: this.docTabItems(tabs, cur, (id) => this.refPickTab(sel, id), prefix),
      refOnTask: !onDoc,
      refPanelRole: 'tabpanel', refPanelId: prefix + '-panel', refPanelLabel: prefix + '-tab-' + cur,
      refOnDoc: onDoc,
      refLoading: onDoc && !loaded && !(rd && rd._failed),
      refFailed: onDoc && !!(rd && rd._failed),
      refRetry: () => this.loadRefDetail(sel.name, true),
      refOnData: onDoc && loaded && cur === 'data',
      refOnComments: onDoc && loaded && cur === 'comments',
      refOnFiles: onDoc && loaded && cur === 'files',
      refOnLog: onDoc && loaded && cur === 'log',
      rd: {
        ...panel,
        noFields: loaded && !(rd.fields || []).length,
        itemsOpen: !!s.refItemsOpen,
        noHistory: loaded && !(rd.trail || []).length,
      },
      refToggleItems: () => this.setState((st) => ({ refItemsOpen: !st.refItemsOpen })),
      refAllFields: () => this.qlOpen(sel.reference_type, sel.reference_name),
      refMeAvatar: 'width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:600;' + this.avaBg(me),
      refMeInitials: (U[me] || {}).initials || '?',
      refCommentDraft: draft,
      onRefCommentDraft: (e) => this.setState({ refCommentDraft: e.target.value }),
      onRefCommentKey: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.refComment(sel); } },
      refAddComment: () => this.refComment(sel),
      refCommentPlaceholder: __('Write a comment on this document…'),
      refCommentBtnStyle: 'height:30px;padding:0 14px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid var(--primary);cursor:pointer;' +
        (draft.trim() ? 'background:var(--primary);color:var(--on-accent);' : 'background:transparent;color:var(--primary);opacity:.6;'),
    };
  }
});
