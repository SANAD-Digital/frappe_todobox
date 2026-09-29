/* ToDoBox: automation: rules and recurring tasks */
(window.TTParts = window.TTParts || []).push((Base, React) => {
/* ---------- rule conditions: [[doctype, fieldname, operator, value], ...] like Frappe filters ---------- */
const TEXT_OPS = ['=', '!=', 'like', 'not like', 'in', 'not in', 'is set', 'is not set'];
const NUM_OPS = ['=', '!=', '>', '<', '>=', '<=', 'is set', 'is not set'];
const DATE_OPS = ['=', '!=', '>', '<', '>=', '<=', 'between', 'is set', 'is not set'];
const NUM_TYPES = ['Int', 'Float', 'Currency', 'Percent', 'Rating', 'Duration'];
function ruleOps(ft) {
  if (ft === 'Check') return ['='];
  if (ft === 'Select') return ['=', '!=', 'in', 'not in', 'is set', 'is not set'];
  if (ft === 'Date' || ft === 'Datetime') return DATE_OPS;
  if (NUM_TYPES.includes(ft) || ft === 'Time') return NUM_OPS;
  return TEXT_OPS;
}
function ruleOpLabel(op) {
  return {
    '=': __('Equals'), '!=': __('Not Equals'), like: __('Like'), 'not like': __('Not Like'), in: __('In'), 'not in': __('Not In'),
    '>': '>', '<': '<', '>=': '>=', '<=': '<=', between: __('Between'), 'is set': __('Is Set'), 'is not set': __('Is Not Set'),
  }[op] || op;
}
function ruleValueText(v, op) {
  if (Array.isArray(v)) return v.join(op === 'between' ? ' – ' : ', ');
  return v === '' || v == null ? '""' : __(String(v));
}
/** tags: stored comma-separated, edited as a list */
const tagList = (v) => (Array.isArray(v) ? v.slice() : String(v || '').split(',').map((x) => x.trim()).filter(Boolean));
/** stored [dt, field, op, value] ↔ UI operator ("is set" / "is not set" are ["is", "set" | "not set"]) */
const uiOp = (c) => (c[2] === 'is' ? (c[3] === 'not set' ? 'is not set' : 'is set') : c[2] || '=');

/** Condition builder: rows of field · operator · value (a real Frappe control per field type) */
class RuleConditions {
  constructor(el, opts) {
    this.opts = opts;
    this.X = window.TMControls;
    this.wrap = this.X.h('div', { class: 'tb-cond' });
    el.appendChild(this.wrap);
    this.ref = opts.refDoctype || '';
    this.rows = this.clean(opts.value || []);
    this.meta = {};
    this.ctls = [];
    this.load();
  }
  clean(v) { return (v || []).filter((c) => Array.isArray(c) && (!c[0] || c[0] === 'ToDo' || c[0] === this.ref)).map((c) => [(c[1] && c[0]) || this.ref || 'ToDo', c[1] || '', c[2] || '=', c[3] == null ? '' : c[3]]); }
  /** field sources: the reference DocType, plus ToDo only while a legacy rule still has ToDo conditions */
  doctypes() {
    const legacy = this.rows.some((c) => c[0] === 'ToDo' && c[1]);
    return (legacy ? ['ToDo'] : []).concat(this.ref ? [this.ref] : []);
  }
  load() {
    const dts = this.doctypes();
    Promise.all(dts.map((dt) => this.opts.fields(dt).then((rows) => { this.meta[dt] = rows || []; }))).then(() => this.render());
  }
  df(dt, field) { return (this.meta[dt] || []).find((f) => f.fieldname === field) || null; }
  emit() { if (this.opts.onChange) this.opts.onChange(this.rows.map((c) => c.slice())); }
  set_value(v) {
    const rows = this.clean(v);
    if (JSON.stringify(rows) === JSON.stringify(this.rows)) return;
    this.rows = rows;
    this.render();
  }
  get_value() { return this.rows; }
  set_ref(dt) {
    dt = dt || '';
    if (dt === this.ref) return;
    const before = this.rows.length;
    this.ref = dt;
    this.rows = this.clean(this.rows);
    /* start the first condition row as soon as a DocType is picked */
    if (dt && !this.rows.length) this.rows.push([dt, '', '=', '']);
    this.load();
    if (this.rows.length !== before || dt) this.emit();
  }
  clearCtls() { this.ctls.forEach((c) => { try { c.destroy(); } catch (e) { /* */ } }); this.ctls = []; }
  render() {
    const h = this.X.h;
    this.clearCtls();
    this.wrap.textContent = '';
    if (!this.ref) return;
    if (!this.rows.length) this.wrap.appendChild(h('div', { class: 'tb-cond-empty', text: __('No conditions: every task linked to a {0} matches.', [__(this.ref)]) }));
    this.rows.forEach((c, i) => this.wrap.appendChild(this.renderRow(c, i)));
    this.wrap.appendChild(h('button', { type: 'button', class: 'tb-cond-add', onclick: () => { this.rows.push([this.ref, '', '=', '']); this.render(); this.emit(); } },
      this.X.icon('plus'), __('Add condition')));
  }
  fieldSelect(c, i) {
    const h = this.X.h;
    const sel = h('select', { class: 'form-control tb-cond-field', 'aria-label': __('Field') });
    sel.appendChild(h('option', { value: '', text: __('Select a field…') }));
    const dts = this.doctypes();
    dts.forEach((dt) => {
      const g = dts.length > 1 ? h('optgroup', { label: dt === 'ToDo' ? __('Task') : __(dt) }) : sel;
      (this.meta[dt] || []).slice().sort((a, b) => String(a.label).localeCompare(String(b.label))).forEach((f) => {
        g.appendChild(h('option', { value: dt + '\u0001' + f.fieldname, text: f.label }));
      });
      if (g !== sel) sel.appendChild(g);
    });
    sel.value = c[1] ? c[0] + '\u0001' + c[1] : '';
    sel.addEventListener('change', () => {
      const [dt, field] = sel.value ? sel.value.split('\u0001') : [this.ref, ''];
      const df = this.df(dt, field);
      const op = ruleOps(df && df.fieldtype)[0];
      this.rows[i] = [dt, field, op, df && df.fieldtype === 'Check' ? 1 : ''];
      this.render();
      this.emit();
    });
    return sel;
  }
  opSelect(c, i) {
    const h = this.X.h;
    const df = this.df(c[0], c[1]);
    const sel = h('select', { class: 'form-control tb-cond-op', 'aria-label': __('Condition') });
    const ops = ruleOps(df && df.fieldtype);
    ops.forEach((op) => sel.appendChild(h('option', { value: op, text: ruleOpLabel(op) })));
    sel.value = ops.includes(uiOp(c)) ? uiOp(c) : ops[0];
    sel.disabled = !c[1];
    sel.addEventListener('change', () => {
      const op = sel.value, prev = uiOp(this.rows[i]);
      const listish = (o) => (o === 'in' || o === 'not in' ? 'list' : o === 'between' ? 'range' : o.startsWith('is ') ? 'is' : 'one');
      let v = this.rows[i][3];
      if (op === 'is set' || op === 'is not set') v = op === 'is set' ? 'set' : 'not set';
      else if (listish(op) !== listish(prev)) v = op === 'between' ? ['', ''] : '';
      this.rows[i] = [c[0], c[1], op.startsWith('is ') ? 'is' : op, v];
      this.render();
      this.emit();
    });
    return sel;
  }
  valueSlot(c, i) {
    const X = this.X, h = X.h;
    const slot = h('div', { class: 'tb-cond-value' });
    const op = uiOp(c);
    if (!c[1] || op.startsWith('is ')) {
      slot.appendChild(h('input', { type: 'text', class: 'form-control', disabled: true, 'aria-label': __('Value'), placeholder: c[1] ? '' : __('Value') }));
      return slot;
    }
    const df = this.df(c[0], c[1]) || { fieldtype: 'Data', options: '' };
    const ft = df.fieldtype;
    const put = (v) => { this.rows[i][3] = v == null ? '' : v; this.emit(); };
    const aria = __('Value');
    const mk = (parent, value, onChange, fieldtype, extra) => {
      let ctl;
      if (fieldtype === 'Link' && df.options) ctl = new X.Link(parent, { value: value || null, ariaLabel: aria, doctype: df.options, onChange });
      else if (fieldtype === 'Select') {
        const opts = String(df.options || '').split('\n').map((o) => ({ value: o, label: o ? __(o) : '' }));
        ctl = new X.Select(parent, { value: value || '', ariaLabel: aria, options: opts, onChange });
      } else if (fieldtype === 'Check') {
        ctl = new X.Select(parent, { value: String(value === '' ? 1 : value), ariaLabel: aria, options: [{ value: '1', label: __('Yes') }, { value: '0', label: __('No') }], onChange: (v) => onChange(v === '0' ? 0 : 1) });
      } else if (fieldtype === 'Data') ctl = new X.Data(parent, Object.assign({ value: value || '', ariaLabel: aria, onChange }, extra || {}));
      else ctl = new X.Field(parent, { value: value === '' ? null : value, ariaLabel: aria, onChange }, { fieldtype, fieldname: 'cond_value' });
      this.ctls.push(ctl);
      return ctl;
    };
    if (op === 'between') {
      const v = Array.isArray(c[3]) ? c[3].slice() : ['', ''];
      slot.classList.add('is-range');
      mk(slot, v[0], (x) => { v[0] = x || ''; put(v.slice()); }, 'Date');
      mk(slot, v[1], (x) => { v[1] = x || ''; put(v.slice()); }, 'Date');
    } else if (op === 'in' || op === 'not in') {
      const v = Array.isArray(c[3]) ? c[3].join(', ') : String(c[3] || '');
      mk(slot, v, (x) => put(String(x || '').split(',').map((s) => s.trim()).filter(Boolean)), 'Data', { placeholder: __('Values separated by commas') });
    } else if (op === 'like' || op === 'not like') {
      mk(slot, String(c[3] || ''), put, 'Data', { placeholder: __('Text, % matches anything') });
    } else {
      const type = ft === 'Datetime' ? 'Date'
        : ['Link', 'Select', 'Check', 'Date', 'Time'].includes(ft) ? ft
          : NUM_TYPES.includes(ft) ? (ft === 'Int' ? 'Int' : 'Float') : 'Data';
      mk(slot, c[3], put, type);
    }
    return slot;
  }
  renderRow(c, i) {
    const X = this.X, h = X.h;
    return h('div', { class: 'tb-cond-row' },
      h('span', { class: 'tb-cond-join', text: i === 0 ? __('Where') : (this.opts.match && this.opts.match() === 'Any' ? __('or') : __('and')) }),
      this.fieldSelect(c, i), this.opSelect(c, i), this.valueSlot(c, i),
      h('button', { type: 'button', class: 'tmc-icon-btn tb-cond-del', 'aria-label': __('Remove condition'), title: __('Remove condition'),
        onclick: () => { this.rows.splice(i, 1); this.render(); this.emit(); } }, X.icon('x')));
  }
  set_match() { this.render(); }
  focus() { const s = this.wrap.querySelector('select'); if (s) s.focus(); }
  destroy() { this.clearCtls(); this.wrap.remove(); }
}

return class extends Base {
  /* ---------- automation ---------- */
  runRecurring = async (id) => {
    if (this.state.autoBusy) return;
    this.setState({ autoBusy: id });
    const res = await this.api.runRecurringNow(id);
    this.setState({ autoBusy: null });
    const t = res && res.todo;
    if (res && res.recurring && !res.count) { this.toast(__('No enabled users have this role')); this.loadAutomation(); return; }
    if (!res || !res.name) { this.toast(__('Could not run')); return; }
    this.toast(res.count > 1 ? __('Created {0} tasks, one for each user with the role', [res.count]) : t ? __('Created "{0}" with a {1}-step checklist', [String(t.subject || '').slice(0, 30), (t.custom_checklist || []).length]) : __('Task created'));
    this.loadAutomation();
    this.load();
  };
  /** <select> options filled via ref: the template engine doesn't support sc-for inside <select> */
  selectRef(options, value) {
    const key = JSON.stringify([options, value == null ? '' : value]);
    if (!this._selRefs) this._selRefs = new Map();
    let fn = this._selRefs.get(key);
    if (!fn) {
      fn = (el) => {
        if (!el) return;
        const want = options.map((o) => o.id + '\u0001' + o.label).join('\u0002');
        if (el.__ttOpts !== want) {
          el.textContent = '';
          options.forEach((o) => {
            const op = el.ownerDocument.createElement('option');
            op.value = o.id;
            op.textContent = o.label;
            el.appendChild(op);
          });
          el.__ttOpts = want;
        }
        el.value = value == null ? '' : value;
      };
      if (this._selRefs.size > 300) this._selRefs.clear();
      this._selRefs.set(key, fn);
    }
    return fn;
  }
  prioName(p) { return p === 'High' ? __('High') : p === 'Low' ? __('Low') : __('Medium'); }
  freqName(f) { return { Daily: __('Daily'), Weekly: __('Weekly'), Monthly: __('Monthly'), Quarterly: __('Quarterly'), Yearly: __('Yearly') }[f] || f; }
  /** "Document type is Sales Invoice · Priority Equals High and Description Like %invoice%" */
  ruleWhenText(r) {
    const parts = [];
    if (r.reference_doctype) parts.push(__('Document type is {0}', [__(r.reference_doctype)]));
    const labels = r.field_labels || {};
    const conds = (r.conditions || []).map((c) => {
      const [dt, field, op, val] = c;
      const label = labels[(dt || 'ToDo') + '.' + field] || field;
      if (op === 'is') return __('{0} {1}', [label, val === 'not set' ? __('Is Not Set') : __('Is Set')]);
      return __('{0} {1} {2}', [label, ruleOpLabel(op), ruleValueText(val, op)]);
    });
    if (conds.length) parts.push(conds.join(r.match === 'Any' ? ' ' + __('or') + ' ' : ' ' + __('and') + ' '));
    return parts.join(' · ');
  }
  ruleThenText(r) {
    const parts = [];
    if (r.set_priority) parts.push(__('Priority {0}', [this.prioName(r.set_priority)]));
    String(r.add_label || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((t) => parts.push(__('Tag "{0}"', [t])));
    return parts.join(' + ');
  }
  /** the rule form's condition builder: mounted into its fxSlot */
  makeRuleConditions(el) {
    const self = this;
    return new RuleConditions(el, {
      value: (this.state.ruleForm || {}).conditions || [],
      refDoctype: (this.state.ruleForm || {}).reference_doctype || '',
      match: () => (this.state.ruleForm || {}).match || 'All',
      fields: (dt) => (this.api && this.api.getRuleFields ? this.api.getRuleFields(dt) : Promise.resolve([])),
      onChange: (rows) => self.setState((st) => (st.ruleForm ? { ruleForm: { ...st.ruleForm, conditions: rows } } : {})),
    });
  }
  /** asks first (app confirm dialog), then runs the delete */
  confirmAutoDelete(message, run) {
    this.tbConfirm(message, { title: __('Delete'), primary: __('Delete'), danger: true }).then((ok) => { if (ok) run(); });
  }
  autoDelStyle() {
    return 'width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:7px;cursor:pointer;flex:0 0 auto;background:transparent;color:var(--fg3);';
  }

  /* ---------- Frappe controls of the rule and recurring-task forms ---------- */
  /* Each field is a real Frappe control (TMControls, mounted by fxSlot in compose.js when the form
     opens and destroyed when it closes), with Frappe's own label, description and required asterisk. */
  autoFx() {
    const X = () => window.TMControls, A = () => this.api || {};
    const rec = () => this.state.recForm || {}, rule = () => this.state.ruleForm || {};
    const put = (form, key) => (v) => this.setState((st) => (st[form] ? { [form]: { ...st[form], [key]: v == null ? '' : v } } : {}));
    const prio = () => [{ value: 'High', label: __('High') }, { value: 'Medium', label: __('Medium') }, { value: 'Low', label: __('Low') }];
    const tplName = (id) => { const t = (this.state.templates || []).find((x) => x.id === id); return t ? t.label : id; };
    const recTplUsable = () => {
      /* enabled templates, plus the (disabled) one the recurring task already uses */
      const ids = (this.state.templates || []).filter((t) => t.enabled !== false || t.id === rec().template).map((t) => t.id);
      return { name: ['in', ids.length ? ids : ['']] };
    };
    const S = (key, make) => this.fxSlot(key, make);
    return {
      recLabel: S('recLabel', (el) => new (X().Data)(el, { value: rec().label || '', inputId: 'tm-rec-title', label: __('Title'), reqd: 1, maxlength: 140,
        onChange: put('recForm', 'label') })),
      recTemplate: S('recTemplate', (el) => new (X().Link)(el, { value: rec().template || null, inputId: 'tm-rec-template', label: __('Task template'),
        description: __('Fills in the subject, checklist and priority'),
        doctype: 'ToDoBox Task Template', filters: recTplUsable, display: tplName,
        onChange: (id) => this.recPickTemplate(id) })),
      recTo: S('recTo', (el) => new (X().Link)(el, { value: rec().to || null, inputId: 'tm-rec-to', label: __('Assign to'),
        description: __('The task is assigned to this person. Leave empty to create it for every user with the role below.'),
        doctype: 'User', filters: { enabled: 1, user_type: 'System User' },
        display: (id) => ((A().USERS || {})[id] || {}).name || (this._recNames || {})[id] || id,
        remember: (row) => { if (row.description) (this._recNames = this._recNames || {})[row.value] = row.description; },
        onChange: put('recForm', 'to') })),
      /* Frappe's Autocomplete control: a Role Link would need read access to Role, which only System Managers have */
      recRole: S('recRole', (el) => new (X().Field)(el, {
        value: rec().role || null, inputId: 'tm-rec-role', label: __('Role'),
        description: __('Used only when no user is set: one task is created for every enabled user with this role.'),
        onChange: put('recForm', 'role'),
      }, { fieldtype: 'Autocomplete', fieldname: 'role', options: this.recRoleOptions() })),
      recSubject: S('recSubject', (el) => new (X().Data)(el, { value: rec().subject || '', inputId: 'tm-rec-subject', maxlength: 140,
        label: rec().template ? __('Subject (optional — overrides the template)') : __('Subject'), reqd: rec().template ? 0 : 1,
        onChange: put('recForm', 'subject') })),
      recDescription: S('recDescription', (el) => new (X().TextEditor)(el, { value: rec().description || '', inputId: 'tm-rec-details', label: __('Details'),
        onChange: put('recForm', 'description') })),
      recFrequency: S('recFrequency', (el) => new (X().Select)(el, { value: rec().frequency || 'Monthly', inputId: 'tm-rec-frequency', label: __('Repeats'), reqd: 1,
        options: ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'].map((x) => ({ value: x, label: this.freqName(x) })),
        onChange: (v) => put('recForm', 'frequency')(v || 'Monthly') })),
      recTags: S('recTags', (el) => new (X().TagsInput)(el, { value: tagList(rec().labels), label: __('Tags'), ariaLabel: __('Tags'),
        placeholder: __('Add tags…'), suggestions: (q) => this.tmcTagPool(q), onChange: (v) => put('recForm', 'labels')((v || []).join(',')) })),
      recPriority: S('recPriority', (el) => new (X().Select)(el, { value: rec().priority || 'Medium', inputId: 'tm-rec-priority', label: __('Priority'), options: prio(),
        onChange: (v) => put('recForm', 'priority')(v || 'Medium') })),

      ruleLabel: S('ruleLabel', (el) => new (X().Data)(el, { value: rule().label || '', inputId: 'tm-rule-name', label: __('Rule name'), reqd: 1, maxlength: 140,
        onChange: put('ruleForm', 'label') })),
      ruleDoctype: S('ruleDoctype', (el) => new (X().Link)(el, { value: rule().reference_doctype || null, inputId: 'tm-rule-doctype', label: __('Reference document type'),
        description: __('The rule applies only to tasks linked to this document type. Pick one to add conditions on its fields.'),
        doctype: 'DocType', filters: { istable: 0, issingle: 0 },
        onChange: (v) => { put('ruleForm', 'reference_doctype')(v); if (this._fx && this._fx.ruleConditions) this._fx.ruleConditions.set_ref(v || ''); } })),
      ruleMatch: S('ruleMatch', (el) => new (X().Select)(el, { value: rule().match || 'All', inputId: 'tm-rule-match', label: __('Match'),
        options: [{ value: 'All', label: __('All conditions (AND)') }, { value: 'Any', label: __('Any condition (OR)') }],
        onChange: (v) => { put('ruleForm', 'match')(v || 'All'); setTimeout(() => { if (this._fx && this._fx.ruleConditions) this._fx.ruleConditions.set_match(); }, 0); } })),
      ruleConditions: S('ruleConditions', (el) => this.makeRuleConditions(el)),
      ruleSetPriority: S('ruleSetPriority', (el) => new (X().Select)(el, { value: rule().set_priority || '', inputId: 'tm-rule-set-prio', label: __('Set priority'),
        options: [{ value: '', label: __('Do not change') }].concat(prio()), onChange: put('ruleForm', 'set_priority') })),
      /* tag pills (same picker as a new task): the tags in use and the common ones, or a new tag */
      ruleAddLabel: S('ruleAddLabel', (el) => new (X().TagsInput)(el, { value: tagList(rule().add_label), label: __('Add tags'), ariaLabel: __('Add tags'),
        placeholder: __('Add tags…'), suggestions: (q) => this.tmcTagPool(q), onChange: (v) => put('ruleForm', 'add_label')((v || []).join(',')) })),
    };
  }
  /** state → mounted controls (set_value is a no-op when unchanged and never fires onChange) */
  autoSync() {
    const fx = this._fx;
    if (!fx) return;
    const set = (k, v) => { if (fx[k]) fx[k].set_value(v); };
    const f = this.state.recForm;
    if (f) {
      set('recLabel', f.label || ''); set('recTemplate', f.template || null); set('recTo', f.to || null); set('recRole', f.role || null);
      set('recSubject', f.subject || ''); set('recDescription', f.description || '');
      set('recFrequency', f.frequency || 'Monthly'); set('recTags', tagList(f.labels)); set('recPriority', f.priority || 'Medium');
      if (fx.recSubject) {
        fx.recSubject.set_label(f.template ? __('Subject (optional — overrides the template)') : __('Subject'));
        fx.recSubject.set_reqd(!f.template);
      }
    }
    const r = this.state.ruleForm;
    if (r) {
      set('ruleLabel', r.label || ''); set('ruleDoctype', r.reference_doctype || null); set('ruleMatch', r.match || 'All');
      if (fx.ruleConditions) { fx.ruleConditions.set_ref(r.reference_doctype || ''); set('ruleConditions', r.conditions || []); }
      set('ruleSetPriority', r.set_priority || ''); set('ruleAddLabel', tagList(r.add_label));
    }
  }
  componentDidUpdate(pp, ps, snap) {
    if (super.componentDidUpdate) super.componentDidUpdate(pp, ps, snap);
    this.autoSync();
  }

  /* rules */
  openRuleForm = (r) => this.setState({ recForm: null, ruleForm: r ? { match: 'All', ...r, conditions: (r.conditions || []).map((c) => c.slice()) } : { label: '', active: true, reference_doctype: '', match: 'All', conditions: [], set_priority: '', add_label: '' } });
  saveRuleForm = async () => {
    const f = this.state.ruleForm;
    if (!f || this.state.autoBusy) return;
    if (!String(f.label || '').trim()) { this.toast(__('Enter a rule name')); this.fxInvalid('ruleLabel'); return; }
    const conditions = (f.conditions || []).filter((c) => c && c[1]);
    if (!conditions.length && !f.reference_doctype) { this.toast(__('Add at least one condition')); return; }
    if (!f.set_priority && !String(f.add_label || '').trim()) { this.toast(__('Add at least one action')); return; }
    this.setState({ autoBusy: 'rule' });
    const res = await this.api.saveRule({ ...f, conditions });
    this.setState({ autoBusy: null });
    if (!res) return;
    this.setState({ ruleForm: null });
    this.toast(__('Rule "{0}" saved', [res.label]));
    this.loadAutomation();
  };
  toggleRuleItem = async (r) => {
    if (!this.state.canManageRules) return;
    this.setState((st) => ({ rules: st.rules.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)) }));
    await this.api.toggleRule(r.id);
    this.loadAutomation();
  };
  deleteRuleItem = (r) => this.confirmAutoDelete(__('Delete the rule "{0}"?', [r.label]), async () => {
    /* removed from the list right away; the reload restores it if the server refused */
    this.setState((st) => ({ rules: st.rules.filter((x) => x.id !== r.id), ruleForm: st.ruleForm && st.ruleForm.id === r.id ? null : st.ruleForm }));
    await this.api.deleteRule(r.id);
    this.toast(__('Rule "{0}" deleted', [r.label]));
    this.loadAutomation();
  });

  /* recurring tasks */
  openRecForm = (r, prefill) => {
    const A = this.api;
    const base = { label: '', active: true, to: '', role: '', frequency: 'Monthly', template: '', priority: 'Medium', labels: '', subject: '', description: '' };
    if (this.state.automation !== 'recurring') this.loadAutomation();
    const recForm = r ? { ...base, ...r } : { ...base, ...(prefill || {}) };
    /* the form's Frappe controls stay mounted when switching from one recurring task to another:
       autoSync (componentDidUpdate) pushes the new values into them */
    this.setState({ ruleForm: null, automation: 'recurring', recForm });
  };
  /** task template picked in the recurring form: prefills the title (when empty) and the priority */
  recPickTemplate(id) {
    const t = id ? (this.state.templates || []).find((x) => x.id === id) : null;
    this.setState((st) => (st.recForm ? { recForm: { ...st.recForm, template: id || '', label: st.recForm.label || (t ? t.label : ''), priority: t ? (t.priority || st.recForm.priority) : st.recForm.priority } } : {}));
  }
  /** Autocomplete choices for the role field (roles held by enabled users, from get_automation) */
  recRoleOptions() {
    const roles = (this.state.recRoles || []).slice();
    const cur = this.state.recForm && this.state.recForm.role;
    if (cur && !roles.some((x) => x.name === cur)) roles.push({ name: cur, users: 0 });
    return roles.map((x) => ({ label: x.name, value: x.name, description: __('{0} users', [x.users]) }));
  }
  /** role choices arrive with get_automation: refresh a role field that is already mounted */
  syncRecRoles() {
    const ctl = this._fx && this._fx.recRole;
    if (!ctl || !ctl.control || !ctl.control.set_data) return;
    ctl.control.set_data(this.recRoleOptions());
    const cur = this.state.recForm && this.state.recForm.role;
    if (cur) ctl.push(cur);
  }
  openRecurringFromCompose = () => {
    const c = this.state.compose || {};
    const tpl = c.template ? (this.state.templates || []).find((t) => t.id === c.template) : null;
    this.setState({ compose: null });
    this.openRecForm(null, {
      label: c.subject || (tpl && tpl.label) || '', subject: c.subject || '', description: c.body || '',
      template: c.template || '', to: (c.to && c.to[0]) || '', priority: c.priority || 'Medium',
    });
  };
  saveRecForm = async () => {
    const f = this.state.recForm;
    if (!f || this.state.autoBusy) return;
    if (!String(f.label || '').trim()) { this.toast(__('Enter a title')); this.fxInvalid('recLabel'); return; }
    if (!f.to && !f.role) { this.toast(__('Choose the user to assign the task to, or a role')); this.fxInvalid('recTo'); return; }
    if (!f.template && !String(f.subject || '').trim()) { this.toast(__('Choose a task template or enter a subject')); this.fxInvalid('recSubject'); return; }
    this.setState({ autoBusy: 'rec' });
    const res = await this.api.saveRecurring(f);
    this.setState({ autoBusy: null });
    if (!res) return;
    this.setState({ recForm: null });
    this.toast(__('Recurring task "{0}" saved — next run {1}', [res.label, res.next]));
    this.loadAutomation();
  };
  toggleRecItem = async (r) => {
    this.setState((st) => ({ recurring: st.recurring.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)) }));
    await this.api.toggleRecurring(r.id);
    this.loadAutomation();
  };
  deleteRecItem = (r) => this.confirmAutoDelete(__('Delete the recurring task "{0}"?', [r.label]), async () => {
    this.setState((st) => ({ recurring: st.recurring.filter((x) => x.id !== r.id), recForm: st.recForm && st.recForm.id === r.id ? null : st.recForm }));
    await this.api.deleteRecurring(r.id);
    this.toast(__('Recurring task "{0}" deleted', [r.label]));
    this.loadAutomation();
  });
};
});
