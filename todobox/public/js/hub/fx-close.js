/* ToDoBox: "closed" animation — the list row slides out sideways and fades, then the rows below
   glide up into its place. The slide runs on a clone in a fixed overlay (the real row is hidden),
   so it never touches state; the glide is a FLIP on the rows after re-render.
   RTL-aware; reduced-motion → a simple fade, no glide. */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /** true while `name` is animating out (guards double-complete during the short hold) */
  fxClosing(name) { return !!(this._fxClosing && this._fxClosing[name]); }

  /** Animate the visible row of `name` out. Call BEFORE the item leaves state.
      Resolves after a short hold (0 when nothing to animate); the rows below glide up afterwards. */
  fxClose(name) {
    const cap = this.fxCloseCapture(name);
    if (!cap) return Promise.resolve();
    const hold = this.fxCloseFly(cap, true);
    if (!hold) { cap.row.style.visibility = ''; return Promise.resolve(); }
    this._fxClosing = this._fxClosing || {};
    this._fxClosing[name] = 1;
    /* un-hide just before the item leaves state, in case the renderer reuses the node */
    return new Promise((res) => setTimeout(() => { delete this._fxClosing[name]; cap.row.style.visibility = ''; res(); }, hold));
  }

  /** Snapshot the on-screen list row (a clone + its rect) and the positions of the other rows. null when not visible. */
  fxCloseCapture(name) {
    try {
      if (!name || typeof document === 'undefined') return null;
      const key = window.CSS && CSS.escape ? CSS.escape(String(name)) : String(name).replace(/["\\]/g, '\\$&');
      const vh = window.innerHeight || 0;
      const row = Array.from(document.querySelectorAll('[data-row="' + key + '"]')).find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
      });
      if (!row || !row.animate) return null;
      const cs = getComputedStyle(row);
      const clone = row.cloneNode(true);
      clone.removeAttribute('data-row');
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      const tops = {};
      document.querySelectorAll('[data-row]').forEach((el) => {
        const n = el.getAttribute('data-row');
        if (n !== String(name) && el.offsetParent) tops[n] = el.getBoundingClientRect().top;
      });
      const bg = cs.backgroundColor;
      return { row, clone, tops, rect: row.getBoundingClientRect(), rtl: cs.direction === 'rtl', radius: cs.borderRadius,
        bg: bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' ? bg : '' };
    } catch (e) { return null; }
  }

  /** Slides the row clone out; returns how long the caller should keep the item in the list (ms).
      holdRow: the item is still in state (hide the real row, glide after the hold); else it already left. */
  fxCloseFly(cap, holdRow) {
    try {
      const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const { rect, rtl } = cap;
      /* clip to the list pane, so the row never slides over the task view next to it */
      const clip = this.fxCloseClip(cap.row);
      const layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, { position: 'fixed', left: clip.left + 'px', top: clip.top + 'px', width: clip.width + 'px',
        height: clip.height + 'px', overflow: 'hidden', pointerEvents: 'none', zIndex: '60' });
      const ghost = cap.clone;
      ghost.className += ' tt-fx-row';
      Object.assign(ghost.style, {
        position: 'absolute', left: (rect.left - clip.left) + 'px', top: (rect.top - clip.top) + 'px', width: rect.width + 'px', height: rect.height + 'px',
        margin: '0', transform: 'none', transition: 'none', boxSizing: 'border-box', pointerEvents: 'none',
        borderRadius: cap.radius || '8px',
      });
      if (cap.bg) ghost.style.backgroundColor = cap.bg;
      layer.appendChild(ghost);
      document.body.appendChild(layer);
      if (holdRow && cap.row.isConnected) cap.row.style.visibility = 'hidden';
      const drop = () => { if (layer.parentNode) layer.parentNode.removeChild(layer); };

      if (reduce) {
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' });
        setTimeout(drop, 220);
        return 0;
      }
      /* slide toward the inline-end edge (right in LTR, left in RTL) */
      const dx = (rtl ? -1 : 1) * Math.min(rect.width * 0.6, 360);
      ghost.animate([
        { transform: 'translateX(0)', opacity: 1 },
        { transform: 'translateX(' + dx + 'px)', opacity: 0 },
      ], { duration: 260, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
      setTimeout(drop, 280);
      /* after the item leaves state and the list re-renders: rows below glide up from their old place */
      setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => this.fxCloseGlide(cap.tops))), holdRow ? 230 : 0);
      return holdRow ? 220 : 0;
    } catch (e) { return 0; }
  }

  /** Rect of the row's list pane (.tt-list-pane, else the nearest scrolling ancestor; fallback: the row itself) */
  fxCloseClip(row) {
    const pane = row.closest('.tt-list-pane');
    if (pane) return pane.getBoundingClientRect();
    for (let el = row.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el.getBoundingClientRect();
    }
    return row.getBoundingClientRect();
  }

  /** FLIP: animate rows that moved up from their previous position to the new one */
  fxCloseGlide(tops) {
    try {
      document.querySelectorAll('[data-row]').forEach((el) => {
        const was = tops[el.getAttribute('data-row')];
        if (was == null || !el.animate) return;
        const dy = was - el.getBoundingClientRect().top;
        if (dy <= 0.5 || dy > 400) return;
        el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'translateY(0)' }],
          { duration: 360, easing: 'cubic-bezier(.2, .7, .3, 1)' });
      });
    } catch (e) { /* cosmetic only */ }
  }
});
