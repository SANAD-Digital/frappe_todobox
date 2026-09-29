/* ToDoBox: recipient picking (reassign, To, CC): server-side search instead of listing all users */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /** target: 'to' | 'cc' | 'fwd' */
  pplOpen = (target) => {
    this.setState({ ppl: { target, q: '', list: [], loading: true } }, () => this.pplFetch());
  };
  pplClose = () => { clearTimeout(this._pplT); this.setState({ ppl: null }); };

  pplQuery = (q) => {
    this.setState((st) => (st.ppl ? { ppl: { ...st.ppl, q, loading: true } } : null));
    clearTimeout(this._pplT);
    this._pplT = setTimeout(() => this.pplFetch(), 220);
  };

  pplExclude(target) {
    const s = this.state;
    if (target !== 'fwd') return [];
    const t = s.tasks.find((x) => x.name === s.sel) || (s.detail && s.detail.name === s.sel ? s.detail : null);
    return t && t.allocated_to ? [t.allocated_to] : [];
  }

  pplFetch = async () => {
    const p = this.state.ppl;
    if (!p) return;
    const q = p.q;
    const rows = await this.api.searchUsers(q, this.pplExclude(p.target));
    this.setState((st) => (st.ppl && st.ppl.q === q ? { ppl: { ...st.ppl, list: rows, loading: false } } : null));
  };

  /* initial "To" suggestions when opening a new task */
  loadComposeSuggest = async () => {
    const rows = await this.api.searchUsers('', []);
    this.setState({ composeSuggest: (rows || []).filter((u) => u && u.suggested).slice(0, 5) });
  };

  pplPick = (id) => this.setState((st) => {
    const p = st.ppl; if (!p) return null;
    if (p.target === 'fwd') return { forward: { ...st.forward, to: id }, ppl: null };
    const key = p.target === 'cc' ? 'cc' : 'to';
    const cur = (st.compose && st.compose[key]) || [];
    return { compose: { ...st.compose, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } };
  });

  loadBadge(open, overdue) {
    return 'min-width:19px;height:19px;padding:0 5px;display:grid;place-items:center;border-radius:99px;font-family:var(--font);font-variant-numeric:tabular-nums;font-size:10px;font-weight:600;color:' +
      (overdue ? 'var(--on-accent)' : 'var(--fg2)') + ';background:' + (overdue ? 'var(--red)' : 'var(--sunk)') + ';';
  }

  pplVals() {
    const s = this.state, p = s.ppl, U = this.api.USERS;
    const picked = !p ? [] : p.target === 'fwd' ? [s.forward && s.forward.to].filter(Boolean) : ((s.compose && s.compose[p.target === 'cc' ? 'cc' : 'to']) || []);
    const multi = !!p && p.target !== 'fwd';
    const list = p ? p.list : [];
    const q = p ? p.q.trim() : '';
    const empty = !!p && !p.loading && !list.length;
    return {
      pplOpen: !!p,
      pplInCompose: !!p && p.target !== 'fwd',
      pplInForward: !!p && p.target === 'fwd',
      pplTitle: !p ? '' : p.target === 'cc' ? __('Add to CC') : p.target === 'fwd' ? __('Choose a recipient') : __('Add recipients'),
      pplQ: p ? p.q : '',
      onPplQ: (e) => this.pplQuery(e.target.value),
      onPplKey: (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.pplClose(); } else if (e.key === 'Enter' && list[0]) { e.preventDefault(); this.pplPick(list[0].id); } },
      pplClose: this.pplClose,
      pplDoneLabel: multi ? __('Done') : __('Cancel'),
      pplLoading: !!p && p.loading && !list.length,
      pplEmpty: empty,
      pplEmptyText: q ? __('No user matches “{0}”', [q]) : __('No users available'),
      pplHint: !p || q ? '' : __('Suggested: people you assigned to recently and your team — type to search everyone'),
      pplCount: multi ? __('{0} selected', [picked.length]) : '',
      pplList: list.map((u) => {
        const on = picked.includes(u.id);
        return {
          name: u.name, sub: u.id, initials: u.initials, avatar: this.ava(u.id, 24),
          load: String(u.open), loadStyle: this.loadBadge(u.open, u.overdue),
          loadTitle: __('{0} open tasks, {1} overdue', [u.open, u.overdue]),
          style: 'display:flex;align-items:center;gap:9px;min-height:40px;padding:4px 9px;border:1px solid ' + (on ? 'var(--primary-line)' : 'transparent') +
            ';border-radius:8px;cursor:pointer;background:' + (on ? 'var(--primary-soft)' : 'transparent') + ';color:var(--fg);width:100%;text-align:start;',
          boxStyle: 'width:16px;height:16px;flex:0 0 16px;display:grid;place-items:center;border-radius:' + (multi ? '4px' : '50%') + ';border:1px solid ' +
            (on ? 'var(--primary)' : 'var(--line2)') + ';background:' + (on ? 'var(--primary)' : 'transparent') + ';color:var(--primary-ink);',
          tickStyle: 'width:11px;height:11px;opacity:' + (on ? '1' : '0') + ';',
          onPick: () => this.pplPick(u.id),
        };
      }),
      /* reassign: the selected recipient */
      fwdHasTo: !!(s.forward && s.forward.to),
      fwdNoTo: !(s.forward && s.forward.to),
      fwdToName: s.forward && s.forward.to ? ((U[s.forward.to] || {}).name || s.forward.to) : '',
      fwdToInitials: s.forward && s.forward.to ? ((U[s.forward.to] || {}).initials || '?') : '',
      fwdToAvatar: s.forward && s.forward.to ? this.ava(s.forward.to, 24) : '',
      fwdChange: () => this.setState((st) => ({ forward: { ...st.forward, to: null } }), () => this.pplOpen('fwd')),
      fwdPickLabel: __('Search for a user…'),
      /* CC: selected users */
      ccPicked: ((s.compose && s.compose.cc) || []).map((k) => ({
        name: (U[k] || {}).name || k,
        onRemove: () => this.setState((st) => ({ compose: { ...st.compose, cc: st.compose.cc.filter((x) => x !== k) } })),
      })),
      openCcPicker: () => this.pplOpen('cc'),
      openToPicker: () => this.pplOpen('to'),
    };
  }
});
