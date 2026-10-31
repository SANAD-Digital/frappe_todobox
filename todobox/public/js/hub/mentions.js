/* ToDoBox: @mentions in the task composer (reply / comment) and the document comment and decision note boxes (Required actions)
   - typing "@" (at the start or after a space) opens a user list under the textarea: the task's sender,
     assignee and CC first; letters after it search everyone
   - ↑/↓ move, Enter/Tab pick, Esc closes (without reaching the global shortcuts), click picks
   - picking inserts "@Full Name " and remembers label → email; on send, the emails whose "@Full Name"
     is still in the text go to the server, which notifies them (and adds them to CC so they can open the task) */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  composerRef = (el) => { this.composerEl = el; };
  wfCommentRef = (el) => { this.wfCommentEl = el; };
  wfNoteRef = (el) => { this.wfNoteEl = el; };
  /** The box the popup belongs to: the task composer, or the document comment box */
  mentionBox() {
    if (this.mentionCtx === 'note') return { el: this.wfNoteEl, key: 'wfNote', extra: { wfNoteError: false } };
    return this.mentionCtx === 'wf' ? { el: this.wfCommentEl, key: 'wfCommentDraft', extra: {} } : { el: this.composerEl, key: 'draft', extra: { composerOpen: true } };
  }
  mentionMap = {};

  /** Lowercase + Arabic folding (diacritics, tatweel, alef/yaa/taa-marbuta variants) for matching */
  mentionFold(t) {
    return String(t || '').toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  }

  /** The open task's sender, assignee and CC (not me): the list shown for a bare "@" */
  mentionParties() {
    const U = this.api.USERS, me = this.api.ME;
    let ids;
    if (this.mentionCtx === 'wf' || this.mentionCtx === 'note') {
      /* the document's creator, those who moved it and those who commented on it */
      const name = this.state.selDoc || this.state.wfSel;
      const d = this.W && (this.W.DOCS || []).find((x) => x.name === name);
      if (!d) return [];
      ids = [d.owner, ...(d.trail || []).map((r) => r[1]), ...(d.comments || []).map((r) => r[0])];
    } else {
      const t = this.selTask && this.selTask();
      if (!t) return [];
      ids = [t.assigned_by, t.allocated_to, ...(t.cc_users || [])];
    }
    return [...new Set(ids)].filter((id) => id && id !== me && id !== 'Guest')
      .map((id) => ({ id, name: (U[id] || {}).name || id, initials: (U[id] || {}).initials || '?' }));
  }

  /** Up to 8 users (not me, not Guest) whose name words start with every query word, or whose email starts with it */
  mentionMatches(q) {
    const U = this.api.USERS, me = this.api.ME;
    const words = this.mentionFold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return this.mentionParties();
    const whole = words.join(' ');
    const out = [];
    for (const id of Object.keys(U)) {
      if (id === me || id === 'Guest') continue;
      const u = U[id] || {};
      const name = this.mentionFold(u.name || id);
      const nameWords = name.split(/\s+/).filter(Boolean);
      const byName = words.every((w) => nameWords.some((nw) => nw.startsWith(w)));
      const byMail = words.length === 1 && this.mentionFold(id).startsWith(whole);
      if (!byName && !byMail) continue;
      /* rank: full-name prefix, then first-name prefix, then any word, then email */
      const rank = name.startsWith(whole) ? 0 : byName && nameWords[0].startsWith(words[0]) ? 1 : byName ? 2 : 3;
      out.push({ id, name: u.name || id, initials: u.initials || '?', rank });
    }
    return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, 8);
  }

  /** The "@query" right before the caret, or null. The @ must be at the start or after whitespace. */
  mentionQueryAt(value, caret) {
    const before = value.slice(0, caret);
    const m = /(^|\s)@((?:[^\s@][^\n@]{0,40})?)$/.exec(before);
    if (!m) return null;
    const q = m[2];
    if (q && (/\s$/.test(q) || q.split(/\s+/).length > 3)) return null;
    return { start: caret - q.length - 1, q };
  }

  mentionDetect = (el) => {
    if (!el) return;
    const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    const hit = el.selectionStart === el.selectionEnd ? this.mentionQueryAt(el.value, caret) : null;
    const list = hit ? this.mentionMatches(hit.q) : [];
    if (!hit || !list.length || this._mentionDismissed === hit.start) {
      if (this.state.mention) this.setState({ mention: null });
      return;
    }
    this._mentionDismissed = null;
    const cur = this.state.mention;
    let above = cur ? cur.above : false;
    if (!cur) {
      try { const r = el.getBoundingClientRect(); above = window.innerHeight - r.bottom < Math.min(320, list.length * 44 + 24) && r.top > window.innerHeight - r.bottom; } catch (e) { /* */ }
    }
    const keep = cur && cur.start === hit.start && list.some((u) => cur.list[cur.idx] && u.id === cur.list[cur.idx].id);
    const idx = keep ? list.findIndex((u) => u.id === cur.list[cur.idx].id) : 0;
    this.setState({ mention: { start: hit.start, end: caret, q: hit.q, list, idx, above } });
  };

  onComposerInput = (e) => {
    const el = e.target;
    this.mentionCtx = 'task';
    this.setState({ draft: el.value }, () => this.mentionDetect(el));
  };

  onComposerKey = (e) => { if (!this.mentionKey(e)) this.onComposerEnter(e); };

  onWfCommentInput = (e) => {
    const el = e.target;
    this.mentionCtx = 'wf';
    this.setState({ wfCommentDraft: el.value }, () => this.mentionDetect(el));
  };
  onWfNoteInput = (e) => {
    const el = e.target;
    this.mentionCtx = 'note';
    this.setState({ wfNote: el.value, wfNoteError: false }, () => this.mentionDetect(el));
  };
  onWfNoteCaret = (e) => { this.mentionCtx = 'note'; this.mentionDetect(e.target); };
  onWfCommentCaret = (e) => { this.mentionCtx = 'wf'; this.mentionDetect(e.target); };

  /** The open popup takes the key: true when it did */
  mentionKey(e) {
    const m = this.state.mention;
    if (!m || !m.list.length) return false;
    const stop = () => { e.preventDefault(); e.stopPropagation(); if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation(); };
    if (e.key === 'ArrowDown') { stop(); this.setState({ mention: { ...m, idx: (m.idx + 1) % m.list.length } }); }
    else if (e.key === 'ArrowUp') { stop(); this.setState({ mention: { ...m, idx: (m.idx - 1 + m.list.length) % m.list.length } }); }
    else if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing) || (e.key === 'Tab' && !e.shiftKey)) { stop(); this.mentionPick(m.list[m.idx].id); }
    else if (e.key === 'Escape') { stop(); this._mentionDismissed = m.start; this.setState({ mention: null }); }
    else return false;
    return true;
  }

  onComposerCaret = (e) => { this.mentionCtx = 'task'; this.mentionDetect(e.target); };
  onComposerBlur = () => { if (this.state.mention) this.setState({ mention: null }); };

  mentionPick = (id) => {
    const m = this.state.mention, { el, key, extra } = this.mentionBox();
    const u = this.api.USERS[id];
    if (!m || !u) return;
    const label = u.name || id;
    const v = this.state[key] || '';
    const ins = '@' + label + ' ';
    const draft = v.slice(0, m.start) + ins + v.slice(m.end).replace(/^ /, '');
    this.mentionMap = { ...this.mentionMap, [label]: id };
    const pos = m.start + ins.length;
    this.setState({ [key]: draft, mention: null, ...extra }, () => {
      try { if (el) { el.focus(); el.setSelectionRange(pos, pos); } } catch (e) { /* */ }
    });
  };

  /** The @ button: insert "@" at the caret (with a leading space when needed) and focus the composer */
  mentionStart = () => { this.mentionCtx = 'task'; this.mentionInsert(); };
  mentionStartWf = () => { this.mentionCtx = 'wf'; this.mentionInsert(); };
  mentionInsert() {
    const { el, key, extra } = this.mentionBox(), v = this.state[key] || '';
    const a = el && el.selectionStart != null ? el.selectionStart : v.length;
    const b = el && el.selectionEnd != null ? el.selectionEnd : a;
    const lead = a > 0 && !/\s/.test(v[a - 1]) ? ' ' : '';
    const draft = v.slice(0, a) + lead + '@' + v.slice(b);
    const pos = a + lead.length + 1;
    this._mentionDismissed = null;
    this.setState({ [key]: draft, mention: null, ...extra }, () => {
      try { if (el) { el.focus(); el.setSelectionRange(pos, pos); } } catch (e) { /* */ }
      this.mentionDetect(el);
    });
  }

  /** Emails of the picked mentions still present in the text (as "@Full Name") */
  mentionEmails(txt) {
    const out = [];
    for (const [label, id] of Object.entries(this.mentionMap)) {
      if (txt.includes('@' + label) && !out.includes(id)) out.push(id);
    }
    return out;
  }
  mentionReset() { this.mentionMap = {}; this._mentionDismissed = null; }

  mentionVals() {
    const m = this.state.mention;
    const open = !!(m && m.list.length);
    const optId = (i) => 'tt-mention-opt-' + i;
    return {
      composerRef: this.composerRef,
      onDraft: this.onComposerInput, onComposerKey: this.onComposerKey,
      onComposerCaret: this.onComposerCaret, onComposerBlur: this.onComposerBlur,
      mention: this.mentionStart,
      mentionOpen: open && this.mentionCtx !== 'wf' && this.mentionCtx !== 'note',
      wfNoteMentionOpen: open && this.mentionCtx === 'note',
      wfNoteRef: this.wfNoteRef, onWfNoteCaret: this.onWfNoteCaret,
      wfMentionOpen: open && this.mentionCtx === 'wf',
      wfCommentRef: this.wfCommentRef, onWfCommentCaret: this.onWfCommentCaret, wfMention: this.mentionStartWf,
      mentionExpanded: open ? 'true' : 'false',
      mentionActive: open ? optId(m.idx) : '',
      mentionLabel: __('Mention a colleague'),
      mentionPop: 'position:absolute;inset-inline-start:0;z-index:40;width:min(320px, 100%);max-height:320px;overflow-y:auto;padding:5px;margin:0;list-style:none;' +
        'background:var(--panel);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);' +
        (open && m.above ? 'bottom:calc(100% + 6px);' : 'top:calc(100% + 6px);'),
      mentionList: !open ? [] : m.list.map((u, i) => {
        const on = i === m.idx;
        return {
          id: optId(i), name: u.name, sub: u.id, initials: u.initials, avatar: this.ava(u.id, 26),
          selected: on ? 'true' : 'false',
          style: 'display:flex;align-items:center;gap:9px;min-height:40px;padding:5px 9px;border-radius:8px;cursor:pointer;color:var(--fg);text-align:start;' +
            'background:' + (on ? 'var(--primary-soft)' : 'transparent') + ';',
          onDown: (e) => { e.preventDefault(); this.mentionPick(u.id); },
          onHover: () => { const cur = this.state.mention; if (cur && cur.idx !== i) this.setState({ mention: { ...cur, idx: i } }); },
        };
      }),
    };
  }
});
