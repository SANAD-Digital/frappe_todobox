/* ToDoBox: Required actions (Frappe Workflow) */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {

  /* =========================================================================
     "Required actions" module: Frappe Workflow
     ========================================================================= */
  actorLabel() { return this.W ? this.W.ACTORS[0] : ''; }
  meWf() { return this.W ? this.W.ME : ''; }
  wfReload = () => { if (this.W && this.W.refresh) this.W.refresh().then(() => { this.W.hydrateChecks(); this.forceUpdate(); }); };

  wfGo = (tab) => { this.wfReload(); return this.setState({ screen: 'wf', wfTab: tab || 'pending', notifsOpen: false, wfPane: 'list', mobileScreen: 'list', wfChecked: [] }); };

  /** Current user avatar: user image, else initials (same logic as Frappe) */
  meAvatarVals(u) {
    const img = u.user_image || u.image || '';
    const name = u.name || '';
    const initials = u.initials || (name ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') : '?');
    return {
      meAvatarStyle: 'width:32px;height:32px;border-radius:50%;overflow:hidden;' + (img ? 'background:var(--sunk);' : this.avaBg(u.email || u.id || u.name)) +
        'display:grid;place-items:center;font-size:12px;font-weight:600;flex:0 0 auto;',
      meHasImage: !!img, meNoImage: !img, meImage: img, meInitials: initials,
    };
  }

  /** Frappe print page (/desk/print/<DocType>/<name>) in a new tab */
  printDoc = (doctype, name) => {
    if (!doctype || !name) { this.toast(__('No document to print')); return; }
    window.open('/desk/print/' + encodeURIComponent(doctype) + '/' + encodeURIComponent(name), '_blank');
  };

  wfGoPending = () => this.wfGo('pending');
  wfToggleHead = () => this.setState((st) => ({ wfHeadOpen: st.wfHeadOpen !== true }));


  /* =========================================================================
     Quick Look: "All fields" centered panel (public/js/todobox/quicklook.js)
     ========================================================================= */
  ql() { return window.ToDoBoxQuickLook || null; }
  /** Prefetch the document (near-instant open later) */
  qlPrefetch(doctype, name) {
    const Q = this.ql();
    if (Q && Q.prefetch && doctype && name) Q.prefetch({ kind: 'doc', doctype, name });
  }
  qlOpen(doctype, name) {
    const Q = this.ql();
    if (!Q || !Q.expand({ kind: 'doc', doctype, name })) this.openRef(doctype, name);
  }
  /** Esc closes the "All fields" panel before anything else */
  qlKey(e) {
    const Q = this.ql();
    if (Q && e.key === 'Escape' && Q.is_open()) { Q.close(); return true; }
    return false;
  }

  /** Open the document in Desk (new tab) */
  openRef = (doctype, name) => { window.frappe.set_route('Form', doctype, name); };
  wfOpenDoc = (name) => {
    if (this.W && this.W.loadDoc) this.W.loadDoc(name);
    const d = this.W && (this.W.DOCS || []).find((x) => x.name === name);
    if (d) this.qlPrefetch(d.doctype, d.name);
    return this.setState({ wfSel: name, wfNote: '', wfCommentDraft: '', wfNoteError: false, wfConfirm: null, wfDetailTab: 'data', wfItemsOpen: false, wfPane: 'detail', mobileScreen: 'detail' }); };

  wfApply = (name, action) => {
    const W = this.W, me = this.meWf();
    const d = W.DOCS.find((x) => x.name === name);
    if (!d) return;
    const t = W.getTransitions(d, me).find((x) => x.action === action);
    if (!t) { this.toast(__('Document status changed — list refreshed')); this.forceUpdate(); return; }
    const note = (this.state.wfNote || '').trim();
    if (t.needsNote && !note) {
      this.wfOpenDoc(name);
      this.setState({ wfNoteError: true });
      this.toast(__('“{0}” requires a written reason', [action]));
      return;
    }
    if (t.destructive && this.state.wfConfirm !== action + name) {
      this.setState({ wfConfirm: action + name });
      this.toast(__('Press again to confirm: {0}', [action]));
      return;
    }
    const fxCap = this.fxCloseCapture ? this.fxCloseCapture(name) : null; /* snapshot the row before it leaves the list */
    const res = W.applyWorkflow(name, action, me, note);
    if (!res || res.error) { this.toast((res && res.error) || __('Could not complete the action')); this.forceUpdate(); return; }
    const rest = W.pendingForMe(me).filter((x) => x.name !== name);
    if (fxCap && rest.length === W.pendingForMe(me).length) this.fxCloseFly(fxCap, false);
    this.setState((st) => ({
      wfNote: '', wfNoteError: false, wfConfirm: null,
      wfChecked: st.wfChecked.filter((n) => n !== name),
      wfSel: st.wfSel === name ? (rest.length ? rest[0].name : null) : st.wfSel,
      wfUndo: W.canUndo(name, res.prev) ? { name, prev: res.prev, text: __('{0} · {1} (moved to My decisions log)', [action, name]) } : null,
    }));
    this.timers.push(setTimeout(() => this.setState((st) => (st.wfUndo && st.wfUndo.name === name ? { wfUndo: null } : {})), 6000));
  };

  wfUndoDo = () => {
    const u = this.state.wfUndo; if (!u) return;
    const r = this.W.undoWorkflow(u.name, u.prev);
    this.setState({ wfUndo: null, wfSel: u.name });
    this.toast(r && r.error ? r.error : __('Undoing — reverse transition to “{0}”', [u.prev]));
  };

  wfBulk = (action) => {
    const list = this.state.wfChecked.slice();
    list.forEach((n) => this.wfApply(n, action));
    this.setState({ wfChecked: [] });
  };

  /** Key fields, from the server per doctype Meta */
  govFields(d) { return this.W ? this.W.govFields(d) : []; }

  wfToggleCheck = (id) => { this.W.toggleWfCheck(this.state.wfSel, id); this.forceUpdate(); };
  wfAddCheck = () => {
    const txt = (this.state.wfNewCheck || '').trim();
    if (!txt || !this.state.wfSel) return;
    this.W.addWfCheck(this.state.wfSel, txt);
    this.setState({ wfNewCheck: '' });
  };

  wfNudge = (name) => {
    const role = this.W.nudge(name);
    this.toast(__('Reminder sent to {0}', [role || __('the approver')]));
  };

  wfComment = () => {
    const txt = (this.state.wfCommentDraft || '').trim();
    if (!txt || !this.state.wfSel) { this.toast(__('Write a comment first')); return; }
    this.W.addWfComment(this.state.wfSel, this.meWf(), txt);
    this.setState({ wfCommentDraft: '' });
    this.toast(__('Comment added to the document'));
  };

  wfKey = (e) => {
    const W = this.W; if (!W) return false;
    const me = this.meWf();
    const list = this.wfVisible || [];
    const i = list.findIndex((d) => d.name === this.state.wfSel);
    const k = e.key.toLowerCase();
    const cur = list[i];
    if (k === 'j') { const n = list[Math.min(list.length - 1, i + 1)]; if (n) this.wfOpenDoc(n.name); return true; }
    if (k === 'k') { const n = list[Math.max(0, i - 1)]; if (n) this.wfOpenDoc(n.name); return true; }
    if (k === 'o' && cur) { this.wfOpenDoc(cur.name); return true; }
    if (!cur) return false;
    const tr = W.getTransitions(cur, me);
    const pos = tr.find((t) => t.tone === 'green');
    const back = tr.find((t) => t.tone === 'amber' || t.destructive);
    if (k === 'a' && pos) { this.wfApply(cur.name, pos.action); return true; }
    if (k === 'x' && back) { this.wfApply(cur.name, back.action); return true; }
    if (e.key === 'Enter' && pos) { this.wfApply(cur.name, pos.action); return true; }
    return false;
  };

  wfVals() {
    const W = this.W, s = this.state;
    if (!W) return {
      wfTabs: [], wfGroups: [], wfTypeChips: [], wfStateChips: [], wfQuickChips: [], wfLogGroups: [], wfShowGroupSort: false, wfTabsDetail: [], wfMoreItems: [],
      showWfList: false, showWfPreview: false, hasWfDoc: false, noWfDoc: false, wfIsLog: false, wfEmpty: false,
      wfTotal: ' ', wfHeadStyle: 'display:none;', wfHeadBadge: 'display:none;', wfActorLine: ' ', wfHasChecked: false, wfHasUndo: false,
    };
    const me = this.meWf(), U = W.WF_USERS, meU = U[me] || {};
    const tone = (t) => 'var(--' + t + ')';
    const pending = W.pendingForMe(me), sent = W.sentByMe(me), log = W.myDecisions(me);
    const late = pending.filter((d) => W.pendingHours(d) > 48).length;
    const onWf = s.screen === 'wf';
    const narrow = s.narrow || s.view !== 'desktop';

    /* ---- sidebar ---- */
    const navBtn = (active) => this.navBtnStyle(active);
    const wfTabs = [
      ['pending', __('Awaiting my decision'), pending.length],
      ['sent', __('Sent & following up'), sent.length],
      ['log', __('My decisions log'), log.length],
    ].map(([id, label, count]) => ({
      label, count: count || '', on: onWf && s.wfTab === id ? '1' : '0',
      tip: s.view === 'desktop' && this.navCollapsedPref() ? label + (count ? ' (' + count + ')' : '') : '',
      iconRef: id === 'pending' ? '#i-bolt' : id === 'sent' ? '#i-send' : '#i-list',
      style: navBtn(onWf && s.wfTab === id, false),
      bulletStyle: 'width:5px;height:5px;border-radius:50%;flex:0 0 5px;background:' + (onWf && s.wfTab === id ? 'var(--primary)' : 'var(--line2)') + ';',
      countStyle: this.countPill(count, id === 'pending' && late ? 'red' : ''),
      onPick: () => this.wfGo(id),
    }));

    const sideVals = {
      wfHeadOpen: s.wfHeadOpen === true,
      wfFiltersOpen: s.wfHeadOpen === true,
      wfToggleHead: this.wfToggleHead,
      wfHeadChevron: 'width:14px;height:14px;color:var(--fg3);transition:transform .18s var(--ease);transform:rotate(' + (s.wfHeadOpen === true ? '0deg' : '-90deg') + ');',
      wfTabs, wfTotal: pending.length || '',
      wfHeadStyle: 'display:flex;align-items:center;gap:9px;height:28px;flex:0 0 28px;padding:0 7px;white-space:nowrap;border:0;border-radius:8px;cursor:pointer;font-size:13px;text-align:start;background:' +
        (onWf ? 'var(--sel)' : 'transparent') + ';color:' + (onWf ? 'var(--primary)' : 'var(--fg)') + ';',
      wfHeadBadge: pending.length
        ? 'min-width:18px;height:18px;padding:0 5px;display:grid;place-items:center;border-radius:99px;font-family:var(--font);font-variant-numeric:tabular-nums;font-size:11px;font-weight:600;color:var(--primary-ink);background:' + (late ? 'var(--red)' : 'var(--primary)') + ';'
        : 'display:none;',
      wfGo: this.wfGoPending,
      wfActorLine: __('Acting as {0} — {1}', [meU.name || '', meU.role || '']),
    };

    /* performance: outside the actions screen, don't build cards or preview at all */
    if (!onWf) return {
      ...sideVals,
      wfGroups: [], wfTypeChips: [], wfStateChips: [], wfQuickChips: [], wfLogGroups: [], wfShowGroupSort: false, wfTabsDetail: [], wfMoreItems: [],
      showWfList: false, showWfPreview: false, hasWfDoc: false, noWfDoc: false, wfIsLog: false, wfEmpty: false,
      wfHasChecked: false, wfHasUndo: false, wd: null,
    };

    /* ---- filters ---- */
    let base = s.wfTab === 'pending' ? pending : s.wfTab === 'sent' ? sent : [];
    const typeCounts = {};
    base.forEach((d) => { typeCounts[d.doctype] = (typeCounts[d.doctype] || 0) + 1; });
    const pill = (active, color) => 'height:26px;padding:0 11px;border-radius:99px;cursor:pointer;font-size:12px;white-space:nowrap;border:1px solid ' +
      (active ? (color || 'var(--primary)') : 'var(--line2)') + ';background:' + (active ? 'color-mix(in oklab, ' + (color || 'var(--primary)') + ' 12%, transparent)' : 'transparent') +
      ';color:' + (active ? (color || 'var(--primary)') : 'var(--fg2)') + ';font-weight:' + (active ? '600' : '400') + ';';
    const wfTypeChips = [{ id: 'all', label: __('All {0}', [base.length]) }].concat(
      Object.keys(typeCounts).map((dt) => ({ id: dt, label: W.DOCTYPES[dt].ar + ' ' + typeCounts[dt] }))
    ).map((c) => ({ label: c.label, style: pill(s.wfDocType === c.id), onPick: () => this.setState({ wfDocType: c.id, wfState: 'all' }) }));

    if (s.wfDocType !== 'all') base = base.filter((d) => d.doctype === s.wfDocType);
    const stateSet = [...new Set(base.map((d) => d.state))];
    const wfStateChips = stateSet.length > 1 ? [{ id: 'all', label: __('All statuses') }].concat(stateSet.map((x) => ({ id: x, label: __(x) })))
      .map((c) => ({ label: c.label, style: pill(s.wfState === c.id, tone(W.STATE_TONE[c.id] || 'fg2')), onPick: () => this.setState({ wfState: c.id }) })) : [];
    if (s.wfState !== 'all') base = base.filter((d) => d.state === s.wfState);

    const quicks = [['late', __('Overdue · over 48 hours'), 'var(--red)'], ['today', __('Today'), 'var(--primary)']];
    const wfQuickChips = quicks.map(([id, label, c]) => ({
      label, style: pill(s.wfQuick === id, c), onPick: () => this.setState({ wfQuick: s.wfQuick === id ? null : id }),
    }));
    if (s.wfQuick === 'late') base = base.filter((d) => W.pendingHours(d) > 48);
    if (s.wfQuick === 'today') base = base.filter((d) => W.pendingHours(d) < 24);

    /* header search within documents */
    const wq = (s.wfSearch || '').trim().toLowerCase();
    if (wq) {
      base = base.filter((d) => [d.party, d.name, d.doctype, (W.DOCTYPES[d.doctype] || {}).ar, d.state, __(d.state), W.currentHolder(d)]
        .join(' ').toLowerCase().includes(wq));
    }

    const sortLabels = { oldest: __('Oldest first'), newest: __('Newest') };
    const sorted = base.slice().sort((a, b) =>
      s.wfSort === 'newest' ? W.pendingHours(a) - W.pendingHours(b) : W.pendingHours(b) - W.pendingHours(a));
    this.wfVisible = sorted;

    /* ---- card ---- */
    const comfy = s.density === 'comfortable';
    /* action buttons: if one action leads to an optional state and another to a non-optional one,
       the non-optional one is primary (filled) and the optional secondary (outline). Otherwise the usual color style. */
    const actionStyle = (t, mixed, optional, big) => {
      const c = t.tone === 'green' ? 'var(--green)' : t.tone === 'amber' ? 'var(--amber)' : 'var(--red)';
      const size = big ? 'height:28px;padding:0 13px;font-size:12px;' : 'height:26px;padding:0 10px;font-size:11.5px;';
      let bd, bg, fg;
      if (mixed) {
        if (optional) { bd = 'var(--line2)'; bg = 'transparent'; fg = 'var(--fg2)'; }
        else { bd = c; bg = c; fg = 'var(--on-accent)'; }
      } else { bd = c; bg = t.tone === 'green' ? c : 'transparent'; fg = t.tone === 'green' ? 'var(--on-accent)' : c; }
      return size + 'display:inline-flex;align-items:center;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;border-radius:7px;cursor:pointer;font-weight:600;border:1px solid ' + bd + ';background:' + bg + ';color:' + fg + ';';
    };
    const card = (d) => {
      const h = W.pendingHours(d), aging = W.agingTone(h);
      const st = W.STATE_TONE[d.state] || 'fg2';
      const trs = s.wfTab === 'pending' ? W.getTransitions(d, me) : [];
      const order = { green: 0, amber: 1, red: 2 };
      trs.sort((a, b) => order[a.tone] - order[b.tone]);
      const owner = U[d.owner] || {};
      const checked = s.wfChecked.includes(d.name);
      const active = s.wfSel === d.name;
      return {
        name: d.name, typeAr: W.DOCTYPES[d.doctype].ar, iconRef: '#' + W.DOCTYPES[d.doctype].icon,
        party: W.headlineParty(d),
        since: W.sinceShort ? W.sinceShort(h) : W.sinceText(h),
        sinceStyle: 'font-size:11px;font-family:var(--font);font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto;color:' + (aging === 'red' ? 'var(--red)' : aging === 'amber' ? 'var(--amber)' : 'var(--fg3)') + ';',
        agingDot: 'width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:' + tone(aging) + ';' + (aging === 'red' ? 'animation:shimmer 1.6s ease-in-out infinite;' : ''),
        stateLabel: __(d.state),
        stateStyle: 'display:inline-flex;align-items:center;flex:0 0 auto;white-space:nowrap;height:18px;padding:0 7px;border-radius:99px;font-size:10.5px;font-weight:600;color:' + tone(st) +
          ';background:color-mix(in oklab, ' + tone(st) + ' 13%, transparent);',
        holder: s.wfTab === 'sent' ? __('With: {0}', [W.currentHolder(d)]) : __('Waiting on: {0}', [W.currentHolder(d)]),
        from: __('From: {0} · {1}', [owner.name || d.owner, owner.role || '']),
        holderShort: '→ ' + W.currentHolder(d),
        tip: [W.DOCTYPES[d.doctype].ar + ' ' + d.name, s.wfTab === 'sent' ? __('With: {0}', [W.currentHolder(d)]) : __('Waiting on: {0}', [W.currentHolder(d)]), __('From: {0} · {1}', [owner.name || d.owner, owner.role || ''])].join('\n'),
        typeStyle: s.wfGroup === 'state' || s.wfGroup === 'sender' || s.wfGroup === 'none' ? 'font-size:11px;color:var(--fg2);white-space:nowrap;flex:0 0 auto;' : 'display:none;',
        nameStyle: narrow || d.title_is_name ? 'display:none;' : "font-family:var(--font);font-variant-numeric:tabular-nums;font-size:10.5px;color:var(--fg3);white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;",
        holderStyle: narrow ? 'display:none;' : 'font-size:11px;color:var(--fg3);white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
        filesCount: d.files.length || '',
        filesStyle: d.files.length ? 'display:inline-flex;align-items:center;gap:2px;font-size:10.5px;color:var(--fg3);flex:0 0 auto;' : 'display:none;',
        commentsCount: d.comments.length || '',
        commentsStyle: d.comments.length ? 'display:inline-flex;align-items:center;gap:2px;font-size:10.5px;color:var(--fg3);flex:0 0 auto;' : 'display:none;',
        bar: 'position:absolute;inset-block:9px;inset-inline-start:4px;width:3px;border-radius:3px;background:' + (st === 'fg2' ? 'var(--line2)' : tone(st)) + ';',
        card: 'position:relative;display:flex;align-items:flex-start;gap:10px;min-width:0;padding:8px 10px 8px 14px;padding-inline:14px 10px;border-radius:9px;cursor:pointer;background:' + (active ? 'var(--sel)' : 'var(--panel)') +
          ';border:1px solid ' + (active ? 'var(--primary-line)' : 'var(--line)') + ';transition:none;',
        box: 'width:17px;height:17px;flex:0 0 17px;padding:0;box-sizing:border-box;appearance:none;-webkit-appearance:none;line-height:0;display:grid;place-items:center;border-radius:5px;cursor:pointer;border:1.5px solid ' +
          (checked ? 'var(--primary)' : 'var(--line2)') + ';background:' + (checked ? 'var(--primary)' : 'transparent') + ';color:var(--on-accent);',
        tick: 'width:11px;height:11px;opacity:' + (checked ? '1' : '0') + ';',
        onCheck: (ev) => { ev.stopPropagation(); this.setState((stt) => ({ wfChecked: checked ? stt.wfChecked.filter((n) => n !== d.name) : [...stt.wfChecked, d.name] })); },
        actions: s.wfTab === 'sent'
          ? [{
            label: __('Send reminder'),
            style: 'height:26px;padding:0 10px;display:inline-flex;align-items:center;white-space:nowrap;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:600;border:1px solid var(--line2);background:transparent;color:var(--fg2);',
            onDo: (ev) => { ev.stopPropagation(); this.wfNudge(d.name); },
          }]
          : (() => {
            const opt = trs.map((t) => W.isOptionalTarget ? W.isOptionalTarget(d, t) : false);
            const mixed = opt.some(Boolean) && opt.some((x) => !x);
            return trs.map((t, i) => ({
              label: __(t.action),
              style: actionStyle(t, mixed, opt[i], true),
              onDo: (ev) => { ev.stopPropagation(); this.wfApply(d.name, t.action); },
            }));
          })(),
        /* "comfortable" density: the previous design, unchanged */
        cf: comfy ? {
          holder: s.wfTab === 'sent' ? __('With: {0}', [W.currentHolder(d)]) : __('Waiting on: {0}', [W.currentHolder(d)]),
          from: __('From: {0} · {1}', [owner.name || d.owner, owner.role || '']),
          filesText: d.files.length ? __('{0} attachments', [d.files.length]) : '',
          filesStyle: d.files.length ? '' : 'display:none;',
          commentsText: d.comments.length ? __('{0} comments', [d.comments.length]) : '',
          commentsStyle: d.comments.length ? '' : 'display:none;',
          since: W.sinceText(h),
          stateStyle: 'display:inline-flex;align-items:center;height:21px;padding:0 9px;border-radius:99px;font-size:11px;font-weight:600;color:' + tone(st) +
            ';background:color-mix(in oklab, ' + tone(st) + ' 13%, transparent);',
          bar: 'width:3px;align-self:stretch;flex:0 0 3px;border-radius:3px;background:' + (st === 'fg2' ? 'var(--line2)' : tone(st)) + ';',
          card: 'display:flex;gap:11px;padding:12px 13px;border-radius:12px;cursor:pointer;background:' + (active ? 'var(--sel)' : 'var(--panel)') +
            ';border:1px solid ' + (active ? 'var(--primary-line)' : 'var(--line)') + ';transition:none;',
        } : null,
        /* buttons on the second line; the line wraps only with more than two actions */
        line2Style: 'display:flex;align-items:center;gap:5px 7px;min-width:0;flex-wrap:' + (narrow || trs.length > 2 ? 'wrap' : 'nowrap') + ';',
        onOpen: () => this.wfOpenDoc(d.name),
        onPreview: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.qlOpen(d.doctype, d.name); },
        onPreviewHover: () => this.qlPrefetch(d.doctype, d.name),
      };
    };

    /* ---- grouping ---- */
    const groupKey = (d) => s.wfGroup === 'state' ? d.state : s.wfGroup === 'sender' ? (U[d.owner] || {}).name || d.owner : W.DOCTYPES[d.doctype].ar;
    let wfGroups = [];
    if (s.wfGroup === 'none') wfGroups = [{ label: '', count: '', showHeader: false, cards: sorted.map(card) }];
    else {
      const keys = [];
      sorted.forEach((d) => { const k = groupKey(d); if (!keys.includes(k)) keys.push(k); });
      wfGroups = keys.map((k) => {
        const items = sorted.filter((d) => groupKey(d) === k);
        return { label: k, count: items.length, showHeader: true, cards: items.map(card) };
      });
    }

    /* ---- bulk approval ---- */
    const checkedDocs = s.wfChecked.map((n) => W.DOCS.find((d) => d.name === n)).filter(Boolean);
    let commonAction = null;
    if (checkedDocs.length > 1) {
      const sets = checkedDocs.map((d) => W.getTransitions(d, me).filter((t) => t.tone === 'green').map((t) => t.action));
      commonAction = (sets[0] || []).find((a) => sets.every((set) => set.includes(a))) || null;
    }

    const logV = s.wfTab === 'log' ? this.wfLogVals(log, pill, tone) : { wfLogGroups: [], wfLogTypeChips: [], wfLogPeriodChips: [], wfLogKindChips: [], wfLogEmpty: false };

    /* ---- preview ---- */
    /* on wide screens don't leave the last column empty/stale: if the selected document isn't in the list, select the first */
    if (!narrow && s.wfTab !== 'log' && sorted.length && !sorted.some((d) => d.name === s.wfSel)) {
      const first = sorted[0].name;
      if (this._wfAuto !== first) {
        this._wfAuto = first;
        setTimeout(() => {
          if (this.state.screen !== 'wf') return;
          if (W.loadDoc) W.loadDoc(first);
          this.setState({ wfSel: first, wfNote: '', wfCommentDraft: '', wfNoteError: false, wfConfirm: null, wfDetailTab: 'data', wfItemsOpen: false });
        }, 0);
      }
    } else this._wfAuto = null;
    const sel = W.DOCS.find((d) => d.name === s.wfSel) || null;
    let wd = null;
    if (sel) {
      const stT = W.STATE_TONE[sel.state] || 'fg2';
      const steps = W.path(sel);
      const trs = W.getTransitions(sel, me);
      const order = { green: 0, amber: 1, red: 2 };
      trs.sort((a, b) => order[a.tone] - order[b.tone]);
      const money = (n) => n.toLocaleString('en-US');
      const total = sel.items.reduce((a, it) => a + it[1] * it[2], 0);
      wd = {
        name: sel.name, typeAr: W.DOCTYPES[sel.doctype].ar, party: W.headlineParty(sel), state: __(sel.state),
        since: __('Pending {0}', [W.sinceText(W.pendingHours(sel))]),
        stateStyle: 'display:inline-flex;align-items:center;height:23px;padding:0 11px;border-radius:99px;font-size:12px;font-weight:600;color:' + tone(stT) +
          ';background:color-mix(in oklab, ' + tone(stT) + ' 13%, transparent);',
        derailed: W.derailed(sel),
        derailText: W.derailed(sel) ? __('Workflow ended at “{0}” — {1}', [sel.state, sel.trail[sel.trail.length - 1][3] || __('No reason recorded')]) : '',
        hasTodo: !!sel.todo, todoText: sel.todo ? __('Linked to task: {0}', [sel.todo]) : '',
        openTodo: (e) => {
          if (e && e.preventDefault) e.preventDefault();
          this.openTask(sel.todo_name);
        },
        hasChecks: (sel.checks || []).length > 0 || s.wfForceCheck === sel.name,
        noChecks: !((sel.checks || []).length > 0 || s.wfForceCheck === sel.name),
        checkCount: (sel.checks || []).filter((c) => c.done).length + '/' + (sel.checks || []).length,
        checkBar: 'height:100%;width:' + ((sel.checks || []).length ? Math.round(((sel.checks || []).filter((c) => c.done).length / sel.checks.length) * 100) : 0) +
          '%;background:var(--green);transition:width .25s var(--ease);',
        checklist: (sel.checks || []).map((c) => ({
          label: c.label,
          style: 'display:flex;align-items:center;gap:10px;padding:6px 4px;background:transparent;border:0;border-radius:7px;cursor:pointer;text-align:start;width:100%;',
          box: 'width:17px;height:17px;flex:0 0 17px;display:grid;place-items:center;border-radius:5px;color:var(--on-accent);border:1.5px solid ' +
            (c.done ? 'var(--green)' : 'var(--line2)') + ';background:' + (c.done ? 'var(--green)' : 'transparent') + ';',
          tick: 'width:11px;height:11px;opacity:' + (c.done ? '1' : '0') + ';',
          text: 'font-size:12.5px;line-height:1.6;color:' + (c.done ? 'var(--fg3)' : 'var(--fg)') + ';' + (c.done ? 'text-decoration:line-through;' : ''),
          onToggle: () => this.wfToggleCheck(c.id),
        })),
        steps: steps.map((stp, i) => {
          const done = stp.status === 'done', cur = stp.status === 'current';
          const c = done ? 'var(--green)' : cur ? tone(stT) : 'var(--line2)';
          const last = i === steps.length - 1;
          return {
            state: stp.state,
            wrap: 'display:flex;align-items:stretch;gap:12px;',
            rail: 'flex:0 0 20px;display:flex;flex-direction:column;align-items:center;',
            line: last ? 'display:none;' : 'flex:1;width:2px;min-height:14px;margin:3px 0;border-radius:2px;background:' + (done ? 'var(--green)' : 'var(--line2)') + ';',
            body: 'flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 10px;padding-bottom:' + (last ? '0' : '13px') + ';',
            dot: 'width:20px;height:20px;flex:0 0 20px;display:grid;place-items:center;border-radius:50%;color:var(--on-accent);background:' +
              (done ? 'var(--green)' : cur ? tone(stT) : 'var(--panel)') + ';border:2px solid ' + c + ';' + (cur ? 'box-shadow:0 0 0 4px color-mix(in oklab,' + tone(stT) + ' 18%, transparent);' : ''),
            tickStyle: 'width:11px;height:11px;opacity:' + (done ? '1' : '0') + ';',
            labelStyle: 'font-size:13px;line-height:1.5;font-weight:' + (cur ? '700' : '500') + ';color:' + (done || cur ? 'var(--fg)' : 'var(--fg3)') + ';',
            metaStyle: 'font-size:11px;line-height:1.5;color:' + (cur ? tone(stT) : 'var(--fg3)') + ';',
            meta: cur ? (trs.length ? __('← Awaiting you') : __('Awaiting {0}', [W.currentHolder(sel)]))
              : stp.by ? ((U[stp.by] || {}).name || stp.by) + ' · ' + W.sinceText(stp.hours)
                : (((W.WORKFLOWS[sel.doctype].transitions.find((t) => t.next_state === stp.state) || {}).allowed) || '—'),
            tip: stp.by ? ((U[stp.by] || {}).name || '') + ' — ' + ((U[stp.by] || {}).role || '') + ' · ' + W.tsOf(stp.hours) + (stp.note ? ' · ' + stp.note : '') : stp.state,
          };
        }),
        /* fields / items / comments / files / historyRows: shared with the task's linked-document tabs (doc-tabs.js) */
        ...this.docPanelVals({ ...sel, fields: this.govFields(sel) }, { userOf: (u) => U[u], toneOf: (st) => W.STATE_TONE[st] }),
        itemsOpen: !!s.wfItemsOpen,
        meAvatar: 'width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:grid;place-items:center;font-size:10px;font-weight:600;' + this.avaBg(me),
        meInitials: (U[me] || {}).initials || '?',
        transitions: trs.map((t) => ({
          label: __(t.action) + (t.destructive && s.wfConfirm === t.action + sel.name ? ' — ' + __('Confirm?') : ''),
          style: 'height:34px;padding:0 16px;white-space:nowrap;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;border:1px solid ' +
            (t.tone === 'green' ? 'var(--green)' : t.tone === 'amber' ? 'var(--amber)' : 'var(--red)') +
            ';background:' + (t.tone === 'green' ? 'var(--green)' : s.wfConfirm === t.action + sel.name ? 'var(--red-soft)' : 'transparent') +
            ';color:' + (t.tone === 'green' ? 'var(--on-accent)' : t.tone === 'amber' ? 'var(--amber)' : 'var(--red)') + ';',
          onDo: () => this.wfApply(sel.name, t.action),
        })),
        noTransitions: trs.length === 0,
        watchText: sel.owner === me ? __('You created this — the document is now with {0}', [W.currentHolder(sel)]) : __('No action available for your role at this stage'),
      };
    }

    const detailTabs = [['data', __('Data')], ['comments', __('Comments') + (sel && sel.comments.length ? ' (' + sel.comments.length + ')' : '')],
      ['files', __('Attachments') + (sel && sel.files.length ? ' (' + sel.files.length + ')' : '')], ['log', __('History')]];


    return {
      /* sidebar */
      ...sideVals,

      /* middle panel */
      showWfList: onWf && (!narrow || s.wfPane === 'list'),
      showWfPreview: onWf && (!narrow ? s.wfTab !== 'log' : s.wfPane === 'detail'),
      wfListPaneStyle: (narrow || s.wfTab === 'log' ? 'flex:1 1 auto;' : 'flex:0 0 470px;') +
        'min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--panel2);border-inline-start:1px solid var(--line);' +
        (!narrow && s.wfTab !== 'log' ? 'border-inline-end:1px solid var(--line2);' : ''),
      wfPreviewPaneStyle: 'flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--panel);',
      wfTitle: s.wfTab === 'pending' ? __('Awaiting my decision') : s.wfTab === 'sent' ? __('Sent & following up') : __('My decisions log'),
      wfCount: __('{0} items', [s.wfTab === 'log' ? logV.wfLogCount : sorted.length]),
      wfSubtitle: s.wfTab === 'pending'
        ? (meU.name || '') + ' — ' + (meU.role || '') + (late ? ' · ' + __('{0} overdue by more than 48 hours', [late]) : '')
        : s.wfTab === 'sent' ? __('Documents you created that have not reached their final status — where they stopped and with whom')
          : __('Every approval or rejection you made, from the tool or from the document form — last 180 days'),
      wfIsLog: s.wfTab === 'log',
      wfShowFilters: s.wfTab !== 'log',
      wfTypeChips: s.wfTab === 'log' ? logV.wfLogTypeChips : wfTypeChips,
      wfStateChips: s.wfTab === 'log' ? logV.wfLogKindChips : wfStateChips,
      wfQuickChips: s.wfTab === 'log' ? logV.wfLogPeriodChips : wfQuickChips,
      wfShowGroupSort: s.wfTab !== 'log',
      wfGroupLabel: { doctype: __('Document Type'), state: __('Status'), sender: __('Sender'), none: __('None') }[s.wfGroup],
      wfCycleGroup: () => { const o = ['doctype', 'state', 'sender', 'none']; this.setState({ wfGroup: o[(o.indexOf(s.wfGroup) + 1) % 4] }); },
      wfSortLabel: sortLabels[s.wfSort],
      wfCycleSort: () => { const o = ['oldest', 'newest']; this.setState({ wfSort: o[(o.indexOf(s.wfSort) + 1) % 2] }); },
      wfGroups: s.wfTab === 'log' ? [] : wfGroups,
      wfEmpty: s.wfTab !== 'log' && sorted.length === 0,
      wfEmptyTitle: s.wfTab === 'pending' ? __('Nothing awaiting your decision') : __('No documents here'),
      wfEmptyBody: s.wfTab === 'pending'
        ? this.wfLogVals(log).wfLogWeekText
        : __('Change the filter or tab above.'),
      ...logV,

      /* bulk approval */
      wfHasChecked: s.wfChecked.length > 0,
      wfCheckedLabel: __('Selected: {0}', [s.wfChecked.length]),
      wfBulkLabel: commonAction ? __('{0} — {1} items', [commonAction, s.wfChecked.length]) : __('No common action'),
      wfBulkStyle: 'height:28px;padding:0 12px;border-radius:8px;cursor:' + (commonAction ? 'pointer' : 'not-allowed') +
        ';font-size:12px;font-weight:600;border:1px solid currentColor;background:transparent;opacity:' + (commonAction ? '1' : '.5') + ';',
      wfBulkDo: () => commonAction ? this.wfBulk(commonAction) : this.toast(__('The selected items do not share a single action')),
      wfClearChecked: () => this.setState({ wfChecked: [] }),

      /* preview */
      hasWfDoc: !!wd, noWfDoc: !wd,
      wfNoDocText: s.wfTab === 'log' ? __('Your decisions log — pick another tab to make a new decision') : __('Select a transaction to view its workflow and data'),
      wd, wfNarrow: narrow, wfBack: () => this.setState({ wfPane: 'list', mobileScreen: 'list' }),
      wfNewCheck: s.wfNewCheck,
      onWfNewCheck: (e) => this.setState({ wfNewCheck: e.target.value }),
      onWfCheckKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.wfAddCheck(); } },
      wfAddCheckItem: this.wfAddCheck,
      wfStartChecklist: () => this.setState({ wfForceCheck: s.wfSel }),
      wfStepperWrap: 'display:flex;flex-direction:column;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel2);',
      wfMoreOpen: !!s.wfMore,
      wfMoreBtnStyle: 'width:32px;height:32px;display:grid;place-items:center;background:' + (s.wfMore ? 'var(--sunk)' : 'transparent') +
        ';border:1px solid ' + (s.wfMore ? 'var(--line)' : 'var(--line2)') + ';border-radius:8px;cursor:pointer;color:var(--fg2);',
      wfToggleMore: () => this.setState((st) => ({ wfMore: !st.wfMore })),
      wfMoreItems: [
        { label: __('Open reference'), iconRef: '#i-link', onDo: () => { this.setState({ wfMore: false }); if (sel) this.openRef(sel.doctype, sel.name); } },
        ...(sel && sel.can_print === 0 ? [] : [{ label: __('Print'), iconRef: '#i-printer', onDo: () => { this.setState({ wfMore: false }); if (sel) this.printDoc(sel.doctype, sel.name); } }]),
      ],
      wfStepsOpen: s.wfStepsOpen === true,
      wfToggleSteps: () => this.setState((st) => ({ wfStepsOpen: st.wfStepsOpen !== true })),
      wfStepsChevron: 'width:14px;height:14px;color:var(--fg3);transition:transform .18s var(--ease);transform:rotate(' + (s.wfStepsOpen === true ? '0deg' : '-90deg') + ');',
      wfStepsSummary: sel ? (wd.state || '') + ' · ' + __('{0} stages', [wd.steps.length]) : '',
      wfTabsDetail: this.docTabItems(detailTabs.map(([id, label]) => ({ id, label })), s.wfDetailTab, (id) => this.setState({ wfDetailTab: id }), 'tt-wf'),
      wfTabData: s.wfDetailTab === 'data', wfTabComments: s.wfDetailTab === 'comments',
      wfTabFiles: s.wfDetailTab === 'files', wfTabLog: s.wfDetailTab === 'log',
      wfToggleItems: () => this.setState({ wfItemsOpen: !s.wfItemsOpen }),
      wfAllFields: () => sel && this.qlOpen(sel.doctype, sel.name),
      wfNote: s.wfNote,
      onWfNote: (e) => this.setState({ wfNote: e.target.value, wfNoteError: false }),
      wfNotePlaceholder: __('Add a note with the decision… (required when rejecting or returning)'),
      wfNoteStyle: 'width:100%;height:36px;padding:0 12px;background:var(--sunk);border:1px solid ' + (s.wfNoteError ? 'var(--red)' : 'var(--line)') +
        ';border-radius:9px;outline:none;font-size:13px;',
      wfBarHint: narrow ? '' : __('a approve · x return · j/k navigate'),
      wfAddComment: this.wfComment,
      wfCommentDraft: s.wfCommentDraft || '',
      onWfCommentDraft: (e) => this.setState({ wfCommentDraft: e.target.value }),
      onWfCommentKey: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.wfComment(); } },
      wfCommentPlaceholder: __('Write a comment on this document…'),
      wfCommentBtnStyle: 'height:30px;padding:0 14px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid var(--primary);cursor:pointer;' +
        ((s.wfCommentDraft || '').trim() ? 'background:var(--primary);color:var(--on-accent);' : 'background:transparent;color:var(--primary);opacity:.6;'),
      wfNudgeSel: () => s.wfSel && this.wfNudge(s.wfSel),

      /* undo */
      wfHasUndo: !!s.wfUndo, wfUndoText: s.wfUndo ? s.wfUndo.text : '', wfUndoDo: this.wfUndoDo,
    };
  }
});
