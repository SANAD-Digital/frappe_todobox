/* ToDoBox: Calendar screen. A month grid of the tasks I take part in, by due date
   (services/calendar.py get_calendar). A day shows up to 3 tasks; "+n more" or a click on the
   day lists all of them under the grid. Clicking a task opens it. */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  calIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  /** first day of the week: the site's setting when the page has it, else Sunday */
  calWeekStart() {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const v = window.frappe && frappe.boot && frappe.boot.sysdefaults && frappe.boot.sysdefaults.first_day_of_the_week;
    const i = names.indexOf(v);
    return i < 0 ? 0 : i;
  }
  /** the 42 days (6 weeks) shown for the month of `month` ('YYYY-MM') */
  calDays(month) {
    const first = new Date(month + '-01T00:00:00');
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() - this.calWeekStart() + 7) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }
  calMonth() { return this.state.calMonth || String(this.api.TODAY || this.calIso(new Date())).slice(0, 7); }
  loadCalendar = async (month) => {
    const m = month || this.calMonth();
    const days = this.calDays(m);
    this.setState({ calMonth: m, calLoading: true });
    const rows = await this.api.getCalendar(this.calIso(days[0]), this.calIso(days[41]));
    if (this.calMonth() !== m) return;
    this.setState({ calRows: rows || [], calLoading: false });
  };
  calShift = (n) => {
    const d = new Date(this.calMonth() + '-01T00:00:00');
    d.setMonth(d.getMonth() + n);
    this.setState({ calDay: null });
    this.loadCalendar(this.calIso(d).slice(0, 7));
  };

  calendarVals() {
    const s = this.state, A = this.api;
    if (s.screen !== 'calendar' || !A) return { screenCal: false, calWeeks: [], calHeads: [], calFilters: [], calDayRows: [] };
    const ME = A.ME, U = A.USERS || {}, today = A.TODAY;
    const lang = (window.TT_LANG || 'en') + '-u-nu-latn';
    const month = this.calMonth(), days = this.calDays(month);
    const who = s.calWho || 'all';
    const rows = (s.calRows || []).filter((r) => who === 'all' || (who === 'mine' ? r.allocated_to === ME : r.assigned_by === ME && r.allocated_to !== ME));
    const byDay = {};
    rows.forEach((r) => { (byDay[r.date] = byDay[r.date] || []).push(r); });
    const chip = (r) => {
      const done = r.status !== 'Open', late = !done && r.date < today;
      const nm = (id) => (U[id] || {}).name || id;
      return {
        name: r.name, text: r.subject,
        tip: r.subject + '\n' + (r.allocated_to === ME ? __('From: {0}', [nm(r.assigned_by)]) : __('To: {0}', [nm(r.allocated_to)])) + (done ? '\n' + __('Completed') : late ? '\n' + __('Overdue') : ''),
        style: 'display:flex;align-items:center;gap:5px;width:100%;min-width:0;height:20px;padding:0 6px;border:0;border-radius:5px;cursor:pointer;text-align:start;font-size:11px;' +
          'background:' + (late ? 'var(--red-soft)' : done ? 'transparent' : 'var(--sunk)') + ';color:' + (late ? 'var(--red)' : done ? 'var(--fg3)' : 'var(--fg)') + ';' + (done ? 'text-decoration:line-through;' : ''),
        dot: 'width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:' + (done ? 'var(--green)' : this.prioColor(r.priority)) + ';',
        onOpen: (e) => { if (e && e.stopPropagation) e.stopPropagation(); this.openTask(r.name); },
      };
    };
    const MAX = 3;
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      weeks.push({
        days: days.slice(w * 7, w * 7 + 7).map((d) => {
          const iso = this.calIso(d), list = byDay[iso] || [];
          const inMonth = iso.slice(0, 7) === month, isToday = iso === today, picked = s.calDay === iso;
          return {
            num: String(d.getDate()),
            label: d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }) + (list.length ? ' · ' + __('{0} tasks', [list.length]) : ''),
            cell: 'display:flex;flex-direction:column;gap:3px;min-width:0;min-height:104px;padding:5px;border-inline-end:1px solid var(--line);border-bottom:1px solid var(--line);cursor:pointer;' +
              'background:' + (picked ? 'var(--primary-soft)' : inMonth ? 'var(--panel)' : 'var(--panel2)') + ';',
            numStyle: 'align-self:flex-start;min-width:22px;height:22px;padding:0 5px;display:grid;place-items:center;border-radius:99px;font-size:12px;font-variant-numeric:tabular-nums;' +
              (isToday ? 'background:var(--primary);color:var(--primary-ink);font-weight:700;' : 'color:' + (inMonth ? 'var(--fg)' : 'var(--fg3)') + ';'),
            chips: list.slice(0, MAX).map(chip),
            more: list.length > MAX ? __('+{0} more', [list.length - MAX]) : '',
            hasMore: list.length > MAX,
            onPick: () => this.setState({ calDay: picked ? null : iso }),
          };
        }),
      });
    }
    const ws = this.calWeekStart();
    const heads = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2026, 0, 4 + ((ws + i) % 7)); /* 4 Jan 2026 is a Sunday */
      return { label: d.toLocaleDateString(lang, { weekday: 'short' }) };
    });
    const pill = (on) => 'height:26px;padding:0 11px;border-radius:99px;cursor:pointer;font-size:12px;white-space:nowrap;border:1px solid ' + (on ? 'var(--primary)' : 'var(--line2)') +
      ';background:' + (on ? 'var(--primary-soft)' : 'transparent') + ';color:' + (on ? 'var(--primary)' : 'var(--fg2)') + ';font-weight:' + (on ? '600' : '400') + ';';
    const dayList = s.calDay ? (byDay[s.calDay] || []) : [];
    return {
      screenCal: true,
      calTitle: new Date(month + '-01T00:00:00').toLocaleDateString(lang, { month: 'long', year: 'numeric' }),
      calCount: __('{0} tasks', [rows.length]),
      calLoading: !!s.calLoading,
      calPrev: () => this.calShift(-1),
      calNext: () => this.calShift(1),
      calToday: () => { this.setState({ calDay: today }); this.loadCalendar(String(today).slice(0, 7)); },
      calHeads: heads,
      calWeeks: weeks,
      calFilters: [['all', __('All')], ['mine', __('Assigned to me')], ['sent', __('Sent by me')]].map(([id, label]) => ({
        label, style: pill(who === id), onPick: () => this.setState({ calWho: id }),
      })),
      hasCalDay: !!s.calDay,
      calDayTitle: s.calDay ? new Date(s.calDay + 'T00:00:00').toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
      calDayEmpty: !!s.calDay && !dayList.length,
      calDayRows: dayList.map(chip),
      calCloseDay: () => this.setState({ calDay: null }),
    };
  }
});
