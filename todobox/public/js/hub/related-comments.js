/* ToDoBox: comments of a task linked to a document. Its conversation also shows the document's comments and
   those of the other tasks linked to it, in time order (those of other tasks look different), and "Comment"
   in the composer comments on the document itself (services/related_comments.py, render.js, tasks.js send). */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /** Load (or refresh) a task's related comments; stale-while-revalidate after 30s */
  loadRelated = async (name, force) => {
    this._relReq = this._relReq || {};
    const cur = (this.state.relComments || {})[name];
    if (this._relReq[name] || (!force && cur && Date.now() - (cur._at || 0) < 30000)) return;
    this._relReq[name] = true;
    let r = null;
    try { r = await this.api.getRelatedComments(name); } finally { this._relReq[name] = false; }
    const U = (this.api && this.api.USERS) || {};
    Object.entries((r && r.users) || {}).forEach(([id, u]) => { if (!U[id]) U[id] = u; });
    const entry = { items: (r && r.items) || (cur ? cur.items : []), _at: Date.now() };
    this.setState((st) => ({ relComments: { ...(st.relComments || {}), [name]: entry } }));
  };

  /** null when the task has no linked document the user can read; else {items} to merge into its thread */
  relatedFor(sel) {
    if (!sel || !sel.reference_name || !this.api || !this.api.getRelatedComments) return null;
    const acts = (this.state.docActs || {})[sel.name];
    const rd = (this.state.refDocs || {})[sel.name];
    if (!acts || !acts.readable || (rd && rd.readable === 0)) return null;
    const cur = (this.state.relComments || {})[sel.name];
    if (!cur || Date.now() - (cur._at || 0) > 30000) this.loadRelated(sel.name);
    return { items: cur ? cur.items : [], loaded: !!cur };
  }

  /** "Comment" goes to the linked document (whose own Comments tab is then hidden: they are in the thread) */
  docCommentOn(sel) {
    return !!this.relatedFor(sel);
  }

  /** "Comment" on a task linked to a document: a comment on the document, written from this task */
  sendDocComment = async (name, txt, draft, mentions, alsoComplete) => {
    this._sending = true;
    this.setState({ sending: true, draft: '', mention: null });
    const r = await this.api.addReferenceComment(name, txt, mentions);
    this._sending = false;
    if (!r) {
      this.setState((st) => ({ sending: false, draft: st.draft ? draft + '\n' + st.draft : draft }));
      this.toast(__('Could not send, please try again'));
      return;
    }
    this.mentionReset();
    this.setState({ sending: false });
    this.toast(__('Comment added to the document'));
    if ((this.state.refDocs || {})[name]) this.loadRefDetail(name, true);
    if (alsoComplete) { this.complete(name); return; }
    await this.loadRelated(name, true);
    if (this.state.sel === name) this.scrollThreadEnd();
  };
});
