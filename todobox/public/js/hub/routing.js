/* ToDoBox: the address bar follows the screen, so a reload (or a shared link) lands on the same place.
     /todobox/inbox                 a folder            /todobox/inbox/<task>     …and the open task
     /todobox/all/<task|document>   in "All tasks" the last part is a task, or a document awaiting my decision
     /todobox/tag/<tag>[/<task>]    a tag               /todobox/search[/<task>]?q=…&view=…&sort=…
     /todobox/day | calendar | analytics | templates | settings
     /todobox/actions/<pending|sent|log>[/<document>]
   A new screen or folder adds a history entry (Back returns to it); opening another task replaces it.
   The base path is the page's own (/todobox, or the demo's /todobox-demo/app). */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  routeBase() {
    if (this._routeBase) return this._routeBase;
    const m = /^(.*?\/todobox(?:-demo\/app)?)(?=\/|$)/.exec(window.location.pathname);
    return (this._routeBase = m ? m[1] : '/todobox');
  }

  /** the route part of the address bar: {path: [segments], q: URLSearchParams} */
  routeRead() {
    const rest = window.location.pathname.slice(this.routeBase().length).split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    return { path: rest, q: new URLSearchParams(window.location.search) };
  }

  /** state patch for a route (folder / tag / search / screen; the task is opened after the list loads) */
  routeState(r) {
    const [a, b, c] = r.path;
    const SCREENS = { day: 'day', calendar: 'calendar', analytics: 'stats', templates: 'templates', settings: 'settings' };
    const FOLDERS = ['inbox', 'unread', 'overdue', 'today', 'sent', 'fwd', 'cc', 'waiting', 'snoozed', 'done', 'team', 'all'];
    if (!a) return { patch: {}, task: null };
    if (SCREENS[a]) return { patch: { screen: SCREENS[a] }, task: null };
    if (a === 'actions') return { patch: { screen: 'wf', wfTab: ['pending', 'sent', 'log'].includes(b) ? b : 'pending' }, doc: c || null };
    const base = { screen: 'mail', label: null, activeView: null, search: '', searchInput: '' };
    if (a === 'tag' && b) return { patch: { ...base, folder: 'inbox', label: b }, task: c || null };
    if (a === 'search') {
      const q = r.q.get('q') || '';
      return { patch: { ...base, folder: '__query', search: q, searchInput: q, activeView: r.q.get('view') || null, ...(r.q.get('sort') ? { sort: r.q.get('sort') } : {}) }, task: b || null };
    }
    if (FOLDERS.includes(a)) return { patch: { ...base, folder: a }, task: b || null };
    return { patch: {}, task: null };
  }

  /** the address for the current state; key: what makes it a new history entry */
  routeOf(s) {
    const enc = encodeURIComponent;
    const SCREENS = { day: 'day', calendar: 'calendar', stats: 'analytics', templates: 'templates', settings: 'settings' };
    if (SCREENS[s.screen]) return { url: '/' + SCREENS[s.screen], key: s.screen };
    if (s.screen === 'wf') return { url: '/actions/' + (s.wfTab || 'pending') + (s.wfSel ? '/' + enc(s.wfSel) : ''), key: 'wf:' + s.wfTab };
    if (s.screen !== 'mail') return null;
    const open = (s.folder === 'all' && s.selDoc) || s.sel;
    const task = open ? '/' + enc(open) : '';
    if (s.folder === '__query' || (s.search && s.folder !== 'all')) {
      const q = new URLSearchParams();
      if (s.search) q.set('q', s.search);
      if (s.activeView) q.set('view', s.activeView);
      if (s.activeView && s.sort && s.sort !== 'modified') q.set('sort', s.sort);
      const qs = q.toString();
      return { url: '/search' + task + (qs ? '?' + qs : ''), key: 'search:' + qs };
    }
    if (s.label) return { url: '/tag/' + enc(s.label) + task, key: 'tag:' + s.label };
    return { url: '/' + (s.folder || 'inbox') + task + (s.search ? '?q=' + enc(s.search) : ''), key: 'folder:' + s.folder + ':' + (s.search || '') };
  }

  /** after the first load: open the task (or document) of the address, even when it is not in the list */
  routeStart = async () => {
    const r = this._routeInit || { task: null };
    if (r.patch && r.patch.screen && r.patch.screen !== 'mail' && r.patch.screen !== 'wf' && this.goScreen) this.goScreen(r.patch.screen);
    if (r.patch && r.patch.screen === 'wf' && this.wfGo) {
      this.wfGo(r.patch.wfTab);
      if (r.doc && this.wfOpenDoc) this.wfOpenDoc(r.doc);
    }
    if (r.task && this.state.selDoc === r.task) { /* a document of "All tasks": load() opened it */ }
    else if (r.task && this.state.sel !== r.task) await this.openTask(r.task);
    else if (r.task && this.open) this.open(r.task);
    this._routeReady = true;
    this.routeSync(true);
    window.addEventListener('popstate', this.onRoutePop);
  };

  /** Back / Forward: apply the address */
  onRoutePop = () => {
    const r = this.routeState(this.routeRead());
    this._routeKey = null;
    this._routePopping = true;
    if (r.patch.screen === 'wf') { this.wfGo(r.patch.wfTab); if (r.doc) this.wfOpenDoc(r.doc); }
    else if (r.patch.screen && r.patch.screen !== 'mail') this.goScreen(r.patch.screen);
    else {
      const sameList = ['folder', 'label', 'search', 'activeView'].every((k) => !(k in r.patch) || r.patch[k] === this.state[k]) && this.state.screen === 'mail';
      if (sameList) { if (r.task) { if (this.state.folder === 'all' && this.isWfDoc(r.task)) this.allOpenDoc(r.task); else this.openTask(r.task); } }
      else this.setState({ ...r.patch, sel: r.task || null, loading: true, pane: r.task ? 'detail' : 'list', mobileScreen: r.task ? 'detail' : 'list' }, async () => {
        await this.load(r.task || undefined);
        if (r.task && this.state.sel !== r.task && this.state.selDoc !== r.task) this.openTask(r.task);
      });
    }
    setTimeout(() => { this._routePopping = false; this.routeSync(true); }, 0);
  };

  /** write the address for the current state (push for a new screen/folder, replace otherwise) */
  routeSync(replace) {
    if (!this._routeReady || this._routePopping) return;
    const r = this.routeOf(this.state);
    if (!r) return;
    const url = this.routeBase() + r.url;
    const cur = window.location.pathname + window.location.search;
    if (url === cur) { this._routeKey = r.key; return; }
    const push = !replace && this._routeKey && this._routeKey !== r.key;
    try { window.history[push ? 'pushState' : 'replaceState']({ todobox: 1 }, '', url + window.location.hash); } catch (e) { /* */ }
    this._routeKey = r.key;
  }

  componentDidUpdate(pp, ps, snap) {
    if (super.componentDidUpdate) super.componentDidUpdate(pp, ps, snap);
    this.routeSync(false);
  }
  componentWillUnmount() {
    if (super.componentWillUnmount) super.componentWillUnmount();
    window.removeEventListener('popstate', this.onRoutePop);
  }
});
