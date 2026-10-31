/* ToDoBox: header user menu: back to Desk, change language and log out (standalone page without the Frappe navbar) */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  toggleUserMenu = () => this.setState((st) => ({ userMenu: !st.userMenu, notifsOpen: false, themeMenu: false }));

  /* "Change language": a small dialog with a Link to Language (every language in the system);
     saving sets the user's own User.language and reloads */
  openLangMenu = () => {
    this.setState({ userMenu: false });
    if (document.querySelector('.tt-lang-dlg')) return;
    const X = window.TMControls;
    const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const backdrop = h('div', 'tm-msg-backdrop tt-lang-dlg');
    const box = h('div', 'tm-msg');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('dir', window.TT_DIR || 'ltr');
    const head = h('div', 'tm-msg-head');
    head.append(h('span', 'tm-msg-dot'), h('span', 'tm-msg-title', __('Change language')));
    const x = h('button', 'tm-msg-x', '×'); x.type = 'button'; x.setAttribute('aria-label', __('Close'));
    head.append(x);
    const body = h('div', 'tm-msg-body');
    const slot = h('div'); body.append(slot);
    const foot = h('div', 'tm-msg-foot');
    const ok = h('button', 'tm-msg-ok', __('Save')); ok.type = 'button';
    foot.append(ok);
    box.append(head, body, foot); backdrop.append(box); document.body.append(backdrop);
    let ctl = null, value = window.TT_LANG || null;
    const close = () => { try { ctl && ctl.destroy(); } catch (e) { /* */ } backdrop.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (X && X.anyPopoverOpen && X.anyPopoverOpen()) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    x.addEventListener('click', close);
    ok.addEventListener('click', async () => {
      if (!value) return;
      if (value === (window.TT_LANG || '')) { close(); return; }
      ok.disabled = true;
      const r = await window.ToDoBoxBridge.callOrNull('todobox.api.set_my_language', { language: value });
      if (r) window.location.reload(); else ok.disabled = false;
    });
    const mount = () => {
      ctl = new X.Link(slot, { doctype: 'Language', value, inputId: 'tt-lang', label: __('Language'), reqd: 1,
        placeholder: __('Search languages…'), onChange: (v) => { value = v || null; } });
      setTimeout(() => ctl.focus && ctl.focus(), 0);
    };
    (window.__tmcReady || Promise.resolve()).then(() => X.ready()).then(mount, (e) => console.error(e));
  };

  /* "View box of": an employee's box, read-only; who appears comes from the server (get_list on Employee) */
  loadBoxes = async () => {
    if (this._boxesAsked || !this.api || !this.api.getViewableBoxes) return;
    this._boxesAsked = true;
    const boxes = await this.api.getViewableBoxes();
    this.setState({ boxes });
  };
  viewBox = (box) => {
    this.api.setViewAs(box ? box.user : null);
    this.setState({ viewAs: box || null, screen: 'mail', folder: 'inbox', quick: 'all', label: null, activeView: null, search: '', searchInput: '', loading: true, sel: null, selDoc: null, pane: 'list', mobileScreen: 'list', checked: [], undo: null, userMenu: false }, () => this.load());
  };
  /** leave the view before going to one of my own screens */
  leaveBox() {
    if (!this.state.viewAs) return;
    this.api.setViewAs(null);
    this.setState({ viewAs: null, sel: null, loading: true }, () => this.load());
  }
  openBoxPicker = () => {
    this.setState({ userMenu: false });
    if (document.querySelector('.tt-box-dlg')) return;
    const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const backdrop = h('div', 'tm-msg-backdrop tt-box-dlg');
    const box = h('div', 'tm-msg');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('dir', window.TT_DIR || 'ltr');
    const head = h('div', 'tm-msg-head');
    head.append(h('span', 'tm-msg-dot'), h('span', 'tm-msg-title', __('View tasks of')));
    const x = h('button', 'tm-msg-x', '×'); x.type = 'button'; x.setAttribute('aria-label', __('Close'));
    head.append(x);
    const body = h('div', 'tm-msg-body');
    const search = h('input'); search.type = 'text'; search.placeholder = __('Search employees…'); search.setAttribute('aria-label', __('Search employees…'));
    search.style.cssText = 'width:100%;height:34px;padding:0 11px;margin-bottom:8px;background:var(--sunk);border:1px solid var(--line);border-radius:8px;outline:none;font-size:13px;color:var(--fg);';
    const list = h('div'); list.setAttribute('role', 'list');
    list.style.cssText = 'display:flex;flex-direction:column;gap:2px;max-height:320px;overflow-y:auto;';
    body.append(search, list);
    box.append(head, body); backdrop.append(box); document.body.append(backdrop);
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    x.addEventListener('click', close);
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      list.textContent = '';
      const rows = (this.state.boxes || []).filter((b) => !q || [b.name, b.user, b.designation, b.department].join(' ').toLowerCase().includes(q));
      if (!rows.length) { const none = h('div', '', __('No results')); none.style.cssText = 'padding:12px;font-size:12px;color:var(--fg3);text-align:center;'; list.append(none); }
      rows.forEach((b) => {
        const row = h('button'); row.type = 'button';
        row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:7px 10px;background:transparent;border:0;border-radius:7px;cursor:pointer;text-align:start;color:var(--fg);';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--hover)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
        const name = h('span', '', b.name); name.style.cssText = 'font-size:13px;font-weight:600;';
        const meta = h('span', '', [b.designation, b.department].filter(Boolean).join(' · ') || b.user); meta.style.cssText = 'font-size:11px;color:var(--fg3);';
        row.append(name, meta);
        row.addEventListener('click', () => { close(); this.viewBox(b); });
        list.append(row);
      });
    };
    search.addEventListener('input', paint);
    paint();
    setTimeout(() => search.focus(), 0);
  };

  logout = async () => {
    this.setState({ userMenu: false });
    try {
      await fetch('/api/method/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Frappe-CSRF-Token': (window.frappe && window.frappe.csrf_token) || '' },
      });
    } catch (e) { /* go to the login page anyway */ }
    window.location.href = '/login';
  };

  accountVals() {
    const boot = window.todobox_boot || {};
    const u = boot.user || {};
    const open = !!this.state.userMenu;
    const items = [];
    if (boot.is_desk_user) {
      items.push({ label: __('Back to Desk'), iconRef: '#i-desk', onDo: () => { this.setState({ userMenu: false }); window.location.href = '/desk'; } });
    }
    this.loadBoxes();
    if (this.state.viewAs) items.push({ label: __('Back to my tasks'), iconRef: '#i-inbox', onDo: () => this.viewBox(null) });
    if ((this.state.boxes || []).length) items.push({ label: __('View tasks of…'), iconRef: '#i-users', onDo: this.openBoxPicker });
    items.push({ label: __('Change language'), iconRef: '#i-globe', onDo: this.openLangMenu });
    /* notification sounds on/off (localStorage via window.TodoboxSound, data.js); the menu stays open,
       and turning it on plays a preview (this click also unlocks audio) */
    const S = window.TodoboxSound;
    if (S) {
      const on = S.enabled();
      items.push({ label: on ? __('Notification sounds: On') : __('Notification sounds: Off'), iconRef: on ? '#i-bell' : '#i-bell-off',
        onDo: () => { S.setEnabled(!on); if (!on) { S.unlock(); setTimeout(() => S.play('chime', true), 60); } this.forceUpdate(); } });
    }
    items.push({ label: __('Log out'), iconRef: '#i-logout', onDo: this.logout });
    const menuItems = items;
    /* wordmark: one translated name ("ToDoBox" → «صندوق المهام»); the first word is bold, the rest regular */
    /* Arabic always reads «صندوق المهام», even if a site's translation cache is stale */
    const lang = String(window.TT_LANG || document.documentElement.lang || '').toLowerCase();
    const tr = __('ToDoBox');
    const brand = tr === 'ToDoBox' && lang.startsWith('ar') ? 'صندوق المهام' : tr;
    const sp = brand.indexOf(' ');
    const brandA = brand === 'ToDoBox' ? 'ToDo' : sp > 0 ? brand.slice(0, sp) : brand;
    const brandB = brand === 'ToDoBox' ? 'Box' : sp > 0 ? brand.slice(sp) : '';
    return {
      userMenuOpen: open,
      viewingBox: !!this.state.viewAs, notViewingBox: !this.state.viewAs,
      viewingBoxText: this.state.viewAs ? __('Viewing the tasks of {0} — read only', [this.state.viewAs.name]) : '',
      backToMyBox: () => this.viewBox(null),
      toggleUserMenu: this.toggleUserMenu,
      userMenuItems: menuItems,
      brandA,
      brandB,
      /* small beta note at the bottom of the sidebar, under Tags */
      betaLabel: __('Beta'),
      betaShort: __('More features coming soon'),
      betaNote: __('Beta version — new features are coming in the next release'),
      meFullName: u.full_name || u.name || '',
      meEmail: u.email || u.name || '',
      meBtnStyle: 'padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;display:block;flex:0 0 auto;' +
        (open ? 'box-shadow:0 0 0 2px var(--primary-line);' : ''),
    };
  }
});
