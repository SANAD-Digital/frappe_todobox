/* ToDoBox: data loading and screens */
/* selectable accent themes; swatch = light-mode --primary (see todobox-theme.css) */
window.TodoboxAccents = [
  /* todobox = the logo identity (the default): navy ink + amber lid on warm cream neutrals */
  { id: 'todobox', label: 'ToDoBox', swatch: '#16233F', dark: '#B4C2E3', neutral: true },
  /* classic = the previous default: blue accent on neutral (untinted) greys */
  { id: 'classic', label: 'Blue', swatch: '#2f63c0', dark: '#7ea4e6', neutral: true },
  { id: 'teal', label: 'Teal', swatch: '#10736e', dark: '#6cc0ba' },
  { id: 'indigo', label: 'Indigo', swatch: '#323567', dark: '#a9acdf' },
  { id: 'green', label: 'Green', swatch: '#2e7a4b', dark: '#84c69c' },
  { id: 'orange', label: 'Orange', swatch: '#b0520f', dark: '#e5a06b' },
  { id: 'graphite', label: 'Graphite', swatch: '#3f3f46', dark: '#d4d4d8' },
  { id: 'maroon', label: 'Maroon', swatch: '#673232', dark: '#dc9e9e' },
  { id: 'brown', label: 'Brown', swatch: '#705638', dark: '#d0b597' },
];
/* colour maths for the custom accent: any picked colour is nudged until it stays
   readable (white text on it in light mode, on --panel in dark mode) */
