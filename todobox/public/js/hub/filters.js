/* ToDoBox: filter builder and saved filters */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /* ---------- filter builder ---------- */
  QB_KEYS = { from: __('Assigned By'), to: __('Assignee'), label: __('Tag'), ref: __('Document'), due: __('Due'), is: __('Status'), prio: __('Priority') };
  qbApply = (q) => {
    clearTimeout(this.sd);
    this.setState({ searchInput: q, search: q, activeView: null, loading: true }, () => this.load());
  };
  /* builder tabs: time, status, sender & recipient (assigned by / assignee), priority, tags */
  QB_CATS = { due: __('Time'), is: __('Status'), people: __('Sender & recipient'), prio: __('Priority'), label: __('Tag') };
  qbToggle = (key, val) => {
    let toks = String(this.state.searchInput || '').split(/\s+/).filter(Boolean);
    const exact = (key + ':' + val).toLowerCase();
    /* completed / not completed exclude each other; the other statuses combine */
    const rival = key === 'is' && { open: 'is:done', done: 'is:open' }[String(val).toLowerCase()];
    if (rival) toks = toks.filter((t) => t.toLowerCase() !== rival);
    let next;
    if (toks.some((t) => t.toLowerCase() === exact)) next = toks.filter((t) => t.toLowerCase() !== exact);
    else if (key === 'is') next = toks.concat([key + ':' + val]);
    else next = toks.filter((t) => t.toLowerCase().indexOf(key + ':') !== 0).concat([key + ':' + val]);
    this.qbApply(next.join(' '));
  };
  qbRemove = (raw) => this.qbApply(String(this.state.searchInput || '').split(/\s+/).filter(Boolean).filter((t) => t !== raw).join(' '));
  qbSetDate = (v) => {
    const toks = String(this.state.searchInput || '').split(/\s+/).filter(Boolean).filter((t) => t.toLowerCase().indexOf('due:') !== 0);
    this.qbApply((v ? toks.concat(['due:' + v]) : toks).join(' '));
  };
  qbFmtDate(iso) {
    try { return new Date(iso + 'T00:00:00').toLocaleDateString(window.TT_LANG || 'en', { day: 'numeric', month: 'long' }); } catch (e) { return iso; }
  }
  qbValueSets(labelSet) {
    const USERS = (this.api && this.api.USERS) || {};
    const users = Object.keys(USERS).filter((u) => u !== 'Guest').map((u) => ({ val: String(u).split('@')[0], label: USERS[u].name }));
    const mk = (rows) => rows.map(([val, label]) => ({ val, label }));
    return {
      due: mk([['overdue', __('Overdue')], ['today', __('Today')], ['<3d', __('Within {0} days', [3])], ['<7d', __('Within a week')]]),
      is: mk([['open', __('Not completed')], ['done', __('Completed')], ['unread', __('Unread')], ['waiting', __('Waiting on others')], ['snoozed', __('Snoozed')]]),
      prio: mk([['high', __('High')], ['medium', __('Medium')], ['low', __('Low')]]),
      label: (labelSet || []).map((l) => ({ val: String(l).trim().replace(/\s+/g, '_'), label: l })),
      to: users, from: users,
    };
  }
  queryBuilderVals(labelSet) {
    const s = this.state;
    const sets = this.qbValueSets(labelSet);
    /* time, status, sender & recipient, priority, then tags */
    const order = ['due', 'is', 'people', 'prio', 'label'];
    const toks = String(s.searchInput || '').split(/\s+/).filter(Boolean);
    /* "Sender & recipient" shows one side at a time: assigned by (from) or assignee (to) */
    const side = s.qbSide === 'to' ? 'to' : 'from';
    const tab = order.includes(s.qbCat) ? s.qbCat : (s.qbCat === 'from' || s.qbCat === 'to') ? 'people' : 'due';
    const cat = tab === 'people' ? (s.qbCat === 'to' || s.qbCat === 'from' ? s.qbCat : side) : tab;
    const dueTok = toks.find((t) => t.toLowerCase().indexOf('due:') === 0) || '';
    const dueDate = /^due:\d{4}-\d{2}-\d{2}$/i.test(dueTok) ? dueTok.slice(4) : '';
    const all = sets[cat] || [];
    const q = String(s.qbq || '').trim().toLowerCase();
    const searchable = cat === 'from' || cat === 'to' || cat === 'label' || all.length > 8;
    const filtered = q ? all.filter((o) => (o.label + ' ' + o.val).toLowerCase().includes(q)) : all;
    const shown = searchable ? filtered.slice(0, 8) : filtered;
    const chips = toks.map((raw) => {
      const m = raw.match(/^(from|to|label|ref|due|is|prio):(.+)$/i);
      const key = m ? m[1].toLowerCase() : null;
      const val = m ? m[2] : raw;
      const hit = key && sets[key] ? sets[key].find((o) => String(o.val).toLowerCase() === String(val).toLowerCase()) : null;
      const pretty = hit ? hit.label : (key === 'due' && /^\d{4}-\d{2}-\d{2}$/.test(val) ? this.qbFmtDate(val) : val);
      return { raw, key: key ? this.QB_KEYS[key] : __('Text'), val: pretty, onRemove: () => this.qbRemove(raw) };
    });
    return {
      filterChips: chips, hasFilterChips: chips.length > 0,
      qbCats: order.map((k) => ({
        label: this.QB_CATS[k],
        dot: (k === 'people' ? ['from', 'to'] : [k]).some((kk) => toks.some((t) => t.toLowerCase().indexOf(kk + ':') === 0)),
        onPick: () => this.setState({ qbCat: k === 'people' ? side : k, qbq: '' }),
        style: 'height:26px;padding:0 11px;display:flex;align-items:center;gap:6px;border-radius:99px;cursor:pointer;font-size:12px;font-family:inherit;'
          + (k === tab ? 'background:var(--sunk);border:1px solid var(--line2);color:var(--fg);font-weight:600;' : 'background:transparent;border:1px solid transparent;color:var(--fg3);'),
      })),
      qbShowSides: tab === 'people',
      qbSides: [['from', this.QB_KEYS.from], ['to', this.QB_KEYS.to]].map(([k, label]) => ({
        label, onPick: () => this.setState({ qbCat: k, qbSide: k, qbq: '' }),
        dot: toks.some((t) => t.toLowerCase().indexOf(k + ':') === 0),
        style: 'height:24px;padding:0 10px;display:flex;align-items:center;gap:5px;border-radius:7px;cursor:pointer;font-size:11.5px;font-family:inherit;'
          + (k === cat ? 'background:var(--primary-soft);border:1px solid var(--primary-line);color:var(--primary);font-weight:600;' : 'background:transparent;border:1px solid var(--line2);color:var(--fg2);'),
      })),
      qbValues: shown.map((o) => {
        const on = toks.some((t) => t.toLowerCase() === (cat + ':' + o.val).toLowerCase());
        return {
          label: o.label, on, onPick: () => this.qbToggle(cat, o.val),
          style: (searchable
            ? 'width:100%;height:32px;padding:0 10px;display:flex;align-items:center;gap:8px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;text-align:start;'
            : 'height:28px;padding:0 12px;display:flex;align-items:center;gap:6px;border-radius:99px;cursor:pointer;font-size:12px;font-family:inherit;')
            + (on ? 'background:var(--primary-soft);border:1px solid var(--primary-line);color:var(--primary);font-weight:600;' : 'background:var(--panel);border:1px solid ' + (searchable ? 'transparent' : 'var(--line2)') + ';color:var(--fg2);'),
        };
      }),
      qbSearchable: searchable,
      qbShowDate: cat === 'due',
      qbDateVal: dueDate,
      qbDateLabel: dueDate ? this.qbFmtDate(dueDate) : __('Specific date…'),
      qbDateStyle: 'position:relative;height:28px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;border-radius:99px;cursor:pointer;font-size:12px;font-family:inherit;'
        + (dueDate ? 'background:var(--primary-soft);border:1px solid var(--primary-line);color:var(--primary);font-weight:600;' : 'background:var(--panel);border:1px dashed var(--line2);color:var(--fg2);'),
      qbPickDate: (e) => this.openFrappeDate(e, dueDate || (this.api && this.api.TODAY), (v) => this.qbSetDate(v), { title: __('Due on') }),
      qbValuesStyle: searchable
        ? 'display:flex;flex-direction:column;gap:2px;padding:8px 12px 10px;max-height:190px;overflow-y:auto;'
        : 'display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;',
      qbq: s.qbq || '',
      onQbq: (e) => this.setState({ qbq: e.target.value }),
      qbSearchPlaceholder: cat === 'label' ? __('Search tags…') : __('Search users…'),
      qbNoResults: searchable && filtered.length === 0,
      qbMore: searchable && filtered.length > shown.length ? __('and {0} more — type to narrow down', [filtered.length - shown.length]) : '',
      qbTip: cat === 'is' ? __('You can select more than one status at a time.') : __('Pick a value to apply it instantly — or type in the field for a text search.'),
    };
  }

  /* ---------- saved views ---------- */
  applyView = (v) => {
    this.setState({ screen: 'mail', folder: '__query', activeView: v.id, search: v.query, searchInput: v.query, sort: v.sort, label: null, loading: true, sel: null, pane: 'list', mobileScreen: 'list' }, () => this.load());
  };
  /** "Save filter" name: a Frappe Data control, in the nav editor or the compact strip above the list */
  svFx() {
    const make = (el, strip) => {
      const ctl = new window.TMControls.Data(el, {
        value: this.state.saveViewName || '', inputId: strip ? 'tt-sv-name-strip' : 'tt-sv-name', maxlength: 60,
        label: strip ? __('View name') : __('Name'), reqd: 1,
        onChange: (v) => { ctl.set_error(false); this.setState((st) => ({ saveViewName: v || '', saveViewErr: st.saveViewErr ? { ...st.saveViewErr, name: false } : null })); },
      });
      setTimeout(() => ctl.focus(), 30);
      return ctl;
    };
    return { nav: this.fxSlot('svName', (el) => make(el, false)), strip: this.fxSlot('svNameStrip', (el) => make(el, true)) };
  }
  confirmSaveView = async () => {
    if (this.state.savingBusy) return;
    const st = this.state;
    const name = (st.saveViewName || '').trim();
    if (!name) {
      this.setState({ saveViewErr: { name: true } });
      const ctl = this._fx && (this._fx.svName || this._fx.svNameStrip);
      if (ctl) { ctl.set_error(true); ctl.focus(); }
      return;
    }
    this.setState({ savingBusy: true, saveViewErr: null });
    const v = await this.api.saveView(name, st.searchInput || 'is:open', st.sort);
    this.setState({ savingBusy: false });
    if (!v) { this.toast(__('Could not save the view')); return; }
    this.setState({ savingView: false, saveViewName: '', activeView: v.id });
    this.toast(__('View "{0}" saved', [name]));
    this.loadViews();
  };
  deleteView = async (v) => {
    const views = await this.api.deleteView(v.id);
    this.setState((st) => ({ savedViews: (views || []).map((x) => ({ ...x })), activeView: st.activeView === v.id ? null : st.activeView }));
    this.toast(__('View "{0}" deleted', [v.label]));
  };
  async loadViews() {
    const A = this.api;
    const views = A.loadViews ? await A.loadViews() : A.SAVED_VIEWS.map((v) => ({ ...v }));
    this.setState({ savedViews: views });
    const viewCounts = A.countViews ? await A.countViews(views) : {};
    this.setState({ viewCounts: viewCounts || {} });
  }
});
