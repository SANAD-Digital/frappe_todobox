/* ToDoBox: formatting helpers */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /* ---------- helpers ---------- */
  /** Confirmation dialog in the app's own dialog style (Frappe's frappe.confirm needs Desk's modal CSS,
      which this page doesn't load). Resolves true on confirm; Esc, the backdrop and Cancel resolve false. */
  tbConfirm(message, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      const X = window.TMControls, h = X.h;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        root.remove();
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        resolve(ok);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); finish(true); }
      };
      const prevFocus = document.activeElement;
      const ok = h('button', { type: 'button', class: 'tb-btn ' + (o.danger ? 'tb-btn-danger' : 'tb-btn-primary'), onclick: () => finish(true) }, o.primary || __('Yes'));
      const root = h('div', { class: 'tb-confirm' },
        h('div', { class: 'tb-dlg-backdrop tb-confirm-backdrop', onclick: () => finish(false) }),
        h('div', { class: 'tb-dlg tb-dlg-sm tb-confirm-dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title || __('Confirm') },
          h('div', { class: 'tb-dlg-head' }, h('span', { class: 'tb-dlg-title' }, o.title || __('Confirm'))),
          h('div', { class: 'tb-dlg-body' }, h('p', { class: 'tb-confirm-msg', text: message })),
          h('div', { class: 'tb-dlg-foot' },
            h('button', { type: 'button', class: 'tb-btn tb-btn-default', onclick: () => finish(false) }, __('Cancel')),
            ok)));
      window.addEventListener('keydown', onKey, true);
      document.body.appendChild(root);
      ok.focus();
    });
  }
  fmtTime(ts) {
    if (!ts) return '';
    const d = ts.slice(0, 10), hm = ts.slice(11, 16);
    const today = this.api.TODAY;
    if (d === today) return hm;
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (d === y.toISOString().slice(0, 10)) return __('Yesterday');
    return d.slice(8, 10) + '/' + d.slice(5, 7);
  }
  dayLabel(ts) {
    const d = ts.slice(0, 10), today = this.api.TODAY;
    if (d === today) return __('Today');
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (d === y.toISOString().slice(0, 10)) return __('Yesterday');
    return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  }
  prioColor(p) { return p === 'High' ? 'var(--red)' : p === 'Medium' ? 'var(--amber)' : 'var(--fg3)'; }
  /* collapsible desktop sidebar — persisted per browser (localStorage may be unavailable) */
  navCollapsedPref() {
    if (typeof this.state.navCollapsed === 'boolean') return this.state.navCollapsed;
    if (this._navPref === undefined) {
      let v = false;
      try { v = localStorage.getItem('todobox_nav_collapsed') === '1'; } catch (e) { v = false; }
      this._navPref = v;
    }
    return this._navPref;
  }
  setNavCollapsed(v) {
    this._navPref = !!v;
    try { localStorage.setItem('todobox_nav_collapsed', v ? '1' : '0'); } catch (e) { /* private mode */ }
    this.setState({ navCollapsed: !!v });
  }
  /* sidebar item: espresso-style raised "active" row (position:relative anchors the collapsed-rail count dot) */
  navBtnStyle(active) {
    const m = this.state.view !== 'desktop';
    return 'position:relative;display:flex;align-items:center;gap:9px;min-width:0;height:' + (m ? '40px;flex:0 0 40px;font-size:14px;' : '30px;flex:0 0 30px;font-size:13px;') + 'padding:0 8px;border:0;border-radius:7px;cursor:pointer;text-align:start;white-space:nowrap;background:' +
      (active ? 'var(--panel)' : 'transparent') + ';color:' + (active ? 'var(--fg)' : 'var(--fg2)') + ';font-weight:' + (active ? '600' : '450') + ';' +
      (active ? 'box-shadow:var(--shadow-sm),inset 0 0 0 1px var(--line);' : '');
  }
  /* sidebar count: a pill that never shrinks or clips (1–3+ digits), hidden when there is nothing to count.
     Tones: 'primary' (unread inbox), 'red' (overdue/late) — everything else stays neutral. */
  countPill(n, tone) {
    if (!n) return 'display:none;';
    const t = tone === 'primary' ? 'background:var(--primary);color:var(--primary-ink);--dot:var(--primary);'
      : tone === 'red' ? 'background:var(--red-soft);color:var(--red);--dot:var(--red);'
        : 'background:var(--sunk);color:var(--fg2);--dot:var(--fg3);';
    return 'box-sizing:border-box;min-width:20px;height:18px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;border-radius:99px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;line-height:18px;letter-spacing:0;white-space:nowrap;overflow:visible;' + t;
  }
  /* muted avatar / tag tone (1–6) from a stable hash of the key */
  toneIdx(key) {
    let h = 0; const k = String(key || '');
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
    return (Math.abs(h) % 6) + 1;
  }
  avaBg(key) { const v = 'var(--ava-' + this.toneIdx(key) + ')'; return 'color:' + v + ';background:color-mix(in srgb, ' + v + ' 16%, var(--panel));'; }
  chip(text, fg, bg) { return { text, style: 'display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:6px;font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums;color:' + fg + ';background:' + bg + ';' + (fg === 'var(--fg2)' ? '' : 'font-weight:500;') }; }
  ava(u, size) {
    const s = size || 30;
    return 'width:' + s + 'px;height:' + s + 'px;flex:0 0 ' + s + 'px;border-radius:50%;display:grid;place-items:center;font-size:' + (s < 26 ? 9 : 11) + 'px;font-weight:600;' + this.avaBg(u);
  }
  pill(active) {
    return 'height:26px;padding:0 11px;border-radius:99px;cursor:pointer;font-size:12px;border:1px solid ' +
      (active ? 'var(--primary)' : 'var(--line2)') + ';background:' + (active ? 'var(--primary-soft)' : 'transparent') +
      ';color:' + (active ? 'var(--primary)' : 'var(--fg2)') + ';font-weight:' + (active ? '600' : '400') + ';';
  }
});