window.TodoboxColor = (() => {
  const rgb = (h) => { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v * t + y[i] * (1 - t))); };
  const lum = (h) => { const c = rgb(h).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const valid = (h) => /^#[0-9a-f]{6}$/i.test(h || '');
  const fitLight = (h) => { let c = h; for (let i = 0; i < 40 && contrast(c, '#ffffff') < 4.8; i++) c = mix('#000000', c, .06); return c; };
  const fitDark = (h) => { let c = h; for (let i = 0; i < 40 && contrast(c, '#1f1f1f') < 6.5; i++) c = mix('#ffffff', c, .08); return c; };
  return { mix, contrast, valid, fitLight, fitDark };
})();
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  applyChrome() {
    const root = document.documentElement, s = this.state;
    /* follow the OS live while in "system" mode (registered once per component) */
    if (!this.tmSchemeMq && window.matchMedia) {
      this.tmSchemeMq = window.matchMedia('(prefers-color-scheme: dark)');
      const onScheme = () => {
        if ((this.state.themeMode || 'system') === 'system' && this.state.dark !== this.tmSchemeMq.matches)
          this.setState({ dark: this.tmSchemeMq.matches }, () => this.applyChrome());
      };
      if (this.tmSchemeMq.addEventListener) this.tmSchemeMq.addEventListener('change', onScheme);
      else if (this.tmSchemeMq.addListener) this.tmSchemeMq.addListener(onScheme);
    }
    const dark = s.dark ? '1' : '0';
    /* legacy callers that flip state.dark directly: if the result disagrees with the
       current mode, adopt it as an explicit light/dark choice and remember it */
    const mode = s.themeMode || 'system';
    const implied = mode === 'system' ? !!(this.tmSchemeMq && this.tmSchemeMq.matches) : mode === 'dark';
    if (!!s.dark !== implied) {
      try { localStorage.setItem('todobox_dark', dark); } catch (e) { }
      this.setState({ themeMode: s.dark ? 'dark' : 'light' });
    }
    root.setAttribute('data-dark', dark);
    const C = window.TodoboxColor, custom = s.accent === 'custom' && C.valid(s.accentCustom);
    const accent = custom ? 'custom' : (window.TodoboxAccents || []).some(a => a.id === s.accent) ? s.accent : 'todobox';
    if (custom) {
      root.style.setProperty('--cu-l', C.fitLight(s.accentCustom));
      root.style.setProperty('--cu-d', C.fitDark(s.accentCustom));
    }
    root.setAttribute('data-accent', accent);
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', accent === 'todobox' ? (s.dark ? '#1A1F2B' : '#FFFFFF') : s.dark ? '#1f1f1f' : '#ffffff');
    root.setAttribute('data-density', s.density);
  }

  /* theme picker entry point: either key optional.
     mode: 'light' | 'dark' | 'system'; accent: an id from window.TodoboxAccents, or 'custom' with custom: '#rrggbb' */
  setTheme({ mode, accent, custom } = {}) {
    const patch = {};
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      patch.themeMode = mode;
      try {
        if (mode === 'system') localStorage.removeItem('todobox_dark');
        else localStorage.setItem('todobox_dark', mode === 'dark' ? '1' : '0');
      } catch (e) { }
      patch.dark = mode === 'system'
        ? !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        : mode === 'dark';
    }
    if (accent === 'custom' && window.TodoboxColor.valid(custom)) {
      const C = window.TodoboxColor;
      patch.accent = 'custom'; patch.accentCustom = custom.toLowerCase();
      try {
        localStorage.setItem('todobox_accent', 'custom');
        localStorage.setItem('todobox_accent_custom', JSON.stringify({ src: patch.accentCustom, l: C.fitLight(custom), d: C.fitDark(custom) }));
      } catch (e) { }
    } else if (accent && (window.TodoboxAccents || []).some(a => a.id === accent)) {
      patch.accent = accent;
      try { localStorage.setItem('todobox_accent', accent); } catch (e) { }
    }
    this.setState(patch, () => this.applyChrome());
  }

  /* quick light/dark flip (top bar button, command palette) */
  toggleDark() {
    this.setTheme({ mode: this.state.dark ? 'light' : 'dark' });
  }

  /* ---------- data ---------- */
  async loadAux() {
    const A = this.api;
    this.loadViews();
    const [notifs, workload] = await Promise.all([A.getNotifications(), A.getWorkload ? A.getWorkload() : {}]);
    this.chimeForNew(notifs || []);
    this.setState({ notifs: notifs || [], workload: workload || {} });
    this.loadAutomation();
    this.wireNotifLive();
  }

  /* notification sounds: a new unread item (not from me) that was not in the previous list.
     The first list only seeds what counts as "seen". */
  chimeForNew(list) {
    const seen = this.tmNotifSeen, me = this.api && this.api.ME;
    this.tmNotifSeen = new Set(list.map((n) => n.id));
    if (!seen) return;
    const fresh = list.filter((n) => n && !n.read && !seen.has(n.id) && n.user !== me);
    if (fresh.length && window.TodoboxSound) window.TodoboxSound.play(fresh.some((n) => n.kind !== 'reply') ? 'chime' : 'mention');
  }
  /* live: Notification Log publishes "notification" to its user; a new Workflow Action may need my
     decision. Both are optional (the demo shim may have no socket). Registered once. */
  wireNotifLive() {
    if (this.tmNotifLive) return;
    this.tmNotifLive = true;
    const rt = window.frappe && window.frappe.realtime;
    if (!rt || typeof rt.on !== 'function') return;
    let t1 = null, t2 = null;
    try {
      rt.on('notification', () => { clearTimeout(t1); t1 = setTimeout(() => this.loadAux(), 700); });
      rt.on('list_update', (d) => {
        if (!d || d.doctype !== 'Workflow Action' || !this.W || !this.W.LOADED || !this.W.refresh || !this.W.pendingForMe) return;
        clearTimeout(t2);
        t2 = setTimeout(() => {
          const before = new Set(this.W.pendingForMe().map((x) => x.name));
          this.W.refresh(true).then(() => {
            const me = this.W.ME || (this.api && this.api.ME);
            /* who moved it last (trail rows are [state, user, hours, note]); my own move stays silent */
            const lastBy = (x) => { const tr = x.trail || []; return (tr.length && tr[tr.length - 1][1]) || x.owner; };
            const fresh = this.W.pendingForMe().filter((x) => !before.has(x.name) && lastBy(x) !== me);
            if (fresh.length && window.TodoboxSound) window.TodoboxSound.play('chime');
            if (this.W.hydrateChecks) this.W.hydrateChecks();
            this.forceUpdate();
          });
        }, 900);
      });
      if (typeof rt.doctype_subscribe === 'function') rt.doctype_subscribe('Workflow Action');
    } catch (e) { /* realtime is optional */ }
  }
  loadAutomation = async () => {
    if (!this.api.loadAutomation) return;
    const r = await this.api.loadAutomation();
    this.setState({ rules: r.rules, recurring: r.recurring, canManageRules: r.canManageRules, recRoles: r.roles || [] }, () => { if (this.syncRecRoles) this.syncRecRoles(); });
  };
  async load(keepSel) {
    /* request token: a slower earlier response must not overwrite a newer folder/filter */
    const seq = this.loadSeq = (this.loadSeq || 0) + 1;
    const { folder, quick, search, label, sort } = this.state;
    const [rows, cnt] = await Promise.all([
      this.api.listTodos({ folder, quick, search, label, sort }),
      this.api.getCounts(),
    ]);
    if (seq !== this.loadSeq) return;
    const tasks = Array.isArray(rows) ? rows : [];
    const counts = cnt || {};
    let sel = keepSel || this.state.sel;
    if (!tasks.find((t) => t.name === sel)) sel = tasks.length ? tasks[0].name : null;
    this.setState({ tasks, counts, sel, loading: false, showEvents: false });
    if (sel) this.markRead(sel);
  }

  /* ---------- screens ---------- */
  goScreen = (id) => {
    this.setState({ screen: id, notifsOpen: false, mobileScreen: 'list' });
    if (id === 'day') this.loadDay();
    if (id === 'stats') this.loadStats();
    if (id === 'templates') this.loadTemplates();
  };
  async loadDay() { this.setState({ day: await this.api.getDayPlan() }); }
  statsQ() { return { period: '30d', date_from: '', date_to: '', scope: 'me', user: '', ...(this.state.statsQ || {}) }; }
  setStatsQ = (patch) => this.setState((st) => ({ statsQ: { ...this.statsQ(), ...patch }, statsLoading: true }), () => this.loadStats());
  async loadStats() {
    const q = this.statsQ();
    const key = JSON.stringify(q);
    this.setState({ statsLoading: true });
    const res = await this.api.getAnalytics(q);
    if (JSON.stringify(this.statsQ()) !== key) return;
    this.setState({ stats: res || null, statsLoading: false });
  }
  refreshAfterChange() {
    if (this.state.screen === 'day') this.loadDay();
    if (this.state.screen === 'stats') this.loadStats();
    this.loadAux();
    this.loadTemplates();
  }
});

