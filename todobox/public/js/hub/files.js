/* ToDoBox: attachment viewer (images/PDF/video/audio/text) */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /** Viewer type by file extension */
  fileKind(name, url) {
    const ext = String(name || url || '').split('?')[0].split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'm4a', 'aac', 'oga'].includes(ext)) return 'audio';
    if (['txt', 'csv', 'json', 'md', 'log', 'xml'].includes(ext)) return 'text';
    return 'other';
  }

  /** files: [{name, url}]; opens the preview at item index */
  openFilePreview = (files, index) => {
    const list = (files || []).filter((f) => f && f.url);
    if (!list.length) { this.toast(__('This file cannot be previewed')); return; }
    clearTimeout(this._pvT);
    this.setState({ filePv: { list, i: Math.max(0, Math.min(index || 0, list.length - 1)) } });
  };

  /* animated close: keep the dialog briefly until the exit animation ends */
  closeFilePreview = () => {
    if (!this.state.filePv || this.state.filePv.closing) return;
    this.setState((st) => ({ filePv: st.filePv ? { ...st.filePv, closing: true } : null }));
    clearTimeout(this._pvT);
    this._pvT = setTimeout(() => this.setState({ filePv: null }), 170);
  };

  stepFilePreview = (dir) => this.setState((st) => {
    const pv = st.filePv; if (!pv) return null;
    return { filePv: { ...pv, i: (pv.i + dir + pv.list.length) % pv.list.length } };
  });

  filePvKey(e) {
    if (!this.state.filePv) return false;
    const rtl = (window.TT_DIR || 'rtl') === 'rtl';
    if (this.state.filePv.closing) return true;
    if (e.key === 'Escape') { this.closeFilePreview(); return true; }
    if (e.key === 'ArrowRight') { this.stepFilePreview(rtl ? -1 : 1); return true; }
    if (e.key === 'ArrowLeft') { this.stepFilePreview(rtl ? 1 : -1); return true; }
    return true;
  }

  filePvVals() {
    const pv = this.state.filePv;
    if (!pv) return { filePvOpen: false };
    const f = pv.list[pv.i];
    const kind = this.fileKind(f.name, f.url);
    const src = f.url;
    return {
      filePvOpen: true,
      filePvBackdrop: 'position:fixed;inset:0;background:rgba(12,14,18,.72);z-index:60;animation:' + (pv.closing ? 'tt-fadeout .17s ease-in forwards' : 'tt-fadein .2s ease-out') + ';',
      filePvAnim: 'animation:' + (pv.closing ? 'tt-pv-out .17s ease-in forwards' : 'tt-pv-in .24s cubic-bezier(.2,.9,.3,1)') + ';',
      filePvName: f.name || src,
      filePvCount: pv.list.length > 1 ? (pv.i + 1) + ' / ' + pv.list.length : '',
      filePvMulti: pv.list.length > 1,
      filePvUrl: src,
      filePvImage: kind === 'image', filePvPdf: kind === 'pdf', filePvVideo: kind === 'video',
      filePvAudio: kind === 'audio', filePvText: kind === 'text', filePvOther: kind === 'other',
      filePvNoPreview: __('No preview available for this file type'),
      filePvClose: this.closeFilePreview,
      filePvPrev: () => this.stepFilePreview(-1),
      filePvNext: () => this.stepFilePreview(1),
      filePvOpenTab: () => { window.open(src, '_blank'); },
    };
  }
});
