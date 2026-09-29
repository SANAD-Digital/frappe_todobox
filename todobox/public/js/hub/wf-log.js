/* ToDoBox: "My decisions" log: what I decided, on what, how long it waited on me, and where it went next */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  fmtHours(h) {
    if (h == null) return '';
    if (h < 1) return __('{0} min', [Math.max(1, Math.round(h * 60))]);
    if (h < 48) return __('{0} h', [Math.round(h)]);
    return __('{0} days', [Math.round(h / 24)]);
  }

  wfLogOutcome(l) {
    return l.tone === 'red' ? 'reject' : l.kind === 'submit' ? 'submit' : l.tone === 'green' ? 'approve' : 'other';
  }

  /* pill/tone: same styles as the "Awaiting my decision" and "Sent by me" filters */
  wfLogVals(log, pill, tone) {
    const s = this.state, W = this.W;
    pill = pill || ((on) => this.pill(on));
    tone = tone || ((t) => 'var(--' + t + ')');
    const days = s.wfLogDays == null ? 30 : s.wfLogDays;
    const kindF = s.wfLogKind || 'all';
    const typeF = s.wfLogType || 'all';
    const wq = (s.wfSearch || '').trim().toLowerCase();

    const inPeriod = log.filter((l) => !days || l.hours <= days * 24);
    const typeCounts = {};
    inPeriod.forEach((l) => { typeCounts[l.doctype] = (typeCounts[l.doctype] || 0) + 1; });
    const byType = inPeriod.filter((l) => typeF === 'all' || l.doctype === typeF);
    const counts = { approve: 0, reject: 0, submit: 0, other: 0 };
    byType.forEach((l) => { counts[this.wfLogOutcome(l)] += 1; });
    const rows = byType
      .filter((l) => kindF === 'all' || this.wfLogOutcome(l) === kindF)
      .filter((l) => !wq || [l.title, l.doc, __(l.action), __(l.from), __(l.to), l.note, (W.DOCTYPES[l.doctype] || {}).ar].join(' ').toLowerCase().includes(wq));

    /* filters: three rows like the other two tabs: type, outcome, period */
    const typeChips = [{ id: 'all', label: __('All {0}', [inPeriod.length]) }]
      .concat(Object.keys(typeCounts).map((dt) => ({ id: dt, label: ((W.DOCTYPES[dt] || {}).ar || dt) + ' ' + typeCounts[dt] })))
      .map((c) => ({ label: c.label, style: pill(typeF === c.id), onPick: () => this.setState({ wfLogType: c.id, wfLogKind: 'all' }) }));
    const kinds = [['approve', __('Approvals'), 'green'], ['reject', __('Rejections'), 'red'], ['submit', __('Submitted by me'), 'primary'], ['other', __('Other'), 'fg2']]
      .filter(([k]) => counts[k]);
    const kindChips = kinds.length > 1
      ? [{ id: 'all', label: __('All results'), c: 'fg2' }].concat(kinds.map(([id, label, c]) => ({ id, label: label + ' ' + counts[id], c })))
        .map((k) => ({ label: k.label, style: pill(kindF === k.id, tone(k.c)), onPick: () => this.setState({ wfLogKind: k.id }) }))
      : [];
    const periodChips = [[7, __('7 days')], [30, __('30 days')], [90, __('90 days')], [0, __('All')]]
      .map(([d, label]) => ({ label, style: pill(days === d, 'var(--primary)'), onPick: () => this.setState({ wfLogDays: d }) }));

    /* groups by day */
    const today = new Date();
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const yest = new Date(today.getTime() - 86400000);
    const dayLabel = (k) => (k === iso(today) ? __('Today') : k === iso(yest) ? __('Yesterday') : k.slice(8, 10) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4));
    const rtl = (window.TT_DIR || 'rtl') === 'rtl';
    const tr = (x) => (x ? __(x) : '');
    const groups = [];
    rows.forEach((l) => {
      const k = (l.ts || '').slice(0, 10);
      let g = groups[groups.length - 1];
      if (!g || g.key !== k) { g = { key: k, label: dayLabel(k), count: 0, rows: [] }; groups.push(g); }
      g.count += 1;
      const c = tone(l.tone || 'fg2');
      const statusText = !l.exists ? __('Document deleted')
        : l.final && l.moved_on ? __('Completed later as: {0}', [tr(l.now)])
        : l.final ? __('Completed: {0}', [tr(l.now)])
        : l.moved_on ? (l.holder ? __('Now {0} — with {1}', [tr(l.now), l.holder]) : __('Now: {0}', [tr(l.now)]))
        : l.holder ? __('Waiting for {0}', [l.holder]) : __('Now: {0}', [tr(l.now)]);
      const statusTone = !l.exists ? 'var(--fg3)' : l.final ? (/reject|cancel/i.test(l.now) ? 'var(--red)' : 'var(--green)') : 'var(--amber)';
      const chipBase = 'font-size:10.5px;line-height:18px;padding:0 7px;border-radius:99px;white-space:nowrap;';
      g.rows.push({
        action: tr(l.action),
        actionStyle: 'flex:0 0 auto;height:20px;padding:0 7px;display:inline-flex;align-items:center;border-radius:5px;font-size:11px;font-weight:700;color:' + c +
          ';background:color-mix(in oklab, ' + c + ' 13%, transparent);',
        title: l.title || l.doc,
        docId: l.title ? l.doc : '',
        meta: ((W.DOCTYPES[l.doctype] || {}).ar || l.doctype) + (l.title ? ' · ' + l.doc : ''),
        move: tr(l.from) + (rtl ? ' ← ' : ' → ') + tr(l.to),
        time: (l.ts || '').slice(11, 16),
        hasNote: !!l.note, note: l.note,
        hasWait: l.waited != null,
        wait: l.waited != null ? __('Waited {0} with you', [this.fmtHours(l.waited)]) : '',
        waitStyle: chipBase + 'color:' + (l.waited > 48 ? 'var(--amber)' : 'var(--fg2)') + ';background:' + (l.waited > 48 ? 'var(--amber-soft)' : 'var(--sunk)') + ';',
        status: statusText,
        statusStyle: chipBase + 'overflow:hidden;text-overflow:ellipsis;max-width:100%;color:' + statusTone + ';background:color-mix(in oklab, ' + statusTone + ' 11%, transparent);',
        rowStyle: 'width:100%;display:flex;flex-direction:column;gap:5px;padding:9px 12px;background:var(--panel);border:1px solid var(--line);border-inline-start:3px solid ' + c +
          ';border-radius:9px;cursor:' + (l.exists ? 'pointer' : 'default') + ';text-align:start;color:var(--fg);',
        onOpen: () => {
          if (!l.exists) return;
          this.qlOpen(l.doctype, l.doc);
        },
      });
    });

    return {
      wfLogTypeChips: typeChips,
      wfLogKindChips: kindChips,
      wfLogPeriodChips: periodChips,
      wfLogGroups: groups,
      wfLogCount: rows.length,
      wfLogEmpty: !rows.length,
      wfLogEmptyText: log.length ? __('No decisions match this period or filter.') : __('You have not made any workflow decisions yet.'),
      wfLogWeekText: (() => {
        const week = log.filter((l) => l.kind === 'decision' && l.hours <= 168);
        const w = week.map((l) => l.waited).filter((x) => x != null).sort((a, b) => a - b);
        if (!week.length) return __('Change the filter or tab above.');
        const m = w.length ? w[w.length >> 1] : null;
        return m == null ? __('You made {0} decisions this week.', [week.length]) : __('You made {0} decisions this week, with a median response time of {1}.', [week.length, this.fmtHours(m)]);
      })(),
    };
  }
});