/* notification sounds (Web Audio, no files): a soft two-tone chime, a lighter single tone for
   replies/mentions. The AudioContext is created/resumed on the first user gesture (autoplay
   policy); at most one sound per 2 s; on by default, "todobox_sounds" = '0' turns it off. */
window.TodoboxSound = window.TodoboxSound || (() => {
  const KEY = 'todobox_sounds', GAP = 2000;
  let ctx = null, last = 0;
  const AC = window.AudioContext || window.webkitAudioContext;
  const enabled = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };
  const setEnabled = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* private mode */ } };
  const unlock = () => {
    if (!AC) return;
    try {
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));
  const tone = (freq, at, dur, peak) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(at); o.stop(at + dur + 0.02);
  };
  /* kind: 'chime' (assignment, workflow, other) | 'mention' (reply/comment/mention); force skips the on/off check */
  const play = (kind, force) => {
    if (!force && !enabled()) return;
    if (!ctx || ctx.state !== 'running') return; /* not unlocked yet: stay silent */
    const now = Date.now();
    if (now - last < GAP) return;
    last = now;
    try {
      const t = ctx.currentTime + 0.01;
      if (kind === 'mention') { tone(1046.5, t, 0.22, 0.07); tone(1318.5, t + 0.07, 0.3, 0.05); }
      else { tone(659.25, t, 0.35, 0.09); tone(987.77, t + 0.13, 0.5, 0.08); } /* E5 → B5 */
    } catch (e) { /* audio is optional */ }
  };
  return { play, enabled, setEnabled, unlock };
})();
