/* ToDoBox: renderVals, template values for all screens */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  renderVals() {
    const s = this.state;
    const A = this.api;
    if (!A) return {
      loading: true, skeletons: [1, 2, 3, 4, 5, 6], uiDir: window.TT_DIR || 'ltr', isDesktop: true, isMobile: false, cards: [], folders: [], labels: [], quickFilters: [],
      screens: [], savedViews: [], notifs: [], dayRows: [], ...this.statsVals(),
      rules: [], recurring: [], autoFx: {}, tplFx: {}, svFx: {}, rcf: {}, queryHints: [], templates: [],
      filterChips: [], hasFilterChips: false, qbCats: [], qbValues: [], qbTip: ' ', hintsBtnStyle: 'display:none;',
      qbSearchable: false, qbNoResults: false, qbMore: '', qbq: '', qbSearchPlaceholder: __('Search…'), qbValuesStyle: 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;',
      qbShowDate: false, qbDateVal: '', qbDateLabel: ' ', qbDateStyle: 'display:none;', savingViewStrip: false, canSaveView: false,
      screenDay: false, screenStats: false, mailMobile: false, notifsOpen: false, snoozeOpen: false, automationOpen: false,
      filtersChevron: 'width:13px;height:13px;', wfHeadChevron: 'width:14px;height:14px;', wfTotal: ' ', wfActorLine: ' ',
      hasDetail: false, noDetail: false, detailHeadStyle: '', wfHeadBarStyle: '', titleSize: '16px', headActionsInline: false, headActionsRow: false, showList: true, showDetail: true, narrow: s.narrow, listCount: '', notifUnread: 0, darkIconRef: '#i-moon', sortLabel: '',
      listPaneStyle: 'flex:0 0 410px;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--panel2);border-inline-start:1px solid var(--line);border-inline-end:1px solid var(--line2);',
      detailPaneStyle: 'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--panel);',
      toggleHints: () => {}, people: [], mobileNav: [], composerTabs: [], peopleOptions: [],
      sidebarToggle: () => {}, sidebarToggleLabel: __('Collapse sidebar'), sidebarExpanded: 'true', sidebarToggleIcon: '#i-sidebar', sidebarResizeLabel: __('Resize sidebar (double-click to reset)'),
      emptyZero: '0',
      screenDay: false, screenStats: false, mailMobile: false, notifsOpen: false, snoozeOpen: false, automationOpen: false,
      filtersChevron: 'width:13px;height:13px;', wfHeadChevron: 'width:14px;height:14px;', wfTotal: ' ', wfActorLine: ' ',
      hasDetail: false, noDetail: false, detailHeadStyle: '', wfHeadBarStyle: '', titleSize: '16px', headActionsInline: false, headActionsRow: false, showList: true, showDetail: true, narrow: s.narrow, listCount: '', notifUnread: 0, darkIconRef: '#i-moon', sortLabel: '',
      listPaneStyle: 'flex:0 0 410px;min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--panel2);border-inline-start:1px solid var(--line);border-inline-end:1px solid var(--line2);',
      detailPaneStyle: 'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--panel);',
      openCompose: this.openCompose, composeOpen: !!s.compose,
      toggleNotifs: () => this.setState({ notifsOpen: !s.notifsOpen }),
      closeNotifs: () => this.setState({ notifsOpen: false }), notifsEmpty: true,
      ...this.themeVals(true),
    };

    const U = A.USERS, ME = A.ME;
    const sel = this.selected();
    const isDesktop = s.view === 'desktop';
    const comfy = s.density === 'comfortable';
    const iref = (n) => '#i-' + n;
    const navBtn = (active) => this.navBtnStyle(active);
    /* desktop sidebar collapsed to an icon rail (Frappe desk style); the phone drawer is never collapsed */
    const navCol = isDesktop && this.navCollapsedPref();
    const mine = s.tasks;

    /* folders */
    const folders = A.FOLDERS.map((f) => {
      const active = s.screen === 'mail' && s.folder === f.id && !s.label && !s.activeView;
      return {
        ...f, count: s.counts[f.id] || 0, iconRef: iref(f.icon), on: active ? '1' : '0',
        tip: navCol ? f.label + (s.counts[f.id] ? ' (' + s.counts[f.id] + ')' : '') : (f.filter || ''),
        style: navBtn(active),
        countStyle: this.countPill(s.counts[f.id], f.id === 'inbox' && s.counts.inboxUnread ? 'primary' : f.id === 'overdue' ? 'red' : ''),
        onPick: () => { this.setState({ screen: 'mail', folder: f.id, label: null, activeView: null, search: '', searchInput: '', loading: true, sel: null, pane: 'list', mobileScreen: 'list' }, () => this.load()); },
      };
    });

    const allLabels = [...new Set(A.FOLDERS.length ? s.tasks.concat([]).flatMap((t) => t.labels || []) : [])];
    const labelSet = allLabels;
    const labels = labelSet.slice(0, 6).map((lb, i) => ({
      label: lb, on: s.label === lb ? '1' : '0', tip: navCol ? lb : '',
      dot: 'width:7px;height:7px;margin:0 4.5px;flex:0 0 7px;border-radius:50%;background:var(--ava-' + this.toneIdx(lb) + ');',
      style: navBtn(s.label === lb),
      onPick: () => this.setState({ label: s.label === lb ? null : lb, loading: true }, () => this.load()),
    }));

    /* quick filters */
    const qf = [['all', __('All')], ['overdue', __('Overdue')], ['today', __('Today')], ['week', __('This week')], ['unread', __('Unread')]];
    const quickFilters = qf.map(([id, label]) => ({
      label, style: this.pill(s.quick === id),
      onPick: () => this.setState({ quick: id, loading: true }, () => this.load()),
    }));

    /* cards — hidden while a user-initiated context switch is loading (only the skeleton shows);
       background refreshes don't set loading, so the list stays in place */
    const soonLimit = (() => { const x = new Date(A.TODAY + 'T00:00:00'); x.setDate(x.getDate() + 2); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); })();
    const cards = s.loading ? [] : s.tasks.map((t) => {
      const other = t.allocated_to === ME ? t.assigned_by : t.allocated_to;
      const u = U[other] || { name: other, initials: '?' };
      const last = t.thread[t.thread.length - 1] || { html: t.description };
      const replies = t.thread.filter((x) => x.kind !== 'event' && x.kind !== 'desc').length;
      const overdue = t.status === 'Open' && t.date < A.TODAY;
      const dueToday = t.date === A.TODAY;
      const chips = [];
      const dueDM = t.date.slice(8, 10) + '/' + t.date.slice(5, 7);
      /* urgency: overdue → red, today → amber, within two days → brand, later → neutral */
      const soon = !overdue && !dueToday && t.status === 'Open' && t.date > A.TODAY && t.date <= soonLimit;
      const dueChip = (this.chip(overdue ? __('Overdue · {0}', [dueDM]) : dueToday ? __('Today · {0}', [dueDM]) : dueDM,
        overdue ? 'var(--red)' : dueToday ? 'var(--amber)' : soon ? 'var(--primary)' : 'var(--fg2)',
        overdue ? 'var(--red-soft)' : dueToday ? 'var(--amber-soft)' : soon ? 'var(--primary-soft)' : 'var(--sunk)'));
      if (t.reference_name) chips.push(this.chip(t.reference_name, 'var(--fg2)', 'var(--sunk)'));
      (t.labels || []).slice(0, 1).forEach((l) => chips.push(this.chip(l, 'var(--fg2)', 'var(--sunk)')));
      if (t.attachments && t.attachments.length) chips.push(this.chip(__('Attachment'), 'var(--fg2)', 'var(--sunk)'));
      if (t.forwarded_from === ME) chips.push(this.chip(__('Forwarded'), 'var(--fg2)', 'var(--sunk)'));
      if ((t.custom_checklist || []).length) chips.push(this.chip(__('{0}/{1} steps', [t.custom_checklist.filter((c) => c.done).length, t.custom_checklist.length]), 'var(--fg2)', 'var(--sunk)'));
      const wd = A.waitingDays(t);
      if (wd !== null) chips.push(this.chip(wd === 0 ? __('Awaiting reply') : __('No reply for {0} days', [wd]), wd >= A.STALE_DAYS ? 'var(--amber)' : 'var(--fg2)', wd >= A.STALE_DAYS ? 'var(--amber-soft)' : 'var(--sunk)'));
      if (t.rule_applied) chips.push(this.chip(__('Automation rule'), 'var(--fg2)', 'var(--sunk)'));
      const active = s.sel === t.name;
      const hov = s.hovered === t.name;
      const sw = s.swipe && s.swipe.name === t.name ? s.swipe.dx : 0;
      const tiny = (c) => ({ ...c, style: c.style.replace('height:20px;padding:0 7px;', 'height:18px;padding:0 6px;').replace('font-size:11px;', 'font-size:10.5px;') });
      const MAXC = isDesktop ? 2 : 3;
      const chipsShown = chips.slice(0, MAXC).map(tiny);
      const chipsMore = chips.length > MAXC ? '+' + (chips.length - MAXC) : '';
      /* "comfortable" density: the previous design, unchanged */
      const cf = comfy ? {
        avatar: this.ava(other, 30),
        prioBar: 'position:absolute;inset-block:var(--row-py);inset-inline-start:12px;width:3px;border-radius:3px;background:' + this.prioColor(t.priority) + ';opacity:' + (t.priority === 'Low' ? '.35' : '1') + ';',
        rowStyle: 'position:relative;display:flex;flex-wrap:wrap;gap:0 10px;padding-block:var(--row-py);padding-inline:25px 12px;border-radius:10px;cursor:pointer;background:' +
          (active ? 'var(--sel)' : 'transparent') +
          (active ? '' : hov ? ';background:var(--hover)' : '') +
          ';touch-action:pan-y;transform:translateX(' + sw + 'px);' + (sw ? 'transition:none;' : 'transition:transform .2s var(--ease);'),
        senderStyle: 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;font-weight:' + (t.read ? '500' : '700') + ';',
        subjectStyle: 'font-size:13px;line-height:var(--row-lh);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:' + (t.read ? '400' : '600') + ';',
        dotStyle: t.read ? 'display:none;' : 'position:absolute;top:12px;inset-inline-end:6px;width:7px;height:7px;border-radius:50%;background:var(--primary);',
        snippet: this.plainText(last.html).slice(0, 90),
        chips: [dueChip, ...chips],
        headStyle: 'flex:1;min-width:0;display:flex;align-items:center;gap:6px;',
        actionsStyle: 'display:' + (isDesktop ? 'flex' : 'none') + ';flex:0 0 auto;flex-direction:column;gap:4px;visibility:' + (hov && !this.isLocked(t) ? 'visible' : 'hidden') + ';',
      } : null;
      return {
        name: t.name, initials: u.initials, sender: u.name, subject: t.subject,
        /* shell styling hooks (data-* attributes only — see todobox-shell.css) */
        prio: String(t.priority || 'Low').toLowerCase(), unread: t.read ? '0' : '1',
        checkedFlag: s.checked.includes(t.name) ? '1' : '0', overdueFlag: overdue ? '1' : '0',
        snippet: (() => { const x = this.plainText(last.html).slice(0, 90); return x ? ' — ' + x : ''; })(), time: this.fmtTime(t.modified),
        replies: replies > 1 ? '(' + replies + ')' : '',
        avatar: this.ava(other, 28),
        prioBar: 'position:absolute;inset-block:calc(var(--row-py) + 2px);inset-inline-start:5px;width:3px;border-radius:3px;background:' + this.prioColor(t.priority) + ';opacity:' + (t.priority === 'Low' ? '.35' : '1') + ';',
        rowStyle: 'position:relative;flex:0 0 auto;display:flex;align-items:center;gap:10px;min-width:0;padding-block:var(--row-py);padding-inline:14px 10px;border-radius:8px;cursor:pointer;background:' +
          (active ? 'var(--sel)' : 'transparent') +
          (active ? '' : hov ? ';background:var(--hover)' : '') +
          ';touch-action:pan-y;transform:translateX(' + sw + 'px);transition:' + (sw ? 'none' : 'transform .2s var(--ease)') + ';',
        wrapStyle: 'position:relative;flex:0 0 auto;border-radius:8px;overflow:hidden;',
        mobileStyle: 'transform:translateX(' + sw + 'px);transition:' + (sw ? 'none' : 'transform .2s var(--ease)') + ';',
        swipeBg: (sw ? 'display:flex;' : 'display:none;') + 'position:absolute;inset:0;align-items:center;justify-content:' + (sw > 0 ? 'flex-start' : 'flex-end') +
          ';padding:0 18px;border-radius:12px;font-size:13px;font-weight:600;color:var(--on-accent);background:' + (sw > 0 ? 'var(--green)' : 'var(--primary)') + ';',
        swipeLabel: sw > 0 ? '✓ ' + __('Complete') : sw < 0 ? '😴 ' + __('Snooze') : '',
        senderStyle: 'min-width:0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + (t.read ? 'var(--fg2)' : 'var(--fg)') + ';font-weight:' + (t.read ? '500' : '700') + ';',
        subjectStyle: 'font-size:13px;color:var(--fg);font-weight:' + (t.read ? '400' : '600') + ';',
        dotStyle: t.read ? 'display:none;' : 'width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--primary);',
        chips: chipsShown, chipsMore, hasChipsMore: !!chipsMore, due: tiny(dueChip), cf,
        timeStyle: 'font-size:11px;color:var(--fg3);font-family:var(--font);font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto;visibility:' + (hov && isDesktop ? 'hidden' : 'visible') + ';',
        box: 'width:18px;height:18px;flex:0 0 18px;padding:0;box-sizing:border-box;appearance:none;-webkit-appearance:none;line-height:0;display:grid;place-items:center;border-radius:5px;cursor:pointer;border:1.5px solid ' +
          (s.checked.includes(t.name) ? 'var(--primary)' : 'var(--line2)') + ';background:' + (s.checked.includes(t.name) ? 'var(--primary)' : 'transparent') + ';color:var(--on-accent);',
        tick: 'width:11px;height:11px;opacity:' + (s.checked.includes(t.name) ? '1' : '0') + ';',
        onCheck: (ev) => {
          ev.stopPropagation();
          this.setState((st) => ({ checked: st.checked.includes(t.name) ? st.checked.filter((n) => n !== t.name) : [...st.checked, t.name] }));
        },
        headStyle: 'flex:1;min-width:0;display:flex;align-items:center;gap:6px;',
        actionsStyle: 'display:' + (isDesktop && hov && !this.isLocked(t) ? 'flex' : 'none') + ';position:absolute;top:calc(var(--row-py) - 3px);inset-inline-end:8px;gap:4px;padding:2px;border-radius:9px;background:var(--panel);box-shadow:0 1px 3px rgba(0,0,0,.12);',
        actions: this.isLocked(t) ? [] : [
          { act: 'complete', iconRef: '#i-check', title: __('Complete (e)'), onDo: (ev) => { ev.stopPropagation(); this.complete(t.name); } },
          { act: 'forward', iconRef: '#i-forward', title: __('Forward (f)'), onDo: (ev) => { ev.stopPropagation(); this.open(t.name); this.setState({ forward: { to: null, mode: 'full', reason: '', busy: false } }, () => this.pplOpen('fwd')); } },
          { act: 'snooze', iconRef: '#i-moon', title: __('Snooze (s)'), onDo: (ev) => { ev.stopPropagation(); this.open(t.name); this.openSnooze(t.name); } },
        ],
        onOpen: () => { if (this.justSwiped) { this.justSwiped = false; return; } this.open(t.name); },
        onEnter: () => { if (isDesktop) this.setState({ hovered: t.name }); },
        onLeave: () => { if (isDesktop) this.setState({ hovered: null }); },
        /* horizontal swipe on mobile: right = complete, left = snooze (doesn't block vertical scroll or taps) */
        onDown: (e) => { if (isDesktop || e.pointerType === 'mouse') return; this.sw0 = { x: e.clientX, y: e.clientY, name: t.name, on: false }; },
        onMove: (e) => {
          const g = this.sw0; if (!g || g.name !== t.name) return;
          const dx = e.clientX - g.x, dy = e.clientY - g.y;
          if (!g.on) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this.sw0 = null; return; }
            if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5) g.on = true; else return;
          }
          this.setState({ swipe: { name: t.name, dx: Math.max(-140, Math.min(140, dx)) } });
        },
        onUp: () => {
          const g = this.sw0; this.sw0 = null;
          if (!g || !g.on) return;
          const dx = s.swipe && s.swipe.name === t.name ? s.swipe.dx : 0;
          this.justSwiped = true; setTimeout(() => { this.justSwiped = false; }, 350);
          this.setState({ swipe: null });
          if (navigator.vibrate && Math.abs(dx) > 80) navigator.vibrate(12);
          if (dx > 80) this.complete(t.name); else if (dx < -80) this.snooze(t.name);
        },
        onCancel: () => { this.sw0 = null; if (s.swipe) this.setState({ swipe: null }); },
      };
    });

    /* detail */
    let d = null;
    if (sel) {
      const from = U[sel.assigned_by] || {}, to = U[sel.allocated_to] || {};
      let items = sel.thread.map((x) => ({ ...x }));
      const eventCount = items.filter((x) => x.kind === 'event').length;
      let hidden = 0;
      if (!s.showEvents && eventCount > 3) {
        const keep = items.filter((x) => x.kind === 'event').slice(-2).map((x) => x.id);
        hidden = eventCount - 2;
        items = items.filter((x) => x.kind !== 'event' || keep.includes(x.id));
      }
      let lastDay = null, lastUser = null;
      const thread = items.map((x) => {
        const day = x.ts.slice(0, 10);
        const divider = day !== lastDay; lastDay = day;
        const grouped = !divider && x.user === lastUser && x.kind !== 'event'; lastUser = x.kind === 'event' ? null : x.user;
        const internal = x.kind === 'comment';
        const bg = internal ? 'var(--amber-soft)' : x.kind === 'desc' ? 'var(--panel2)' : 'var(--panel)';
        const bd = internal ? 'var(--amber)' : 'var(--line)';
        return {
          divider, dividerLabel: this.dayLabel(x.ts),
          isEvent: x.kind === 'event', isBubble: x.kind !== 'event', isInternal: internal,
          icon: '↪', who: (U[x.user] || {}).name || x.user, initials: (U[x.user] || {}).initials || '?',
          text: x.kind === 'event' ? this.plainText(x.html) : x.html, rich: x.kind === 'event' ? null : this.richHtml(x.html), time: x.ts.slice(11, 16),
          wrap: 'display:flex;gap:10px;align-items:flex-start;margin-top:' + (grouped ? '4px' : '10px') + ';',
          avatar: this.ava(x.user, 30) + (grouped ? 'visibility:hidden;' : ''),
          bubble: 'flex:1;padding:11px 14px;border-radius:12px;background:' + bg + ';border:1px solid ' + bd + ';',
        };
      });
      const props = [
        { label: __('Priority'), iconRef: '#i-alert', value: sel.priority === 'High' ? __('High') : sel.priority === 'Medium' ? __('Medium') : __('Low'), color: this.prioColor(sel.priority), onEdit: () => this.cyclePriority(sel) },
        { label: __('Due'), iconRef: '#i-calendar', value: sel.date.slice(8, 10) + '/' + sel.date.slice(5, 7), color: sel.date < A.TODAY ? 'var(--red)' : 'var(--fg)', onEdit: () => this.bumpDate(sel) },
      ].map((p, i) => ({ ...p, style: 'display:flex;align-items:center;gap:6px;height:30px;padding:0 11px;background:transparent;border:0;cursor:pointer;font-size:12px;color:' + p.color + ';' + (i ? 'border-inline-start:1px solid var(--line);' : '') }));

      const wdSel = A.waitingDays(sel);
      const stale = wdSel !== null && wdSel >= A.STALE_DAYS;
      const ck = sel.custom_checklist || [];
      const ckDone = ck.filter((x) => x.done).length;
      const acts = ((s.docActs || {})[sel.name] || {}).actions || [];
      const canManage = this.canManage(sel);
      const locked = this.isLocked(sel);
      const canAddCheck = this.canAddCheck(sel);
      const showCk = ck.length > 0 || (canAddCheck && s.forceChecklist === sel.name);

      d = {
        /* linked-document tabs (doc-tabs.js): hasRefTabs, refTabs, refOnTask, rd, … */
        ...this.refTabVals(sel),
        name: sel.name, subject: sel.subject, thread_id: sel.thread_id,
        statusLabel: sel.status === 'Open' ? __('Open') : sel.status === 'Closed' ? __('Completed') : __('Cancelled'),
        /* Frappe indicator-pill: colour comes from data-tone in todobox-shell.css */
        statusStyle: '',
        statusTone: sel.status === 'Open' ? (sel.date < A.TODAY ? 'red' : 'blue') : sel.status === 'Closed' ? 'green' : 'gray',
        prioTone: sel.priority === 'High' ? 'red' : sel.priority === 'Medium' ? 'orange' : 'gray',
        fromName: from.name || sel.assigned_by, fromTitle: from.title || '', fromInitials: from.initials || '?', fromAvatar: this.ava(sel.assigned_by, 30),
        toName: to.name || sel.allocated_to, toTitle: to.title || '', toInitials: to.initials || '?', toAvatar: this.ava(sel.allocated_to, 30),
        cc: (sel.cc_users || []).map((c) => ({ name: (U[c] || {}).name || c, initials: (U[c] || {}).initials || '?', avatar: this.ava(c, 18) })),
        ccToggleLabel: (sel.cc_users || []).length ? (s.ccOpen ? __('Hide CC') : __('CC ({0})', [sel.cc_users.length])) : __('No CC'),
        props, thread, hasHidden: hidden > 0, hiddenLabel: __('Show {0} earlier events', [hidden]),
        segStyle: 'display:flex;align-items:center;gap:6px;height:30px;padding:0 11px;background:transparent;border:0;cursor:pointer;font-size:12px;font-weight:600;color:var(--fg);',
        prioLabel: sel.priority === 'High' ? __('High') : sel.priority === 'Medium' ? __('Medium') : __('Low'),
        prioSegStyle: 'display:flex;align-items:center;gap:6px;height:30px;padding:0 11px;background:transparent;border:0;cursor:' + (canManage ? 'pointer' : 'default') + ';font-size:12px;font-weight:600;color:' + this.prioColor(sel.priority) + ';',
        onCyclePriority: () => this.cyclePriority(sel),
        prioTitle: locked ? __('This task is completed — you can only add comments and attachments') : canManage ? __('Priority — click to change') : __('Only the task creator can edit priority, date, subject and checklist'),
        dateTitle: locked ? __('This task is completed — you can only add comments and attachments') : canManage ? __('Edit due date') : __('Only the task creator can edit priority, date, subject and checklist'),
        locked, active: !locked, canManage, lockTitle: canManage ? '' : __('Only the task creator can edit priority, date, subject and checklist'),
        dateISO: sel.date,
        dateLabel: sel.date.slice(8, 10) + '/' + sel.date.slice(5, 7),
        dateSegStyle: 'display:flex;align-items:center;gap:6px;height:30px;padding:0 11px;background:transparent;border:0;border-inline:1px solid var(--line);cursor:' + (canManage ? 'pointer' : 'default') + ';font-size:12px;font-weight:600;color:' + (sel.date < A.TODAY ? 'var(--red)' : 'var(--fg)') + ';',
        dateIdle: true,
        startDateEdit: (e) => { if (!this.guardManage(sel)) return; this.openFrappeDate(e, sel.date, (v) => this.setDueDate(sel.name, v), { title: __('Due date') }); },
        onDateHover: () => this.setState({ dateHover: true }),
        onDateLeave: () => this.setState({ dateHover: false }),
        penStyle: 'width:12px;height:12px;flex:0 0 auto;transition:opacity .15s var(--ease);opacity:' + (s.dateHover && canManage ? '.9' : '0') + ';',
        titleEditable: canManage ? 'true' : 'false',
        tags: (sel.labels || []).map((lb) => ({
          label: lb,
          onRemove: () => this.setLabels(sel.name, (sel.labels || []).filter((x) => x !== lb)),
        })),
        tagPickerOpen: !locked && !!s.tagPicker,
        toggleTagPicker: () => this.setState((st) => ({ tagPicker: !st.tagPicker })),
        tagPickerClosed: locked || !s.tagPicker,
        /* "+ Tag" opens a Frappe tag field (Tag list suggestions, new tags allowed) holding the task's tags */
        tagEditor: this.fxSlot('tagEditor:' + sel.name, (el) => {
          const ctl = new window.TMControls.TagsInput(el, { value: (this.selTask() || sel).labels || [], placeholder: __('Add tags…'), ariaLabel: __('Tags'),
            suggestions: (q) => this.tmcTagPool(q), onChange: (v) => this.setLabels(sel.name, v || []) });
          setTimeout(() => ctl.focus && ctl.focus(), 0);
          return ctl;
        }),
        hasRef: !!sel.reference_name, refName: sel.reference_name,
        refMeta: (sel.reference_type || '') + (sel.ref_status ? ' · ' + sel.ref_status : ''),
        refAmount: sel.ref_amount || '',
        hasAttachments: !!(sel.attachments && sel.attachments.length),
        attachments: (sel.attachments || []).map((a, i, all) => ({
          label: typeof a === 'string' ? a : a.name,
          onOpen: () => this.openFilePreview(all.map((x) => (typeof x === 'string' ? { name: x, url: '' } : { name: x.name, url: x.url })), i),
        })),

        isWaiting: wdSel !== null,
        waitStyle: 'display:flex;align-items:center;gap:12px;margin:14px 20px 0;padding:12px 15px;border-radius:10px;border:1px solid ' +
          (stale ? 'var(--amber)' : 'var(--line2)') + ';background:' + (stale ? 'var(--amber-soft)' : 'var(--panel2)') + ';color:' + (stale ? 'var(--amber)' : 'var(--fg2)') + ';',
        waitTitle: wdSel === null ? '' : wdSel === 0 ? __('Waiting for a reply from {0}', [((U[sel.allocated_to] || {}).name || '')]) : __('{0} days without a reply from {1}', [wdSel, ((U[sel.allocated_to] || {}).name || '')]),
        waitBody: stale ? __('You sent the last message in the conversation. The task has exceeded the stale limit ({0} days).', [A.STALE_DAYS]) : __('You sent the last message — the ball is in their court.'),
        waitBtn: 'height:30px;padding:0 13px;border:0;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;flex:0 0 auto;background:' +
          (stale ? 'var(--amber)' : 'var(--fg)') + ';color:' + (stale ? 'var(--on-accent)' : 'var(--bg)') + ';',

        isSnoozed: !!sel.snooze_until,
        snoozeText: sel.snooze_rule
          ? __('On hold until the status of {0} changes — returns automatically on the first change', [sel.reference_name])
          : __('Snoozed until {0}', [String(sel.snooze_until).slice(0, 16)]),

        partiesLabel: ((U[sel.assigned_by] || {}).name || sel.assigned_by) + ((window.TT_DIR || 'ltr') === 'rtl' ? ' ← ' : ' → ') + ((U[sel.allocated_to] || {}).name || sel.allocated_to),
        fromAvatarSm: this.ava(sel.assigned_by, 21),
        toAvatarSm: this.ava(sel.allocated_to, 21),
        hasDocActions: !locked && acts.length > 0, docBusy: s.docBusy,
        docActions: acts.map((a) => ({
          label: a.label, iconRef: a.tone === 'red' ? '#i-x' : a.tone === 'amber' ? '#i-moon' : '#i-check',
          style: 'height:30px;padding:0 13px;display:flex;align-items:center;gap:7px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;border:1px solid ' +
            (a.tone === 'green' ? 'var(--green)' : a.tone === 'red' ? 'var(--red)' : 'var(--amber)') +
            ';background:' + (a.tone === 'green' ? 'var(--green-soft)' : a.tone === 'red' ? 'var(--red-soft)' : 'var(--amber-soft)') +
            ';color:' + (a.tone === 'green' ? 'var(--green)' : a.tone === 'red' ? 'var(--red)' : 'var(--amber)') + ';',
          onDo: () => this.runDoc(a.id),
        })),

        hasChecklist: showCk, noChecklist: !showCk && canAddCheck, canAddCheck,
        hasTemplateOptions: (s.templates || []).some((t) => t.enabled !== false),
        templateOptions: (s.templates || []).filter((t) => t.enabled !== false).map((t) => ({ id: t.id, label: t.label })),
        onApplyTemplate: (e) => { const v = e.target.value; if (v) { this.applyTemplateToSel(v); e.target.value = ''; } },
        checkCount: ckDone + '/' + ck.length,
        checkBar: 'height:100%;width:' + (ck.length ? Math.round((ckDone / ck.length) * 100) : 0) + '%;background:var(--green);transition:width .25s var(--ease);',
        checklist: ck.map((c) => ({
          label: c.label, done: c.done ? '1' : '0',
          style: 'display:flex;align-items:center;gap:10px;padding:6px 4px;background:transparent;border:0;border-radius:7px;cursor:pointer;text-align:start;width:100%;',
          box: 'width:17px;height:17px;flex:0 0 17px;display:grid;place-items:center;border-radius:5px;border:1.5px solid ' +
            (c.done ? 'var(--green)' : 'var(--line2)') + ';background:' + (c.done ? 'var(--green)' : 'transparent') + ';color:var(--on-accent);',
          tick: 'width:11px;height:11px;opacity:' + (c.done ? '1' : '0') + ';',
          text: 'font-size:12px;line-height:1.7;color:' + (c.done ? 'var(--fg3)' : 'var(--fg)') + ';' + (c.done ? 'text-decoration:line-through;' : ''),
          onToggle: () => this.toggleCheck(c.id),
          onRemove: () => this.removeCheck(c.id),
        })),
      };
    }

    /* ---------- today plan ---------- */
    const dayRows = s.day.map((t, i) => {
      const overdue = t.date < A.TODAY;
      const chips = [];
      chips.push(this.chip(overdue ? __('Overdue · {0}', [t.date.slice(8, 10) + '/' + t.date.slice(5, 7)]) : t.date === A.TODAY ? __('Due today') : __('Tomorrow'),
        overdue ? 'var(--red)' : t.date === A.TODAY ? 'var(--amber)' : 'var(--fg2)',
        overdue ? 'var(--red-soft)' : t.date === A.TODAY ? 'var(--amber-soft)' : 'var(--sunk)'));
      if (t.reference_name) chips.push(this.chip(t.reference_name, 'var(--fg2)', 'var(--sunk)'));
      if ((t.custom_checklist || []).length) chips.push(this.chip(__('{0}/{1} steps', [t.custom_checklist.filter((c) => c.done).length, t.custom_checklist.length]), 'var(--fg2)', 'var(--sunk)'));
      chips.push(this.chip(((U[t.assigned_by] || {}).name || t.assigned_by), 'var(--fg2)', 'var(--sunk)'));
      return {
        subject: t.subject, chips,
        prioBar: 'width:3px;align-self:stretch;border-radius:3px;flex:0 0 3px;background:' + this.prioColor(t.priority) + ';',
        rowStyle: 'display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:11px;border:1px solid var(--line2);background:var(--panel2);',
        onOpen: () => { this.setState({ screen: 'mail', folder: 'inbox', pane: 'detail', mobileScreen: 'detail' }); this.open(t.name); },
        onUp: async () => this.setState({ day: await this.api.reorderDay(t.name, -1) }),
        onDown: async () => this.setState({ day: await this.api.reorderDay(t.name, 1) }),
        onDone: async () => { await this.complete(t.name); this.loadDay(); },
        onDrop: async () => { this.setState({ day: await this.api.dropFromDay(t.name) }); this.toast(__('Removed from today\'s plan')); },
      };
    });

    const notifList = Array.isArray(s.notifs) ? s.notifs : [];
    const notifUnread = notifList.filter((n) => !n.read).length;

    const now = new Date();
    /* completed tasks: comment-only composer */
    const selLocked = !!(d && d.locked), cTab = selLocked ? 'comment' : s.tab;
    return {
      ...this.wfVals(),
      ...this.filePvVals(),
      ...this.pplVals(),
      loading: s.loading, skeletons: [1, 2, 3, 4, 5, 6],
      uiDir: window.TT_DIR || 'ltr', isDesktop, isMobile: !isDesktop, mList: !isDesktop && s.mobileScreen === 'list', mDetail: !isDesktop && s.mobileScreen === 'detail',
      folders, labels, quickFilters, cards, d, hasDetail: !!d, noDetail: !d && !s.loading,
      narrow: s.narrow,
      screenDay: s.screen === 'day', screenStats: s.screen === 'stats',
      ...this.templateVals(s, isDesktop),
      mailMobile: false,
      showList: s.screen === 'mail' && (!(s.narrow || !isDesktop) || s.pane === 'list'),
      showDetail: s.screen === 'mail' && (!(s.narrow || !isDesktop) || s.pane === 'detail'),
      /* unified details header (tasks and required actions) */
      detailHeadStyle: 'flex:0 0 auto;padding:' + (isDesktop ? '14px 20px 12px' : '10px 12px') + ';border-bottom:1px solid var(--line);min-width:0;',
      wfHeadBarStyle: 'flex:0 0 auto;padding:' + (isDesktop ? '13px 18px 12px' : '10px 12px') + ';border-bottom:1px solid var(--line);min-width:0;',
      titleSize: isDesktop ? '18px' : '16px',
      headActionsInline: isDesktop && !selLocked, headActionsRow: !isDesktop && !selLocked,
      headerStyle: 'flex:0 0 auto;height:' + (isDesktop ? '54px' : '52px') + ';display:flex;align-items:center;gap:' + (isDesktop ? '14px' : '6px') +
        ';padding:0 ' + (isDesktop ? '16px' : '8px') + ';background:var(--panel);border-bottom:1px solid var(--line);min-width:0;',
      brandStyle: isDesktop ? 'display:flex;align-items:center;gap:8px;flex:0 0 auto;' : 'display:none;',
      darkBtnDisplay: isDesktop ? 'display:grid;' : 'display:none;',
      /* sidebar: fixed on desktop, sliding drawer on mobile */
      showNav: isDesktop || !!s.navOpen,
      navDrawer: !isDesktop && !!s.navOpen,
      navCollapsed: navCol ? '1' : '0',
      navToggleLabel: navCol ? __('Expand sidebar') : __('Collapse sidebar'),
      navExpanded: navCol ? 'false' : 'true',
      navToggleDisplay: isDesktop ? '' : 'display:none;',
      navWrapStyle: isDesktop ? '' : 'display:contents;',
      /* Frappe: chevron-left while expanded, chevron-right while collapsed (swapped in RTL) */
      navChevRef: (navCol ? 1 : 0) ^ (window.TT_DIR === 'rtl' ? 1 : 0) ? '#i-chev-right' : '#i-chev-left',
      stopClick: (e) => e.stopPropagation(),
      toggleNav: () => this.setNavCollapsed(!navCol),
      newTaskTip: navCol ? __('New ToDo') : '',
      navStyle: isDesktop
        ? 'flex:0 0 auto;width:' + (navCol ? 'var(--nav-w-collapsed)' : 'var(--nav-w)') + ';overflow-x:hidden;'
        : 'position:fixed;top:0;bottom:0;inset-inline-start:0;z-index:45;width:min(280px,86vw);box-shadow:0 0 40px rgba(0,0,0,.22);animation:slidein .2s var(--ease);',
      openNav: () => this.setState({ navOpen: true }),
      closeNav: () => this.setState({ navOpen: false }),
      sidebarToggle: () => (isDesktop ? this.setNavCollapsed(!navCol) : this.setState({ navOpen: !s.navOpen })),
      sidebarToggleLabel: isDesktop ? (navCol ? __('Expand sidebar') : __('Collapse sidebar')) : (s.navOpen ? __('Close menu') : __('Open menu')),
      sidebarExpanded: (isDesktop ? !navCol : !!s.navOpen) ? 'true' : 'false',
      sidebarToggleIcon: isDesktop ? '#i-sidebar' : '#i-menu',
      sidebarResizeLabel: __('Resize sidebar (double-click to reset)'),
      onNavClick: (e) => {
        if (isDesktop) return;
        const t = e.target;
        if (t && t.closest && t.closest('button') && !t.closest('[data-keep-nav]')) this.setState({ navOpen: false });
      },

      screens: (() => { const onScreen = (id) => s.screen === id && (id !== 'mail' || (s.folder === 'inbox' && !s.label && !s.activeView)); return [
        { id: 'mail', label: __('Inbox'), icon: 'inbox', badge: s.counts.inboxUnread || '' },
        { id: 'day', label: __('Today\'s plan'), icon: 'sunrise', badge: dayRows.length || '' },
        { id: 'stats', label: __('Analytics'), icon: 'chart', badge: '' },
        { id: 'templates', label: __('Task templates'), icon: 'template', badge: '' },
      ].map((x) => ({
        label: x.label, iconRef: iref(x.icon), badge: x.badge, on: onScreen(x.id) ? '1' : '0',
        tip: navCol ? x.label + (x.badge ? ' (' + x.badge + ')' : '') : '',
        style: navBtn(onScreen(x.id)),
        badgeStyle: this.countPill(x.badge, x.id === 'mail' ? 'primary' : ''),
        onPick: () => (x.id === 'mail'
          ? this.setState({ screen: 'mail', folder: 'inbox', label: null, activeView: null, search: '', searchInput: '', loading: true, sel: null, pane: 'list', mobileScreen: 'list', notifsOpen: false }, () => this.load())
          : this.goScreen(x.id)),
      })); })(),

      savedViews: s.savedViews.map((v) => ({
        label: v.label, query: v.query, tip: navCol ? v.label : v.query, count: s.viewCounts[v.id] == null ? '' : s.viewCounts[v.id], iconRef: '#i-filter',
        rowStyle: 'display:flex;align-items:center;gap:2px;flex:0 0 28px;border-radius:8px;background:' + (s.activeView === v.id ? 'var(--sunk)' : 'transparent') + ';',
        style: 'flex:1;min-width:0;display:flex;align-items:center;gap:9px;height:28px;padding:0 7px;border:0;background:transparent;border-radius:8px;cursor:pointer;font-size:13px;color:' + (s.activeView === v.id ? 'var(--primary)' : 'var(--fg2)') + ';font-weight:' + (s.activeView === v.id ? '600' : '400') + ';',
        delStyle: 'width:22px;height:22px;display:grid;place-items:center;background:transparent;border:0;cursor:pointer;color:var(--fg3);flex:0 0 auto;',
        onPick: () => this.applyView(v),
        onDelete: (ev) => { ev.stopPropagation(); this.deleteView(v); },
      })),
      savingView: s.savingView && s.saveViewWhere !== 'strip', saveViewName: s.saveViewName,
      savingViewStrip: s.savingView && s.saveViewWhere === 'strip',
      saveViewExpanded: s.savingView && s.saveViewWhere !== 'strip' ? 'true' : 'false',
      canSaveView: !s.activeView,
      /* inline validation — shown only after a save attempt */
      svNameErr: s.saveViewErr && s.saveViewErr.name ? '1' : '0', svNameErrOn: !!(s.saveViewErr && s.saveViewErr.name), svNameErrText: __('Enter a name for this filter'),
      savingBusyFlag: !!s.savingBusy,
      /* the "+" toggles the editor; the list toolbar opens the compact strip */
      startSaveView: () => this.setState((st) => (st.savingView && st.saveViewWhere !== 'strip'
        ? { savingView: false, saveViewErr: null }
        : { savingView: true, saveViewName: '', saveViewErr: null, saveViewWhere: 'nav' }),
        () => { if (this.state.savingView && this._fx && this._fx.svName) this._fx.svName.focus(); }),
      startSaveViewHere: () => this.setState({ savingView: true, saveViewName: '', saveViewErr: null, saveViewWhere: 'strip' }),
      cancelSaveView: () => this.setState({ savingView: false, saveViewErr: null }),
      /* the name is a Frappe Data control (both the nav editor and the list-toolbar strip) */
      svFx: this.svFx(),
      onSaveViewKey: (e) => {
        if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); this.confirmSaveView(); }
        else if (e.key === 'Escape') { e.stopPropagation(); this.setState({ savingView: false, saveViewErr: null }); }
      },
      confirmSaveView: this.confirmSaveView,

      sortLabel: (A.SORTS.find((x) => x.id === s.sort) || {}).label,
      cycleSort: () => {
        const i = A.SORTS.findIndex((x) => x.id === s.sort);
        this.setState({ sort: A.SORTS[(i + 1) % A.SORTS.length].id, loading: true }, () => this.load(s.sel));
      },
      hintsOpen: s.hintsOpen,
      /* header search works on the current screen: documents in Required actions, tasks elsewhere */
      searchPlaceholder: s.screen === 'wf' ? __('Search documents…') : __('Search tasks…'),
      headerSearchValue: s.screen === 'wf' ? (s.wfSearch || '') : s.searchInput,
      headerHasQuery: s.screen === 'wf' ? !!s.wfSearch : !!s.searchInput,
      clearHeaderSearch: () => {
        if (s.screen === 'wf') { this.setState({ wfSearch: '' }); return; }
        this.setState({ searchInput: '', search: '', activeView: null, folder: (s.folder === '__query' || s.folder === 'all') ? 'inbox' : s.folder, hintsOpen: false, loading: true }, () => this.load());
      },
      hasQuery: !!s.searchInput,
      clearSearch: () => this.setState({ searchInput: '', search: '', activeView: null, folder: (s.folder === '__query' || s.folder === 'all') ? 'inbox' : s.folder, hintsOpen: false, loading: true }, () => this.load()),
      onSearchFocus: () => { if (s.screen === 'mail') this.setState({ hintsOpen: true }); },
      toggleHints: () => this.setState({ hintsOpen: !s.hintsOpen }),
      hintsBtnStyle: s.screen === 'wf' ? 'display:none;' : 'flex:0 0 auto;height:24px;padding:0 8px;display:flex;align-items:center;gap:4px;border-radius:99px;cursor:pointer;font-size:11px;font-family:inherit;'
        + (s.hintsOpen
          ? 'background:var(--primary);border:1px solid var(--primary);color:var(--on-accent);'
          : 'background:var(--panel);border:1px solid var(--line2);color:var(--fg2);'),
      ...this.queryBuilderVals(allLabels),

      notifsOpen: s.notifsOpen, notifUnread: notifUnread, notifsEmpty: notifList.length === 0,
      bellLabel: __('Notifications — {0} unread', [notifUnread]),
      bellStyle: 'position:relative;width:32px;height:32px;display:grid;place-items:center;background:' + (s.notifsOpen ? 'var(--sunk)' : 'transparent') + ';border:1px solid ' + (s.notifsOpen ? 'var(--line2)' : 'transparent') + ';border-radius:8px;cursor:pointer;color:var(--fg2);',
      bellBadge: notifUnread ? 'position:absolute;top:1px;inset-inline-end:2px;min-width:15px;height:15px;padding:0 3px;display:grid;place-items:center;background:var(--red);color:var(--on-accent);border-radius:9px;font-size:10px;font-family:var(--font);font-variant-numeric:tabular-nums;' : 'display:none;',
      toggleNotifs: () => this.setState({ notifsOpen: !s.notifsOpen, themeMenu: false }),
      closeNotifs: () => this.setState({ notifsOpen: false }),
      markAllRead: () => { this.api.markAllNotifsRead(); this.loadAux();
    this.loadTemplates(); },
      notifs: notifList.map((n) => {
        const k = A.NOTIF_KINDS[n.kind] || { icon: 'bell', tone: 'fg2' };
        const c = 'var(--' + k.tone + ')';
        return {
          who: n.user ? (U[n.user] || {}).name || n.user : k.label,
          text: n.text, subject: n.subject || '', time: this.fmtTime(n.ts), iconRef: iref(k.icon),
          style: 'width:100%;display:flex;align-items:flex-start;gap:11px;padding:11px 14px;background:' + (n.read ? 'transparent' : 'var(--panel2)') + ';border:0;border-bottom:1px solid var(--line);cursor:pointer;',
          iconWrap: 'width:26px;height:26px;flex:0 0 26px;display:grid;place-items:center;border-radius:8px;color:' + c + ';background:color-mix(in oklab, ' + c + ' 14%, transparent);',
          subjectStyle: n.subject ? 'display:block;font-size:11px;color:var(--fg3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' : 'display:none;',
          dot: n.read ? 'display:none;' : 'width:7px;height:7px;flex:0 0 7px;margin-top:6px;border-radius:50%;background:var(--primary);',
          onOpen: () => {
            this.setState({ notifsOpen: false, notifs: notifList.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
            Promise.resolve(this.api.markNotifRead(n.id)).catch(() => {}).then(() => this.loadAux());
            this.openNotifTarget(n);
          },
        };
      }),

      snoozeOpen: !!s.snoozeFor,
      closeSnooze: this.closeSnooze, openSnooze: () => this.openSnooze(),
      saveSnooze: this.saveSnooze,
      cancelSnooze: this.cancelSnooze, sendReminder: this.sendReminder,

      newCheckItem: s.newCheck,
      onNewCheckItem: (e) => this.setState({ newCheck: e.target.value }),
      onCheckKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addCheck(); } },
      addCheckItem: this.addCheck,
      startChecklist: () => { if (this.guardAddCheck(this.selTask())) this.setState({ forceChecklist: s.sel }); },

      automationOpen: !!s.automation,
      openAutomation: () => { this.setState({ automation: 'rules' }); this.loadAutomation(); },
      closeAutomation: () => this.setState({ automation: null }),
      autoRules: s.automation === 'rules', autoRecurring: s.automation === 'recurring',
      autoTabs: [['rules', __('Rules')], ['recurring', __('Recurring tasks')]].map(([id, label]) => ({
        label, style: 'height:30px;padding:0 14px;border-radius:8px 8px 0 0;cursor:pointer;font-size:12px;border:1px solid ' +
          (s.automation === id ? 'var(--line)' : 'transparent') + ';border-bottom:0;background:' + (s.automation === id ? 'var(--panel2)' : 'transparent') +
          ';color:' + (s.automation === id ? 'var(--fg)' : 'var(--fg3)') + ';font-weight:' + (s.automation === id ? '600' : '400') + ';',
        onPick: () => this.setState({ automation: id }),
      })),
      ruleCanAdd: !!s.canManageRules && !s.ruleForm, ruleReadOnly: !s.canManageRules,
      ruleFormOpen: !!s.ruleForm, rulesEmpty: !s.rules.length && !s.ruleForm,
      ruleFormTitle: s.ruleForm && s.ruleForm.id ? __('Edit rule') : __('New rule'),
      newRule: () => this.openRuleForm(null), closeRuleForm: () => this.setState({ ruleForm: null }), saveRuleForm: this.saveRuleForm,
      autoSaveLabel: s.autoBusy === 'rule' || s.autoBusy === 'rec' ? __('Saving…') : __('Save'),
      /* Frappe controls of the rule / recurring-task forms (automation.js autoFx) */
      autoFx: this.autoFx(),
      /* the conditions test the reference document: shown once its DocType is picked */
      ruleCondStyle: s.ruleForm && s.ruleForm.reference_doctype ? '' : 'display:none;',
      rules: s.rules.map((r) => ({
        label: r.label, when: this.ruleWhenText(r), thenText: this.ruleThenText(r), hits: __('{0} times', [r.hits]),
        locked: !s.canManageRules, canEdit: !!s.canManageRules,
        onEdit: () => this.openRuleForm(r), onDelete: () => this.deleteRuleItem(r),
        delTitle: __('Delete'),
        delStyle: this.autoDelStyle('rule:' + r.id),
        aria: r.active ? __('Disable rule {0}', [r.label]) : __('Enable rule {0}', [r.label]),
        card: 'display:flex;align-items:flex-start;gap:13px;padding:13px 14px;border-radius:11px;border:1px solid ' + (r.active ? 'var(--line2)' : 'var(--line)') +
          ';background:' + (r.active ? 'var(--panel2)' : 'transparent') + ';opacity:' + (r.active ? '1' : '.58') + ';',
        switch: 'position:relative;width:38px;height:22px;flex:0 0 38px;margin-top:1px;border:0;border-radius:99px;cursor:pointer;background:' + (r.active ? 'var(--primary)' : 'var(--line2)') + ';',
        knob: 'position:absolute;top:3px;inset-inline-start:' + (r.active ? '19px' : '3px') + ';width:16px;height:16px;border-radius:50%;background:#fff;transition:inset-inline-start .16s var(--ease);',
        onToggle: () => this.toggleRuleItem(r),
      })),
      recFormOpen: !!s.recForm, recurringEmpty: !s.recurring.length && !s.recForm,
      recFormTitle: s.recForm && s.recForm.id ? __('Edit recurring task') : __('New recurring task'),
      newRecurring: () => this.openRecForm(null), closeRecForm: () => this.setState({ recForm: null }), saveRecForm: this.saveRecForm,
      rcf: (() => {
        const f = s.recForm || {};
        return {
          roleMuted: f.to ? 'opacity:.55;' : '',
          hint: !f.to
            ? __('On each run a new task is created for every enabled user with this role, due the same day.')
            : __('On each run a new task is created for the assignee, due the same day.'),
        };
      })(),
      recurring: s.recurring.map((r) => {
        const tpl = (s.templates || []).find((t) => t.id === r.template) || {};
        return {
          label: r.label, busy: s.autoBusy === r.id,
          onEdit: () => this.openRecForm(r), onDelete: () => this.deleteRecItem(r),
          delTitle: __('Delete'),
          delStyle: this.autoDelStyle('rec:' + r.id),
          aria: r.active ? __('Disable recurrence {0}', [r.label]) : __('Enable recurrence {0}', [r.label]),
          meta: __('{0} · next {1}', [this.freqName(r.frequency), this.fmtUserDate ? this.fmtUserDate(r.next) : r.next]),
          targetIcon: !r.to ? '#i-users' : '#i-user-plus',
          target: !r.to ? __('Role: {0}', [__(r.role)]) : __('To: {0}', [(U[r.to] || {}).name || r.to]),
          targetTitle: !r.to ? __('One task for every enabled user with this role') : '',
          steps: __('{0} checklist steps · ran {1} times', [(tpl.checklist || []).length, r.runs]),
          card: 'display:flex;align-items:flex-start;gap:13px;padding:13px 14px;border-radius:11px;border:1px solid ' + (r.active ? 'var(--line2)' : 'var(--line)') +
            ';background:' + (r.active ? 'var(--panel2)' : 'transparent') + ';opacity:' + (r.active ? '1' : '.58') + ';',
          switch: 'position:relative;width:38px;height:22px;flex:0 0 38px;margin-top:1px;border:0;border-radius:99px;cursor:pointer;background:' + (r.active ? 'var(--primary)' : 'var(--line2)') + ';',
          knob: 'position:absolute;top:3px;inset-inline-start:' + (r.active ? '19px' : '3px') + ';width:16px;height:16px;border-radius:50%;background:#fff;transition:inset-inline-start .16s var(--ease);',
          onToggle: () => this.toggleRecItem(r),
          onRun: () => this.runRecurring(r.id),
        };
      }),

      dayRows, dayEmpty: !dayRows.length,
      dayHeadline: dayRows.length
        ? __('{0} tasks overdue or due today — reorder them in the order you will work on them', [dayRows.length])
        : __('No tasks due'),

      ...this.statsVals(),
      backToList: () => this.setState({ pane: 'list' }),
      listPaneStyle: (s.narrow ? 'flex:1 1 auto;' : 'flex:0 0 410px;') +
        'min-width:0;display:flex;flex-direction:column;min-height:0;background:' + (isDesktop ? 'var(--panel2);border-inline-start:1px solid var(--line);' : 'var(--panel);') +
        (isDesktop && !s.narrow ? 'border-inline-end:1px solid var(--line2);' : ''),
      detailPaneStyle: 'flex:1;min-width:0;display:flex;flex-direction:column;background:var(--panel);',
      listCount: __('{0} tasks', [s.tasks.length]), isEmpty: !s.loading && !s.tasks.length,
      emptyZero: !s.search && s.folder === 'inbox' && s.quick === 'all' ? '1' : '0',
      emptyTitle: s.search ? __('No results for “{0}”', [s.search]) : s.folder === 'inbox' ? __('Inbox zero — nice work!') : __('No tasks here'),
      emptyBody: s.search
        ? (s.folder === 'all' ? __('No task you take part in matches this search.') : __('Nothing matches in “{0}”.', [(A.FOLDERS.find((f) => f.id === s.folder) || {}).label || '']))
        : s.folder === 'inbox' ? __('No open tasks are assigned to you right now. Enjoy the calm, or plan what comes next.') : __('Try another folder or clear the quick filter.'),
      emptySearchAll: !!s.search && s.folder !== 'all',
      emptyNoSearchAll: !(s.search && s.folder !== 'all'),
      searchAllTasks: () => this.setState({ folder: 'all', activeView: null, label: null, loading: true }, () => this.load()),
      searchInput: s.searchInput,
      unreadCount: s.counts.inboxUnread || 0, meTitle: (U[ME] || {}).name + ' — ' + (U[ME] || {}).title,
      ...this.meAvatarVals(U[ME] || {}),
      ...this.accountVals(),
      onSearch: (e) => {
        const v = e.target.value;
        if (this.state.screen === 'wf') { this.setState({ wfSearch: v, wfSel: null, wfPane: 'list' }); return; }
        /* from another screen (today/analytics/templates): switch to the task list to show search results */
        if (this.state.screen !== 'mail') this.setState({ screen: 'mail', folder: 'inbox', label: null, activeView: null, pane: 'list', mobileScreen: 'list' });
        this.setState({ searchInput: v });
        clearTimeout(this.sd);
        this.sd = setTimeout(() => this.setState({ search: v, activeView: null, loading: true }, () => this.load()), 250);
      },
      densityNormal: !comfy, densityComfy: comfy,
      densities: [['normal', __('Compact view'), 'density-sm'], ['comfortable', __('Detailed view'), 'density-lg']].map(([id, title, icon]) => ({
        title, iconRef: iref(icon),
        style: 'width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:6px;cursor:pointer;background:' + (s.density === id ? 'var(--panel)' : 'transparent') + ';color:' + (s.density === id ? 'var(--fg)' : 'var(--fg3)') + ';',
        onPick: () => { try { localStorage.setItem('todobox_density', id); } catch (e) { } this.setState({ density: id }, () => this.applyChrome()); },
      })),
      darkIconRef: s.dark ? '#i-sun' : '#i-moon',
      toggleDark: this.flipDark,
      ...this.themeVals(isDesktop),
      mobileNav: [['mail', 'inbox', __('Inbox')], ['wf', 'bolt', __('Actions')], ['__new', 'plus', ''], ['day', 'sunrise', __('My day')], ['stats', 'chart', __('Analytics')]].map(([id, icon, label]) => {
        const active = id === 'mail' ? s.screen === 'mail' && s.folder !== 'waiting' : id === 'waiting' ? s.screen === 'mail' && s.folder === 'waiting' : s.screen === id;
        return {
          label, iconRef: iref(icon), aria: label || __('New ToDo'),
          iconStyle: id === '__new' ? 'width:22px;height:22px;' : 'width:19px;height:19px;',
          style: id === '__new'
            ? 'width:54px;height:54px;display:flex;align-items:center;justify-content:center;background:var(--primary);color:var(--primary-ink);border:0;border-radius:16px;cursor:pointer;box-shadow:0 6px 18px -6px color-mix(in srgb,var(--primary) 70%,transparent),inset 0 1px 0 rgba(255,255,255,.14);'
            : 'min-width:58px;height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:transparent;border:0;cursor:pointer;color:' + (active ? 'var(--primary)' : 'var(--fg3)') + ';',
          onPick: () => {
            if (id === '__new') { this.openCompose(); return; }
            if (id === 'wf') { this.wfGo('pending'); return; }
            if (id === 'mail' || id === 'waiting') this.setState({ screen: 'mail', folder: id === 'waiting' ? 'waiting' : 'inbox', activeView: null, mobileScreen: 'list', loading: true }, () => this.load());
            else this.goScreen(id);
          },
        };
      }),
      mobileBack: () => this.setState({ mobileScreen: 'list' }),
      mTitle: s.folder === 'all' ? __('All my tasks') : (A.FOLDERS.find((f) => f.id === s.folder) || {}).label || '',
      mSub: __('{0} tasks · swipe right to complete, left to snooze', [s.tasks.length]),
      /* detail interactions */
      ccOpen: s.ccOpen, toggleCC: () => this.setState({ ccOpen: !s.ccOpen }),
      moreMenuOpen: !!s.moreMenu,
      moreBtnStyle: 'width:32px;height:32px;display:grid;place-items:center;background:' + (s.moreMenu ? 'var(--sunk)' : 'transparent') +
        ';border:1px solid ' + (s.moreMenu ? 'var(--line)' : 'var(--line2)') + ';border-radius:8px;cursor:pointer;color:var(--fg2);',
      toggleMoreMenu: () => this.setState((st) => ({ moreMenu: !st.moreMenu })),
      moreItems: [
        ...((() => {
          const t = s.sel ? s.tasks.find((x) => x.name === s.sel) : null;
          return t && t.reference_name
            ? [{ label: __('Open reference'), iconRef: '#i-link', onDo: () => { this.setState({ moreMenu: false }); this.openRef(t.reference_type, t.reference_name); } }]
            : [];
        })()),
        { label: __('Print'), iconRef: '#i-printer', onDo: () => { this.setState({ moreMenu: false }); this.printDoc('ToDo', s.sel); } },
        { label: __('Copy task link'), iconRef: '#i-link', onDo: () => { this.setState({ moreMenu: false }); this.copyTaskLink(s.sel); } },
      ],
      expandEvents: () => this.setState({ showEvents: true }),
      completeSelected: () => s.sel && this.complete(s.sel),
      snoozeSelected: () => s.sel && this.snooze(s.sel),
      openForward: this.openForward, openCompose: this.openCompose,
      onRenameTitle: (e) => {
        const t = this.selTask();
        if (!t || !this.canManage(t)) return;
        const v = e.target.textContent.trim();
        if (!v || v === t.subject) return;
        this.setState((st) => ({ tasks: st.tasks.map((x) => (x.name === t.name ? { ...x, subject: v } : x)) }));
        this.api.updateTodo(t.name, { subject: v });
        this.toast(__('Title updated'));
      },
      notImpl: (e) => { if (e && e.preventDefault) e.preventDefault(); this.toast(__('Opens the document in ERPNext')); },

      /* composer */
      composerWrap: 'flex:0 0 auto;padding:12px 20px 14px;border-top:1px solid var(--line);background:var(--panel);',
      composerBox: 'width:100%;height:' + (s.composerOpen ? '104px' : '56px') + ';padding:11px 13px;background:var(--panel);border:1px solid ' +
        (cTab === 'comment' ? 'var(--amber)' : 'var(--line2)') +
        ';border-radius:10px;outline:none;font-size:13px;line-height:1.9;resize:none;transition:height .18s var(--ease);',
      composerPlaceholder: cTab === 'reply' ? __('Write a reply… type @ to mention a colleague') : __('Internal comment — not visible to external recipients'),
      composerHint: selLocked ? __('This task is completed — you can only add comments and attachments') : cTab === 'reply' ? __('r to reply · k to comment') : __('Visible to the internal team only'),
      composerTabs: [
        ['reply', __('Reply'), '#i-reply', selLocked ? __('This task is completed — you can only add comments and attachments') : __('Reply visible to everyone (r)')],
        ['comment', __('Comment'), '#i-chat', __('Comment for the internal team only (k)')],
      ].map(([id, label, iconRef, title]) => {
        const on = cTab === id;
        const off = selLocked && id === 'reply';
        const tone = id === 'reply' ? 'var(--primary)' : 'var(--amber)';
        return {
          label, iconRef, title, disabled: off,
          style: 'height:26px;padding:0 11px;display:flex;align-items:center;gap:6px;border:0;border-radius:7px;cursor:' + (off ? 'not-allowed;opacity:.45' : 'pointer') + ';font-size:12px;background:' +
            (on ? 'var(--panel)' : 'transparent') + ';color:' + (on ? tone : 'var(--fg3)') + ';font-weight:' + (on ? '600' : '400') +
            (on ? ';box-shadow:0 1px 3px rgba(0,0,0,.1)' : '') + ';',
          onPick: () => (off ? this.guardLocked(this.selTask()) : this.setState({ tab: id, composerOpen: true })),
        };
      }),
      draft: s.draft, ...this.mentionVals(),
      onComposerFocus: () => this.setState({ composerOpen: true }),
      sendLabel: s.sending ? __('Sending…') : cTab === 'reply' ? __('Send reply') : __('Add comment'),
      sending: !!s.sending, sendBtnStyle: s.sending ? 'cursor:progress;opacity:.6;' : 'cursor:pointer;',
      sendComposer: () => this.send(false), sendAndComplete: () => this.send(true), canComplete: !selLocked, showKeyHint: isDesktop,
      composerKeyHint: __('Enter to send · Shift+Enter for new line'),
      fileInputRef: this.fileInput,
      pickAttachment: this.attachToTodo,
      onAttachFile: this.onTodoLocalFiles,

      /* bulk */
      filtersOpen: s.filtersOpen === true,
      toggleFilters: () => this.setState((st) => ({ filtersOpen: st.filtersOpen !== true })),
      filtersChevron: 'width:13px;height:13px;color:var(--fg3);transition:transform .18s var(--ease);transform:rotate(' + (s.filtersOpen === true ? '0deg' : '-90deg') + ');',
      hasChecked: s.checked.length > 0, checkedLabel: __('Selected: {0}', [s.checked.length]),
      clearChecked: () => this.setState({ checked: [] }),
      bulkDone: () => { s.checked.forEach((n) => this.complete(n)); this.setState({ checked: [] }); },
      bulkSnooze: () => { this.openSnooze(s.checked.slice()); this.setState({ checked: [] }); },

      /* compose panel */
      composeOpen: !!s.compose,
      composeSubject: s.compose ? s.compose.subject : '', composeBody: s.compose ? s.compose.body : '',
      onComposeSubject: (e) => this.setState({ compose: { ...s.compose, subject: e.target.value } }),
      onComposeBody: (e) => this.setState({ compose: { ...s.compose, body: e.target.value } }),
      composeCCOpen: s.composeCCOpen, toggleComposeCC: () => this.setState({ composeCCOpen: !s.composeCCOpen }),
      ccButtonLabel: s.composeCCOpen ? '− ' + __('Hide CC') : '+ ' + __('CC'),
      closeCompose: this.closeCompose, submitCompose: this.submitCompose,
      composeNotice: s.compose && s.compose.to.length > 1 ? __('{0} tasks will be created — one per recipient', [s.compose.to.length]) : '',
      /* "To": selected users + a few server suggestions; full search via the picker */
      peopleShown: !s.compose ? [] : [...new Set([...s.compose.to, ...(s.composeSuggest || []).map((u) => u.id)])]
        .filter((k) => U[k]).slice(0, Math.max(5, s.compose.to.length)).map((k) => this.personChip(k, U, s)),
      hasMorePeople: !!s.compose,
      morePeopleLabel: __('Search people'),
      morePeopleTitle: __('Search all users'),
      peoplePickerOpen: !!(s.ppl && s.ppl.target !== 'fwd'),
      templates: A.TASK_TEMPLATES.map((t) => {
        const on = s.compose && s.compose.template === t.id;
        return {
          label: t.label, title: __('{0} — {1} steps', [t.subject, (t.checklist || []).length]),
          style: 'height:26px;padding:0 10px;border-radius:99px;cursor:pointer;font-size:11px;border:1px solid ' +
            (on ? 'var(--primary)' : 'var(--line)') + ';background:' + (on ? 'var(--primary-soft)' : 'var(--panel2)') + ';color:' + (on ? 'var(--primary)' : 'var(--fg2)') + ';',
          onPick: () => this.setState({ compose: { ...(s.compose || { to: [], cc: [], date: A.TODAY, ref: null, labels: [], files: [] }), template: t.id, subject: t.subject, body: t.body, priority: t.priority, checklist: t.checklist || [] } }),
        };
      }),
      composeHasChecklist: !!(s.compose && s.compose.checklist && s.compose.checklist.length),
      composeNoChecklist: !(s.compose && s.compose.checklist && s.compose.checklist.length),
      composeChecklistTitle: s.compose && s.compose.template ? __('Checklist — from template') : __('Checklist'),
      composeChecklist: (s.compose && s.compose.checklist ? s.compose.checklist : []).map((c, i) => ({
        label: c,
        onEdit: (e) => this.editComposeCheck(i, e.target.value),
        onDel: () => this.delComposeCheck(i),
      })),
      composeChecklistCount: __('{0} steps', [(s.compose && s.compose.checklist ? s.compose.checklist.length : 0)]),
      composeChecklistOpen: !!s.composeChecklistOpen,
      toggleComposeChecklist: () => this.setState((st) => ({ composeChecklistOpen: !st.composeChecklistOpen })),
      checklistButtonLabel: s.composeChecklistOpen ? '− ' + __('Hide checklist') : '+ ' + __('Checklist'),
      composeTemplateId: (s.compose && s.compose.template) || '',
      composeTemplateRef: this.selectRef([{ id: '', label: __('— None —') }].concat(A.TASK_TEMPLATES.filter((t) => t.enabled !== false || (s.compose && s.compose.template === t.id)).map((t) => ({ id: t.id, label: t.label }))), (s.compose && s.compose.template) || ''),
      templateOptions: A.TASK_TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
      onComposeTemplate: (e) => {
        const t = A.TASK_TEMPLATES.find((x) => x.id === e.target.value);
        this.setState((st) => ({
          compose: t
            ? { ...st.compose, template: t.id, subject: st.compose.subject || t.subject, body: st.compose.body || t.body, checklist: (t.checklist || []).slice() }
            : { ...st.compose, template: null, checklist: [] },
        }));
      },
      composeNewCheck: s.composeNewCheck || '',
      onComposeNewCheck: (e) => this.setState({ composeNewCheck: e.target.value }),
      onComposeCheckKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addComposeCheck(); } },
      composeAddCheck: this.addComposeCheck,
      composeDate: s.compose ? s.compose.date : '',
      onComposeDate: (e) => { const v = e.target.value; if (v) this.setState({ compose: { ...s.compose, date: v } }); },
      composeDateLabel: s.compose && s.compose.date ? s.compose.date.slice(8, 10) + '/' + s.compose.date.slice(5, 7) + '/' + s.compose.date.slice(0, 4) : __('No date'),
      composePickDate: (e) => this.openFrappeDate(e, s.compose && s.compose.date, (v) => this.setState((st) => (st.compose ? { compose: { ...st.compose, date: v } } : {}))),
      richTools: [['bold', 'B', __('Bold'), 'font-weight:700;'], ['italic', 'I', __('Italic'), 'font-style:italic;font-family:serif;'], ['list', '•≡', __('List'), ''], ['code', '</>', __('Code'), 'font-family:var(--font);font-variant-numeric:tabular-nums;font-size:10px;']]
        .map(([k, icon, title, extra]) => ({ icon, title, style: 'min-width:28px;height:28px;padding:0 6px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;cursor:pointer;font-size:12px;color:var(--fg2);' + extra, keep: (e) => { if (e && e.preventDefault) e.preventDefault(); }, onDo: (e) => { if (e && e.preventDefault) e.preventDefault(); this.applyRich(k); } })),
      composeBodyRef: this.composeBodyRef,
      composeFileInputRef: this.composeFileInput,
      onComposeLocalFiles: this.onComposeLocalFiles,
      composeHasFiles: !!(s.compose && s.compose.files && s.compose.files.length),
      composeFiles: ((s.compose && s.compose.files) || []).map((f, i) => ({ label: f.label, title: f.url || f.label, onRemove: () => this.removeComposeFile(i) })),
      composeTags: ((s.compose && s.compose.labels) || []).map((lb) => ({ label: lb, onRemove: () => this.removeComposeTag(lb) })),
      composeTagPickerOpen: !!(s.compose && s.composeTagPicker),
      toggleComposeTagPicker: () => this.setState((st) => ({ composeTagPicker: !st.composeTagPicker })),
      composeTagOptions: !(s.compose && s.composeTagPicker) ? [] : [...new Set([
        ...s.tasks.flatMap((t) => t.labels || []),
        __('Strategic client'), __('Finance'), __('Warehouse'), __('HR'), __('Follow-up'), __('Pricing'), __('Purchasing'), __('Reports'), __('Urgent'), __('Recurring'),
      ])].filter((lb) => !((s.compose && s.compose.labels) || []).includes(lb)).slice(0, 10).map((lb) => ({
        label: lb, onPick: () => this.addComposeTag(lb),
      })),
      composeNewTag: s.composeNewTag || '',
      onComposeNewTag: (e) => this.setState({ composeNewTag: e.target.value }),
      onComposeTagKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addComposeTag(s.composeNewTag); } },
      addComposeTagTyped: () => this.addComposeTag(s.composeNewTag),
      composeMeta: [
        { label: __('Priority: {0}', [(s.compose ? (s.compose.priority === 'High' ? __('High') : s.compose.priority === 'Medium' ? __('Medium') : __('Low')) : '')]), onDo: () => { const o = ['High', 'Medium', 'Low']; const i = o.indexOf(s.compose.priority); this.setState({ compose: { ...s.compose, priority: o[(i + 1) % 3] } }); } },
        { label: s.compose && s.compose.ref ? s.compose.ref.name : __('Link a document'), onDo: () => this.setState({ compose: { ...s.compose, ref: { type: 'Purchase Invoice', name: 'PINV-2026-00404', amount: __('{0} SAR', ['78,900']) } } }) },
        { label: s.compose && s.compose.files && s.compose.files.length ? __('Attachment ({0})', [s.compose.files.length]) : __('Attachment'), onDo: this.attachToCompose },
        { label: __('Recurring task?'), onDo: this.openRecurringFromCompose },
      ].map((m) => ({ ...m, style: 'height:30px;padding:0 12px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;cursor:pointer;font-size:12px;' })),

      /* forward */
      forwardOpen: !!s.forward, closeForward: this.closeForward, submitForward: this.submitForward,
      forwardReason: s.forward ? s.forward.reason : '',
      forwardBusy: !!(s.forward && s.forward.busy), forwardBtnOpacity: s.forward && s.forward.busy ? 'opacity:.6;pointer-events:none;' : '',
      onForwardReason: (e) => this.setState({ forward: { ...s.forward, reason: e.target.value } }),
      forwardModes: [
        { id: 'full', label: __('Full forward'), note: __('My task is cancelled (not counted as completed) and a new task opens for the recipient in the same thread.') },
        { id: 'delegate', label: __('Delegate'), note: __('The task stays assigned to me and a parallel task is created — it appears under “Forwarded” and I track its progress.') },
      ].map((m) => {
        const on = s.forward && s.forward.mode === m.id;
        return {
          ...m,
          style: 'display:flex;align-items:flex-start;gap:11px;padding:12px 14px;border-radius:10px;cursor:pointer;text-align:start;border:1px solid ' +
            (on ? 'var(--primary)' : 'var(--line)') + ';background:' + (on ? 'var(--primary-soft)' : 'var(--panel2)') + ';',
          radio: 'flex:0 0 15px;width:15px;height:15px;margin-top:2px;border-radius:50%;border:5px solid ' + (on ? 'var(--primary)' : 'var(--line2)') + ';background:var(--panel);',
          onPick: () => this.setState({ forward: { ...s.forward, mode: m.id } }),
        };
      }),

      /* command palette */
      cmdkOpen: s.cmdk, cmdq: s.cmdq, closeCmdk: () => this.setState({ cmdk: false }),
      cmdkHint: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '') ? '⌘K' : 'Ctrl K',
      openCmdk: () => this.setState({ cmdk: true, cmdq: '', hintsOpen: false }),
      onCmdq: (e) => this.setState({ cmdq: e.target.value }),
      commands: this.paletteCommands().filter((c) => (!s.cmdq ? !c.searchOnly : c.label.toLowerCase().includes(s.cmdq.trim().toLowerCase())))
        .map((c) => ({ ...c, hasKey: !!c.key })),

      shortcutsOpen: s.shortcuts, closeShortcuts: () => this.setState({ shortcuts: false }),
      shortcutList: [['n', __('New ToDo')], ['k', __('Comment')], ['f', __('Forward')], ['e', __('Complete')], ['s', __('Snooze until a set time')], ['↑ ↓', __('Navigate the list')], ['Enter', __('Open task')], ['Esc', __('Close')], ['⌘K', __('Command palette')], ['?', __('This list')], ['@', __('Mention a user')],
        ...this.paletteCommands().filter((c) => /^g ./.test(c.key)).map((c) => [c.key, c.label])].map(([key, label]) => ({ key, label })),

      hasUndo: !!s.undo, undoText: s.undo ? s.undo.text : '', doUndo: this.doUndo,
      hasToast: !!s.toast, toastText: s.toast || '',
    };
  }

  /** Command palette entries: the single source of truth for palette items and their keyboard shortcuts (see onKey) */
  paletteCommands() {
    const s = this.state;
    return [
      { icon: '#i-plus', label: __('New ToDo'), key: 'n', onDo: () => { this.setState({ cmdk: false }); this.openCompose(); } },
      { icon: '#i-check', label: __('Complete selected task'), key: 'e', onDo: () => { this.setState({ cmdk: false }); s.sel && this.complete(s.sel); } },
      { icon: '#i-forward', label: __('Forward selected task'), key: 'f', onDo: () => { this.setState({ cmdk: false }); this.openForward(); } },
      { icon: '#i-moon', label: __('Snooze until a set time'), key: 's', onDo: () => { this.setState({ cmdk: false }); this.openSnooze(); } },
      { icon: '#i-sunrise', label: __('Go to: Today\'s plan'), key: 'g d', onDo: () => { this.setState({ cmdk: false }); this.goScreen('day'); } },
      { icon: '#i-chart', label: __('Go to: Analytics'), key: 'g s', onDo: () => { this.setState({ cmdk: false }); this.goScreen('stats'); } },
      { icon: '#i-hourglass', label: __('Go to: Waiting for reply'), key: 'g w', onDo: () => this.setState({ cmdk: false, screen: 'mail', folder: 'waiting', activeView: null, loading: true }, () => this.load()) },
      { icon: '#i-inbox', label: __('Go to: Inbox'), key: 'g i', onDo: () => this.setState({ cmdk: false, screen: 'mail', folder: 'inbox', activeView: null, loading: true }, () => this.load()) },
      { icon: '#i-bolt', label: __('Rules and recurring tasks'), key: '', onDo: () => { this.setState({ cmdk: false, automation: 'rules' }); this.loadAutomation(); } },
      { icon: '#i-moon', label: __('Toggle dark mode'), key: '', onDo: () => { this.setState({ cmdk: false }); this.flipDark(); } },
      ...this.themeCommands(),
    ];
  }

  /* ---------- theme picker (engine: this.setTheme / this.toggleDark, state themeMode / dark / accent) ---------- */
  themeAccentList() {
    const fallback = [
      { id: 'todobox', label: 'ToDoBox', swatch: '#16233F', neutral: true }, { id: 'classic', label: 'Blue', swatch: '#2f63c0', neutral: true }, { id: 'teal', label: 'Teal', swatch: '#0f766e' },
      { id: 'indigo', label: 'Indigo', swatch: '#323567' }, { id: 'green', label: 'Green', swatch: '#2b7a50' },
      { id: 'orange', label: 'Orange', swatch: '#b4540a' },
      { id: 'graphite', label: 'Graphite', swatch: '#3f3f46' }, { id: 'maroon', label: 'Maroon', swatch: '#673232' }, { id: 'brown', label: 'Brown', swatch: '#705638' },
    ];
    const list = Array.isArray(window.TodoboxAccents) && window.TodoboxAccents.length ? window.TodoboxAccents : fallback;
    /* labels are English source strings; __() maps them to the user's language */
    return list.map((a) => ({ id: a.id, swatch: a.swatch, dark: a.dark || a.swatch, neutral: !!a.neutral, label: __(a.label || a.id) }));
  }
  themeModeNow() {
    const m = this.state.themeMode;
    return m === 'light' || m === 'dark' || m === 'system' ? m : (this.state.dark ? 'dark' : 'light');
  }
  pickTheme = (patch) => {
    if (typeof this.setTheme === 'function') { this.setTheme(patch); return; }
    /* engine not loaded: keep the old dark/light behaviour */
    if (patch.mode) {
      const sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const dark = patch.mode === 'dark' || (patch.mode === 'system' && sysDark);
      this.setState({ themeMode: patch.mode, dark }, () => this.applyChrome());
    }
    if (patch.accent) this.setState({ accent: patch.accent, accentCustom: patch.custom || this.state.accentCustom });
  };
  flipDark = () => {
    if (typeof this.toggleDark === 'function') { this.toggleDark(); return; }
    this.setState((st) => ({ dark: !st.dark }), () => this.applyChrome());
  };
  toggleThemeMenu = () => {
    const opening = !this.state.themeMenu;
    this.setState({ themeMenu: opening, notifsOpen: false, userMenu: false }, () => {
      if (!opening) return;
      /* keyboard users land on the current appearance option */
      const b = document.querySelector('[data-theme-menu] .tt-theme-opt[aria-pressed="true"]');
      if (b && b.focus) b.focus({ preventScroll: true });
    });
  };
  closeThemeMenu = (refocus) => {
    this.setState({ themeMenu: false }, () => {
      if (refocus !== true) return;
      const b = document.querySelector('[data-theme-menu] > button');
      if (b && b.focus) b.focus({ preventScroll: true });
    });
  };
  themeVals(isDesktop) {
    const s = this.state;
    const mode = this.themeModeNow();
    const accents = this.themeAccentList();
    const C = window.TodoboxColor;
    const customOn = s.accent === 'custom' && !!(C && C.valid(s.accentCustom));
    const accId = customOn ? 'custom' : accents.some((a) => a.id === s.accent) ? s.accent : 'todobox';
    const acc = customOn ? { label: __('Custom colour') } : accents.find((a) => a.id === accId) || accents[0];
    /* half main colour, half the background it tints (same ratios as todobox-theme.css, a bit
       stronger so the tint is visible at 28px) */
    const split = (main, neutral) => {
      const base = s.dark ? '#171717' : '#f7f7f7';
      const bg = neutral ? (s.dark ? '#2a2a2a' : '#ececec') : C ? C.mix(main, base, s.dark ? .14 : .16) : main;
      return 'linear-gradient(135deg,' + main + ' 50%,' + bg + ' 50%)';
    };
    const ring = (on, main) => on ? '0 0 0 2px var(--panel),0 0 0 4px ' + main : 'inset 0 0 0 1px rgba(127,127,127,.28)';
    const customMain = customOn ? (s.dark ? C.fitDark(s.accentCustom) : C.fitLight(s.accentCustom)) : '';
    const modeNames = { light: __('Light'), dark: __('Dark'), system: __('System') };
    const open = !!s.themeMenu;
    return {
      themeMenuOpen: open,
      toggleThemeMenu: this.toggleThemeMenu,
      closeThemeMenu: () => this.closeThemeMenu(),
      themeWrapStyle: isDesktop ? 'position:relative;flex:0 0 auto;' : 'display:none;',
      themeBtnLabel: __('Theme') + ' — ' + modeNames[mode] + ' · ' + acc.label,
      themeDialogLabel: __('Theme'),
      themeModeGroupLabel: __('Appearance'),
      themeAccentGroupLabel: __('Accent colour'),
      themeBtnStyle: 'position:relative;width:32px;height:32px;display:grid;place-items:center;background:' + (open ? 'var(--sunk)' : 'transparent') +
        ';border:1px solid var(--line2);border-radius:8px;cursor:pointer;color:' + (open ? 'var(--fg)' : 'var(--fg2)') + ';flex:0 0 auto;',
      themeSummary: (mode === 'system' ? modeNames.system + ' (' + (s.dark ? modeNames.dark : modeNames.light) + ')' : modeNames[mode]) + ' · ' + acc.label,
      themeAccentLabel: acc.label,
      themeModes: [['light', 'sun'], ['dark', 'moon'], ['system', 'monitor']].map(([id, icon]) => {
        const on = mode === id;
        return {
          label: modeNames[id], iconRef: '#i-' + icon, pressed: on,
          style: 'flex:1 1 0;min-width:0;height:30px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 6px;border:0;border-radius:7px;cursor:pointer;font-size:12px;white-space:nowrap;' +
            'background:' + (on ? 'var(--panel)' : 'transparent') + ';color:' + (on ? 'var(--fg)' : 'var(--fg3)') + ';font-weight:' + (on ? '600' : '400') + ';' +
            (on ? 'box-shadow:0 1px 3px rgba(0,0,0,.12);' : ''),
          onPick: () => this.pickTheme({ mode: id }),
        };
      }),
      themeCustomLabel: __('Custom colour'),
      themeCustomOn: customOn, themeCustomOff: !customOn,
      themeCustomValue: s.accentCustom || '#2f63c0',
      themeCustomStyle: 'position:relative;width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:50%;cursor:pointer;overflow:hidden;' +
        'color:' + (customOn ? (s.dark ? '#161616' : '#fff') : '#fff') + ';background:' +
        (customOn ? split(customMain) : 'conic-gradient(#e0565b,#e0a23b,#5cb85c,#3aa7c9,#5b6ee1,#b35bd6,#e0565b)') + ';box-shadow:' + ring(customOn, customMain) + ';',
      onThemeCustom: (e) => { const v = e && e.target ? e.target.value : e; if (C && C.valid(v)) this.pickTheme({ accent: 'custom', custom: v }); },
      themeAccents: accents.map((a) => {
        const on = a.id === accId, main = s.dark ? a.dark : a.swatch;
        return {
          label: a.label, pressed: on,
          style: 'width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;cursor:pointer;color:' + (s.dark ? '#161616' : '#fff') + ';background:' + split(main, a.neutral) + ';' +
            'box-shadow:' + ring(on, main) + ';',
          onPick: () => this.pickTheme({ accent: a.id }),
        };
      }),
    };
  }
  themeCommands() {
    const s = this.state;
    const mode = this.themeModeNow();
    const done = (patch) => { this.setState({ cmdk: false }); this.pickTheme(patch); };
    const modes = [['light', __('Light'), '#i-sun'], ['dark', __('Dark'), '#i-moon'], ['system', __('System'), '#i-monitor']].map(([id, name, icon]) => ({
      icon, label: __('Theme: {0}', [name]), key: mode === id ? '✓' : '', onDo: () => done({ mode: id }),
    }));
    /* accent entries only appear while searching, so the default list stays short */
    const accents = this.themeAccentList().map((a) => ({
      icon: '#i-palette', label: __('Accent: {0}', [a.label]), key: (s.accent || 'todobox') === a.id ? '✓' : '', searchOnly: true, onDo: () => done({ accent: a.id }),
    }));
    return [...modes, ...accents];
  }
});
