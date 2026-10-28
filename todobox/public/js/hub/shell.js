/* ToDoBox: app-shell behaviour (design only, no data/API logic).
   - .sidebar-resize-handle: drag / keyboard resize of the desktop sidebar (200–360px),
     double-click resets; width persisted in localStorage (the collapsed state is
     persisted by helpers.js → setNavCollapsed). RTL drags are mirrored.
   - Escape closes the phone drawer (clicks its backdrop).
   - mirrors html[data-dark] to Frappe's html[data-theme] so desk-style selectors work.
   - micro-interactions: completion "check pop + strike", checklist / checkbox pop.
   - Ctrl/Cmd+S in any popup (dialog, drawer, inline form) runs its primary action.
   Everything is event delegation on document; React-owned markup is never replaced. */
(() => {
  const KEY = 'todobox_nav_w', MIN = 200, MAX = 360, STEP = 16;
  const root = document.documentElement;
  const clamp = (w) => Math.max(MIN, Math.min(MAX, Math.round(w)));
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { if (v == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(v)); } catch (e) { /* private mode */ } },
  };
  const setWidth = (w, persist) => {
    if (w == null) { root.style.removeProperty('--nav-w'); if (persist) store.set(null); return; }
    const v = clamp(w);
    root.style.setProperty('--nav-w', v + 'px');
    if (persist) store.set(v);
  };
  /* restore before first paint of the app */
  const saved = parseInt(store.get(), 10);
  if (saved) setWidth(saved, false);

  const isRtl = (el) => ((el && el.closest && el.closest('[dir]')) || root).getAttribute('dir') === 'rtl';
  const navWidth = () => { const n = document.getElementById('tt-nav'); return n ? n.getBoundingClientRect().width : 240; };
  const collapsed = (h) => { const w = h.closest('.tt-nav-wrap'); return !!(w && w.getAttribute('data-collapsed') === '1'); };

  /* ---- drag ---- */
  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const h = e.target && e.target.closest && e.target.closest('.sidebar-resize-handle');
    if (!h || e.button !== 0 || collapsed(h)) return;
    e.preventDefault();
    drag = { h, x: e.clientX, w: navWidth(), rtl: isRtl(h), id: e.pointerId };
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    root.classList.add('tt-resizing');
    h.classList.add('is-dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) * (drag.rtl ? -1 : 1);
    setWidth(drag.w + dx, false);
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    root.classList.remove('tt-resizing');
    drag.h.classList.remove('is-dragging');
    drag = null;
    setWidth(navWidth(), true);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener('dblclick', (e) => {
    if (e.target && e.target.closest && e.target.closest('.sidebar-resize-handle')) setWidth(null, true);
  });

  /* ---- keyboard: arrows resize, Home/End jump to min/max, Enter resets; Escape closes the drawer ---- */
  document.addEventListener('keydown', (e) => {
    const h = e.target && e.target.closest && e.target.closest('.sidebar-resize-handle');
    if (h && !collapsed(h)) {
      const sign = isRtl(h) ? -1 : 1;
      let w = null;
      if (e.key === 'ArrowRight') w = navWidth() + STEP * sign;
      else if (e.key === 'ArrowLeft') w = navWidth() - STEP * sign;
      else if (e.key === 'Home') w = MIN;
      else if (e.key === 'End') w = MAX;
      else if (e.key === 'Enter') { e.preventDefault(); setWidth(null, true); return; }
      if (w != null) { e.preventDefault(); setWidth(w, true); }
      return;
    }
    if (e.key === 'Escape') {
      const b = document.querySelector('.tt-nav-backdrop');
      if (b) { b.click(); const t = document.querySelector('.sidebar-toggle-btn'); if (t) t.focus(); }
    }
  });

  /* ---- Frappe dark-mode attribute ---- */
  const syncTheme = () => root.setAttribute('data-theme', root.getAttribute('data-dark') === '1' ? 'dark' : 'light');
  syncTheme();
  try { new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-dark'] }); } catch (e) { /* no observer */ }

  /* ---- micro-interactions (class toggles only; the click still reaches React) ---- */
  const flash = (el, cls, ms) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; /* restart the animation */
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  };
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const done = t.closest('.tt-row-act[data-act="complete"]');
    if (done) {
      flash(done, 'is-popping', 500);
      flash(done.closest('.tt-row, .tt-day-row'), 'is-completing', 900);
      return;
    }
  }, true);

  /* ---- Ctrl/Cmd+S: the primary action of the popup in use ---- */
  const PRIMARY = '.tb-btn-primary, .tmc-send, .tt-btn-p, .tm-msg-ok';
  const POPUPS = '.tm-msg, .tb-confirm-dlg, .tb-dlg, .tt-sv-editor, .tmc, [role="dialog"], [role="alertdialog"]';
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const usable = (b) => shown(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  /** the innermost inline form or popup around the focus, else the popup on top */
  const scopeOf = (focus) => {
    const near = focus && focus.closest && (focus.closest('.tm-fx-form') || focus.closest(POPUPS));
    if (near && shown(near)) return near;
    const all = [...document.querySelectorAll(POPUPS)].filter(shown);
    const z = (el) => { let n = el; while (n && n !== document.body) { const v = parseInt(getComputedStyle(n).zIndex, 10); if (!isNaN(v)) return v; n = n.parentElement; } return 0; };
    return all.sort((a, b) => z(a) - z(b)).pop() || null;
  };
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 's') return;
    const scope = scopeOf(document.activeElement);
    if (!scope) return;
    /* in a popup the browser's "save page" never makes sense */
    e.preventDefault();
    e.stopPropagation();
    const btn = [...scope.querySelectorAll(PRIMARY)].filter(usable).pop();
    if (!btn) return;
    /* let a Frappe control commit what was just typed (it applies on change/blur) before the click */
    const a = document.activeElement;
    if (a && a !== document.body && a.blur && !(a.isContentEditable)) a.blur();
    setTimeout(() => btn.click(), 80);
  }, true);
})();
