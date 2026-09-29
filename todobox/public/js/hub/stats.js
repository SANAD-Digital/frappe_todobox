/* ToDoBox: analytics: period, scope (me / my team / member), KPIs vs previous period, insights, trend, team */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  statsPeriods() {
    return [
      ['7d', __('7 days')], ['30d', __('30 days')], ['month', __('This month')],
      ['quarter', __('This quarter')], ['90d', __('90 days')], ['year', __('This year')], ['custom', __('Custom')],
    ];
  }

  statsPickDate(ev, which) {
    const q = this.statsQ();
    const cur = q[which] || (this.state.stats && this.state.stats.period ? this.state.stats.period[which === 'date_from' ? 'from' : 'to'] : '');
    const st0 = this.state.stats && this.state.stats.period;
    const from = q.date_from || (st0 && st0.from), to = q.date_to || (st0 && st0.to);
    const asDate = (iso) => (iso ? new Date(iso + 'T00:00:00') : undefined);
    this.openFrappeDate(ev, cur, (v) => {
      const st = this.state.stats && this.state.stats.period;
      const next = { period: 'custom', date_from: q.date_from || (st ? st.from : v), date_to: q.date_to || (st ? st.to : v), [which]: v };
      this.setStatsQ(next);
    }, which === 'date_from'
      ? { title: __('From'), quick: false, max_date: asDate(to) }
      : { title: __('To'), quick: false, min_date: asDate(from) });
  }

  /* in the system date format (frappe.datetime, System Settings) */
  fmtD(iso) { return iso ? frappe.datetime.str_to_user(iso) : ''; }

  /* period delta: up/down colored good/bad by metric direction; declines are gray, not red (no visual punishment) */
  statsDelta(cur, prev, { lowerIsBetter = false, unit = '%', points = false } = {}) {
    if (cur == null || prev == null) return { text: __('No data in the previous period'), style: 'font-size:11px;color:var(--fg3);' };
    let diff;
    if (points) diff = Math.round(cur - prev);
    else if (!prev) return { text: cur ? __('New this period') : __('Same as the previous period'), style: 'font-size:11px;color:var(--fg3);' };
    else diff = Math.round(((cur - prev) / prev) * 100);
    if (!diff) return { text: __('Same as the previous period'), style: 'font-size:11px;color:var(--fg3);' };
    const good = lowerIsBetter ? diff < 0 : diff > 0;
    const arrow = diff > 0 ? '↑' : '↓';
    const txt = points ? __('{0} {1} pts vs previous period', [arrow, Math.abs(diff)]) : __('{0} {1}% vs previous period', [arrow, Math.abs(diff)]);
    return { text: txt, style: 'font-size:11px;font-weight:600;color:' + (good ? 'var(--green)' : 'var(--fg3)') + ';' };
  }

  statsVals() {
    const s = this.state;
    const st = s.stats;
    const q = this.statsQ ? this.statsQ() : { period: '30d', scope: 'me' };
    const empty = {
      statsReady: false, statsLoadingNow: true, statsPeriodChips: [], statsScopeChips: [], statsHasScope: false, statsKpis: [], statsInsights: [],
      statsHasInsights: false, statsTrend: [], statsPrio: [], statsAging: [], statsTeam: [], statsIsTeam: false, statsHasWaiting: false,
      statsWaitingItems: [], statsRange: ' ', statsCustom: false, statsFromLabel: ' ', statsToLabel: ' ', statsMember: false, statsMemberName: ' ',
      statsTrendNote: ' ', statsWaitingTitle: ' ', statsWaitingNote: ' ', statsTrendEmpty: false, statsTeamEmpty: false,
      statsPickFrom: () => {}, statsPickTo: () => {}, statsClearMember: () => {}, statsLegendDone: ' ', statsLegendNew: ' ', statsBodyStyle: '',
      statsTrendGrid: '', statsScopeNote: ' ', statsArrow: '→', statsTrendLabels: '',
      statsLDone: __('Completed'), statsLOnTime: __('On time'), statsLMedian: __('Median'), statsLOpen: __('Open'), statsLOverdue: __('Overdue'),
    };
    if (!st) return empty;

    const cur = st.kpis.cur, prev = st.kpis.prev;
    const isTeam = st.scope === 'team';
    const isMember = st.scope === 'member';
    const prioAr = { High: __('High'), Medium: __('Medium'), Low: __('Low') };
    const tile = (k) => ({
      ...k,
      valueStyle: 'font-family:var(--font);font-variant-numeric:tabular-nums;font-size:' + (s.narrow ? '22px' : '26px') + ';font-weight:700;line-height:1;color:' + (k.tone || 'var(--fg)') + ';',
      boxStyle: 'min-width:0;display:flex;flex-direction:column;gap:6px;padding:' + (s.narrow ? '11px 12px' : '14px 15px') + ';background:var(--panel2);border:1px solid var(--line);border-radius:12px;text-align:start;' +
        (k.onDo ? 'cursor:pointer;' : 'cursor:default;'),
      iconStyle: 'width:15px;height:15px;color:' + (k.iconTone || 'var(--fg3)') + ';',
      onDo: k.onDo || (() => {}),
    });

    const d1 = this.statsDelta(cur.completed, prev.completed);
    const d2 = this.statsDelta(cur.on_time, prev.on_time, { points: true });
    const d3 = this.statsDelta(cur.cycle, prev.cycle, { lowerIsBetter: true });
    const goOverdue = () => this.setState({ screen: 'mail', folder: 'overdue', activeView: null, search: '', searchInput: '', loading: true }, () => this.load());
    const kpis = [
      { icon: '#i-check-circle', iconTone: 'var(--green)', label: __('Completed'), value: String(cur.completed), unit: __('tasks'), note: d1.text, noteStyle: d1.style },
      { icon: '#i-target', iconTone: 'var(--primary)', label: __('On-time rate'), value: cur.on_time == null ? '—' : String(cur.on_time), unit: cur.on_time == null ? '' : '%',
        note: cur.on_time == null ? __('No completed tasks with a due date') : d2.text, noteStyle: cur.on_time == null ? 'font-size:11px;color:var(--fg3);' : d2.style },
      { icon: '#i-clock', iconTone: 'var(--fg2)', label: __('Time to complete (median)'), value: cur.cycle == null ? '—' : String(cur.cycle), unit: cur.cycle == null ? '' : __('days'),
        note: cur.cycle == null ? __('From creation to completion') : d3.text, noteStyle: cur.cycle == null ? 'font-size:11px;color:var(--fg3);' : d3.style },
      { icon: '#i-inbox', iconTone: cur.overdue ? 'var(--red)' : 'var(--fg3)', label: __('Open now'), value: String(cur.open), unit: __('tasks'),
        note: cur.overdue ? __('{0} overdue — the oldest by {1} days', [cur.overdue, cur.oldest_overdue]) : __('Nothing overdue'),
        noteStyle: 'font-size:11px;font-weight:' + (cur.overdue ? '600' : '400') + ';color:' + (cur.overdue ? 'var(--red)' : 'var(--green)') + ';',
        onDo: st.scope === 'me' && cur.overdue ? goOverdue : null },
      isTeam
        ? { icon: '#i-bolt', iconTone: 'var(--amber)', label: __('Incoming vs completed'), value: String(cur.completed), unit: __('of {0} incoming', [cur.created]),
          note: cur.created > cur.completed ? __('Backlog grew by {0}', [cur.created - cur.completed]) : __('The team is keeping up'),
          noteStyle: 'font-size:11px;color:' + (cur.created > cur.completed ? 'var(--amber)' : 'var(--green)') + ';' }
        : { icon: '#i-zap', iconTone: 'var(--amber)', label: __('Completion streak'), value: String(st.streak || 0), unit: __('days'),
          note: st.streak ? __('Working days in a row with a completed task') : __('Complete a task today to start a streak'), noteStyle: 'font-size:11px;color:var(--fg3);' },
    ].map(tile);

    const toneVar = (t) => (t === 'fg2' ? 'var(--fg2)' : 'var(--' + t + ')');
    const insights = (st.insights || []).map((i) => {
      const c = toneVar(i.tone);
      const act = i.action === 'overdue' && st.scope === 'me' ? { label: __('Show overdue tasks'), onDo: goOverdue }
        : i.user && isTeam ? { label: __('View details'), onDo: () => this.setStatsQ({ scope: 'member', user: i.user }) } : null;
      return {
        text: i.text, iconRef: '#i-' + (i.icon || 'bolt'),
        style: 'display:flex;align-items:flex-start;gap:11px;padding:12px 14px;border-radius:11px;background:var(--panel2);border:1px solid var(--line);border-inline-start:3px solid ' + c + ';',
        iconStyle: 'width:16px;height:16px;flex:0 0 auto;margin-top:2px;color:' + c + ';',
        hasAction: !!act, actionLabel: act ? act.label : '', onAction: act ? act.onDo : () => {},
      };
    });

    /* trend: two bars per period (completed / new) on one axis (task count) */
    const tMax = Math.max(1, ...st.trend.map((b) => Math.max(b.done, b.created)));
    const many = st.trend.length > 16;
    const trend = st.trend.map((b, i) => ({
      title: (b.from === b.to ? this.fmtD(b.from) : this.fmtD(b.from) + ' – ' + this.fmtD(b.to)) + ' · ' + __('{0} completed · {1} new', [b.done, b.created]),
      label: many && i % Math.ceil(st.trend.length / 8) !== 0 ? '' : b.label,
      doneBar: 'flex:1;max-width:14px;min-height:' + (b.done ? 4 : 0) + 'px;height:' + Math.round((b.done / tMax) * 100) + '%;background:var(--primary);border-radius:4px 4px 0 0;',
      newBar: 'flex:1;max-width:14px;min-height:' + (b.created ? 4 : 0) + 'px;height:' + Math.round((b.created / tMax) * 100) + '%;background:var(--line2);border-radius:4px 4px 0 0;',
    }));
    const gran = st.granularity === 'day' ? __('per day') : st.granularity === 'week' ? __('per week') : __('per month');

    const pMax = Math.max(1, ...st.by_priority.map((p) => p.done + p.open));
    const prio = st.by_priority.map((p) => ({
      label: prioAr[p.priority] || p.priority,
      numbers: __('{0} completed · {1} open', [p.done, p.open]),
      cycle: p.cycle == null ? '—' : __('{0} days', [p.cycle]),
      doneBar: 'height:100%;width:' + Math.round((p.done / pMax) * 100) + '%;background:' + this.prioColor(p.priority) + ';',
      openBar: 'height:100%;width:' + Math.round((p.open / pMax) * 100) + '%;background:color-mix(in oklab, ' + this.prioColor(p.priority) + ' 30%, transparent);',
    }));

    const aMax = Math.max(1, ...st.aging.map((a) => a.count));
    const aging = st.aging.map((a) => ({
      label: a.label, count: String(a.count),
      overdue: a.overdue ? __('{0} overdue', [a.overdue]) : '',
      overdueStyle: a.overdue ? 'font-size:10.5px;color:var(--red);font-weight:600;' : 'display:none;',
      overBar: 'height:100%;width:' + Math.round((a.overdue / aMax) * 100) + '%;background:var(--red);',
      restBar: 'height:100%;width:' + Math.round(((a.count - a.overdue) / aMax) * 100) + '%;background:var(--primary-line);',
    }));

    const team = (st.team || []).map((r) => ({
      name: r.name, initials: (this.api.USERS[r.user] || {}).initials || (r.name || '?').slice(0, 2), avatar: this.ava(r.user, 26),
      me: r.user === this.api.ME,
      completed: String(r.completed),
      onTime: r.on_time == null ? '—' : r.on_time + '%',
      onTimeStyle: 'font-family:var(--font);font-variant-numeric:tabular-nums;font-size:12px;color:' + (r.on_time == null ? 'var(--fg3)' : r.on_time >= 80 ? 'var(--green)' : r.on_time < 50 ? 'var(--amber)' : 'var(--fg)') + ';',
      cycle: r.cycle == null ? '—' : __('{0} days', [r.cycle]),
      open: String(r.open),
      overdue: String(r.overdue),
      overdueStyle: 'font-family:var(--font);font-variant-numeric:tabular-nums;font-size:12px;font-weight:' + (r.overdue ? '700' : '400') + ';color:' + (r.overdue ? 'var(--red)' : 'var(--fg3)') + ';',
      onOpen: () => this.setStatsQ({ scope: 'member', user: r.user }),
    }));

    const w = st.waiting || null;
    const scopeChip = (id, label, on, onDo) => ({
      label, onDo,
      style: 'height:30px;padding:0 13px;border:0;border-radius:7px;cursor:pointer;font-size:12px;white-space:nowrap;background:' + (on ? 'var(--panel)' : 'transparent') +
        ';color:' + (on ? 'var(--fg)' : 'var(--fg2)') + ';font-weight:' + (on ? '600' : '400') + ';box-shadow:' + (on ? '0 1px 2px rgba(0,0,0,.08)' : 'none') + ';',
    });

    return {
      ...empty,
      statsReady: true,
      statsLoadingNow: !!s.statsLoading,
      statsBodyStyle: 'flex:1;overflow-y:auto;padding:' + (s.narrow ? '12px 14px 24px' : '16px 22px 28px') + ';display:flex;flex-direction:column;gap:18px;transition:opacity .15s;opacity:' + (s.statsLoading ? '.55' : '1') + ';',
      statsRange: __('{0} → {1} · compared with {2} → {3}', [this.fmtD(st.period.from), this.fmtD(st.period.to), this.fmtD(st.period.prev_from), this.fmtD(st.period.prev_to)]),
      statsPeriodChips: this.statsPeriods().map(([id, label]) => ({
        label, onDo: () => (id === 'custom' ? this.setStatsQ({ period: 'custom', date_from: st.period.from, date_to: st.period.to }) : this.setStatsQ({ period: id, date_from: '', date_to: '' })),
        style: this.pill(q.period === id) + 'flex:0 0 auto;height:30px;',
      })),
      statsCustom: q.period === 'custom',
      statsArrow: (window.TT_DIR || 'rtl') === 'rtl' ? '←' : '→',
      statsFromLabel: this.fmtD(q.date_from || st.period.from),
      statsToLabel: this.fmtD(q.date_to || st.period.to),
      statsPickFrom: (e) => this.statsPickDate(e, 'date_from'),
      statsPickTo: (e) => this.statsPickDate(e, 'date_to'),
      statsHasScope: !!st.can_team,
      statsScopeChips: [
        scopeChip('me', __('Me'), st.scope === 'me', () => this.setStatsQ({ scope: 'me', user: '' })),
        scopeChip('team', __('My team ({0})', [st.team_size]), st.scope !== 'me', () => this.setStatsQ({ scope: 'team', user: '' })),
      ],
      statsScopeNote: isTeam ? __('Team figures are visible only to you as team lead') : isMember ? '' : __('Compared with your own previous period — not with colleagues'),
      statsMember: isMember,
      statsMemberName: st.user_name || '',
      statsClearMember: () => this.setStatsQ({ scope: 'team', user: '' }),
      statsKpis: kpis,
      statsInsights: insights,
      statsHasInsights: insights.length > 0,
      statsTrend: trend,
      statsTrendEmpty: !st.trend.some((b) => b.done || b.created),
      statsTrendNote: gran,
      statsTrendGrid: 'display:flex;align-items:flex-end;gap:' + (many ? '3px' : '8px') + ';height:150px;padding-bottom:2px;border-bottom:1px solid var(--line);',
      statsTrendLabels: 'display:flex;gap:' + (many ? '3px' : '8px') + ';margin-top:6px;',
      statsLegendDone: __('Completed'), statsLegendNew: __('New tasks'),
      statsPrio: prio,
      statsAging: aging,
      statsIsTeam: isTeam,
      statsTeam: team,
      statsTeamEmpty: isTeam && !team.length,
      statsHasWaiting: !!(w && w.count),
      statsWaitingTitle: w ? __('Waiting on others: {0}', [w.count]) : '',
      statsWaitingNote: w && w.stale ? __('{0} have had no activity for {1}+ days — a follow-up may help', [w.stale, 3]) : __('All are moving'),
      statsWaitingItems: (w ? w.items : []).map((x) => ({
        subject: x.subject, who: (this.api.USERS[x.user] || {}).name || x.user, days: __('{0} days', [x.days]),
        onOpen: () => this.openTask(x.name),
      })),
    };
  }
});
