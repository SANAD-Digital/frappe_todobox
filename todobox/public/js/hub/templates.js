/* ToDoBox: task templates */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /* ---------- task templates ---------- */
  loadTemplates = async () => this.setState({ templates: (await this.api.loadTemplates()) || [] });
  tplDraftOf = (t) => ({
    id: t ? t.id : null, label: t ? t.label : '', subject: t ? t.subject || '' : '', body: t ? t.body || '' : '',
    priority: t ? t.priority || 'Medium' : 'Medium',
    enabled: t ? t.enabled !== false : true, checklist: t ? (t.checklist || []).slice() : [],
  });
  pickTemplate = (t) => this.setState({ tplSel: t ? t.id : '__new', tplDraft: this.tplDraftOf(t), tplNewStep: '', tplConfirmDel: false });
  patchTpl = (patch) => this.setState((st) => ({ tplDraft: { ...st.tplDraft, ...patch } }));
  patchTplSteps = (fn) => this.setState((st) => ({ tplDraft: { ...st.tplDraft, checklist: fn(st.tplDraft.checklist) } }));
  addTplStep = () => {
    const txt = (this.state.tplNewStep || '').trim();
    if (!txt || !this.state.tplDraft) return;
    if (this.state.tplDraft.checklist.some((c) => c.trim() === txt)) { this.toast(__('This step already exists in the template')); return; }
    this.patchTplSteps((l) => [...l, txt]);
    this.setState({ tplNewStep: '' });
  };
  /* reorder steps by drag and drop (Pointer Events: mouse and touch) from the step handle */
  tplDragStart = (i, e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { }
    this.setState({ tplDrag: { from: i, over: i } });
  };
  tplDragMove = (e) => {
    const dr = this.state.tplDrag;
    if (!dr) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el && el.closest ? el.closest('[data-tpl-step]') : null;
    if (!row) return;
    const over = parseInt(row.getAttribute('data-tpl-step'), 10);
    if (!isNaN(over) && over !== dr.over) this.setState({ tplDrag: { ...dr, over } });
  };
  tplDragEnd = () => {
    const dr = this.state.tplDrag;
    if (!dr) return;
    this.setState({ tplDrag: null });
    if (dr.over === dr.from) return;
    this.patchTplSteps((l) => {
      const n = l.slice();
      const [it] = n.splice(dr.from, 1);
      n.splice(dr.over, 0, it);
      return n;
    });
  };
  /* ---------- Frappe controls of the template editor (fxSlot in compose.js) ---------- */
  /* mounted when the editor shows a draft; picking another template keeps them mounted and
     tplSync (componentDidUpdate) pushes the draft's values into them */
  tplFx() {
    const X = () => window.TMControls, d = () => this.state.tplDraft || {};
    const S = (key, make) => this.fxSlot(key, make);
    return {
      label: S('tplLabel', (el) => new (X().Data)(el, { value: d().label || '', inputId: 'tm-tpl-name', label: __('Template name'), reqd: 1, maxlength: 140,
        onChange: (v) => this.patchTpl({ label: v || '' }) })),
      subject: S('tplSubject', (el) => new (X().Data)(el, { value: d().subject || '', inputId: 'tm-tpl-subject', label: __('Task subject'), maxlength: 140,
        description: __('The title the task is created with'),
        onChange: (v) => this.patchTpl({ subject: v || '' }) })),
      body: S('tplBody', (el) => new (X().TextEditor)(el, { value: d().body || '', inputId: 'tm-tpl-description', label: __('Description'),
        onChange: (v) => this.patchTpl({ body: v || '' }) })),
      priority: S('tplPriority', (el) => new (X().Select)(el, { value: d().priority || 'Medium', inputId: 'tm-tpl-priority', label: __('Priority'),
        options: [{ value: 'High', label: __('High') }, { value: 'Medium', label: __('Medium') }, { value: 'Low', label: __('Low') }],
        onChange: (v) => this.patchTpl({ priority: v || 'Medium' }) })),
      enabled: S('tplEnabled', (el) => new (X().Field)(el, { value: d().enabled === false ? 0 : 1, inputId: 'tm-tpl-enabled', label: __('Enabled'),
        description: __('Enabled templates appear when creating a task and in the task checklist'),
        onChange: (v) => this.patchTpl({ enabled: !!v }) }, { fieldtype: 'Check', fieldname: 'enabled' })),
    };
  }
  tplSync() {
    const fx = this._fx, d = this.state.tplDraft;
    if (!fx || !d) return;
    const set = (k, v) => { if (fx[k]) fx[k].set_value(v); };
    set('tplLabel', d.label || ''); set('tplSubject', d.subject || ''); set('tplBody', d.body || '');
    set('tplPriority', d.priority || 'Medium'); set('tplEnabled', d.enabled === false ? 0 : 1);
  }
  componentDidUpdate(pp, ps, snap) {
    if (super.componentDidUpdate) super.componentDidUpdate(pp, ps, snap);
    this.tplSync();
  }
  saveTemplate = async () => {
    const d = this.state.tplDraft;
    if (!d || this.state.tplBusy) return;
    if (!d.label.trim()) { this.toast(__('Enter a template name')); this.fxInvalid('tplLabel'); return; }
    this.setState({ tplBusy: true });
    const saved = await this.api.saveTemplate({ ...d, checklist: d.checklist.map((c) => c.trim()).filter(Boolean) });
    this.setState({ tplBusy: false });
    if (!saved) { this.toast(__('Could not save the template')); return; }
    await this.loadTemplates();
    this.setState({ tplSel: saved.id, tplDraft: this.tplDraftOf(saved), tplConfirmDel: false });
    this.toast(__('Template "{0}" saved', [saved.label]));
  };
  deleteTemplate = async () => {
    const d = this.state.tplDraft;
    if (!d || !d.id || this.state.tplBusy) return;
    if (!this.state.tplConfirmDel) { this.setState({ tplConfirmDel: true }); return; }
    this.setState({ tplBusy: true });
    const res = await this.api.deleteTemplate(d.id);
    this.setState({ tplBusy: false, tplConfirmDel: false });
    if (!res) return;
    await this.loadTemplates();
    this.setState({ tplSel: null, tplDraft: null });
    this.toast(__('Template "{0}" deleted', [d.label]));
  };
  composeFromTemplate = (t) => this.setState({
    compose: { to: [], cc: [], subject: t.subject || t.label, body: t.body || '', priority: t.priority || 'Medium', date: this.api.TODAY, ref: null, labels: [], checklist: (t.checklist || []).slice(), template: t.id, files: [] },
    composeChecklistOpen: true, composeCCOpen: false, notifsOpen: false,
  });

  /* task templates screen values */
  templateVals(s, isDesktop) {
    const d = s.tplDraft;
    const q = (s.tplQuery || '').trim();
    const prioLabel = { High: __('High'), Medium: __('Medium'), Low: __('Low') };
    const prioTone = { High: 'var(--red)', Medium: 'var(--amber)', Low: 'var(--fg2)' };
    const rows = (s.templates || []).filter((t) => !q || (t.label + ' ' + (t.subject || '') + ' ' + (t.checklist || []).join(' ')).includes(q));
    const stacked = !isDesktop || s.narrow;
    const enabledCount = (s.templates || []).filter((t) => t.enabled !== false).length;
    return {
      screenTemplates: s.screen === 'templates',
      tplHeadline: (s.templates || []).length
        ? __('{0} templates · {1} enabled — enabled templates appear when creating a task and in the task checklist', [s.templates.length, enabledCount])
        : __('Create ready-made templates with checklists to use when creating tasks'),
      tplNew: () => this.pickTemplate(null),
      tplQuery: s.tplQuery || '', onTplQuery: (e) => this.setState({ tplQuery: e.target.value }),
      tplShowList: !stacked || !s.tplSel,
      tplShowEditor: !stacked || !!s.tplSel,
      tplListStyle: 'min-width:0;display:flex;flex-direction:column;min-height:0;background:var(--panel2);' +
        (stacked ? 'flex:1;' : 'flex:0 0 340px;border-inline-end:1px solid var(--line);'),
      tplEmpty: !rows.length,
      tplEmptyText: q ? __('No templates match "{0}"', [q]) : __('No templates yet — start with the "New Template" button.'),
      tplList: rows.map((t) => {
        const on = s.tplSel === t.id;
        const off = t.enabled === false;
        return {
          label: t.label, subject: t.subject || '—',
          prio: prioLabel[t.priority] || t.priority,
          prioStyle: 'flex:0 0 auto;padding:1px 7px;border-radius:99px;background:var(--sunk);font-size:10px;font-weight:600;color:' + (prioTone[t.priority] || 'var(--fg2)') + ';',
          steps: __('{0} steps', [(t.checklist || []).length]),
          state: off ? __('Disabled') : '',
          stateStyle: off ? 'margin-inline-start:auto;padding:1px 7px;border-radius:99px;background:var(--sunk);color:var(--fg3);' : 'display:none;',
          style: 'display:block;width:100%;padding:11px 12px;border-radius:10px;cursor:pointer;text-align:start;border:1px solid ' +
            (on ? 'var(--primary-line)' : 'var(--line)') + ';background:' + (on ? 'var(--primary-soft)' : 'var(--panel)') + ';opacity:' + (off ? '.62' : '1') + ';',
          onPick: () => this.pickTemplate(t),
        };
      }),
      tplHasDraft: !!d, tplNoDraft: !d,
      tplCanBack: stacked,
      tplCanClose: !stacked && !!d,
      tplBack: () => this.setState({ tplSel: null, tplDraft: null, tplConfirmDel: false }),
      tplTitle: d ? (d.id ? d.label || d.id : __('New Template')) : '',
      tplFx: this.tplFx(),
      tplStepCount: __('{0} steps', [d ? d.checklist.length : 0]),
      tplNoSteps: !!d && !d.checklist.length,
      tplSteps: (d ? d.checklist : []).map((c, i, all) => ({
        num: i + 1, label: c,
        onEdit: (e) => { const v = e.target.value; this.patchTplSteps((l) => l.map((x, n) => (n === i ? v : x))); },
        onDel: () => this.patchTplSteps((l) => l.filter((_, n) => n !== i)),
        idx: String(i),
        onGrab: (e) => this.tplDragStart(i, e), onGrabMove: this.tplDragMove, onGrabEnd: this.tplDragEnd,
        rowStyle: (() => {
          const dr = s.tplDrag;
          const base = 'display:flex;align-items:center;gap:6px;border-radius:9px;transition:box-shadow .1s;';
          if (!dr) return base;
          if (dr.from === i) return base + 'opacity:.45;';
          if (dr.over === i) return base + 'box-shadow:0 ' + (dr.over > dr.from ? '2px' : '-2px') + ' 0 0 var(--primary);';
          return base;
        })(),
        grabStyle: 'width:22px;height:30px;flex:0 0 22px;display:grid;place-items:center;border-radius:6px;cursor:' + (s.tplDrag ? 'grabbing' : 'grab') + ';color:var(--fg3);touch-action:none;user-select:none;',
      })),
      tplNewStep: s.tplNewStep || '', onTplNewStep: (e) => this.setState({ tplNewStep: e.target.value }),
      onTplStepKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addTplStep(); } },
      tplAddStep: this.addTplStep,
      tplSave: this.saveTemplate,
      tplSaveLabel: s.tplBusy ? __('Saving…') : d && d.id ? __('Save Changes') : __('Create Template'),
      tplSaveStyle: 'height:34px;padding:0 16px;background:var(--primary);color:var(--primary-ink);border:0;border-radius:99px;cursor:pointer;font-size:13px;font-weight:600;opacity:' + (s.tplBusy ? '.6' : '1') + ';',
      tplCanUse: !!(d && d.id),
      tplUse: () => d && this.composeFromTemplate(d),
      tplCanDelete: !!(d && d.id),
      tplDelete: this.deleteTemplate,
      tplDeleteLabel: s.tplConfirmDel ? __('Confirm Delete') : __('Delete'),
      tplDeleteStyle: 'height:34px;padding:0 13px;display:flex;align-items:center;gap:6px;border-radius:9px;cursor:pointer;font-size:13px;border:1px solid var(--red);background:' +
        (s.tplConfirmDel ? 'var(--red)' : 'transparent') + ';color:' + (s.tplConfirmDel ? 'var(--on-accent)' : 'var(--red)') + ';',
    };
  }
});
