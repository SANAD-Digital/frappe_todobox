/* ToDoBox: Settings screen (System Manager). Who is hidden from the recipient pickers, assignment
   limited to the user's department, and the document types a task may link to
   (todobox.api.get_settings / save_settings). The sidebar entry shows only to settings admins:
   the is_settings_admin flag (page boot or get_active_users) when present, else the user's roles,
   else get_settings().can_edit. */
(window.TTParts = window.TTParts || []).push((Base, React) => class extends Base {
  /** true / false when known, null while unknown (the first get_settings answers it) */
  setIsAdmin() {
    const boot = window.todobox_boot || {};
    if (boot.is_settings_admin != null) return !!boot.is_settings_admin;
    if (this.api && this.api.IS_SETTINGS_ADMIN != null) return !!this.api.IS_SETTINGS_ADMIN;
    const f = window.frappe, roles = (f && f.boot && f.boot.user && f.boot.user.roles) || (f && f.user_roles);
    if (Array.isArray(roles) && roles.length) return roles.includes('System Manager');
    if (this.state.setData) return !!this.state.setData.can_edit;
    return null;
  }
  /* once, after the first load: find out whether to show the sidebar entry */
  loadAux() {
    const r = super.loadAux();
    if (!this._setProbed) {
      this._setProbed = true;
      if (this.setIsAdmin() === null && this.api && this.api.getSettings) this.loadSettings(true);
    }
    return r;
  }
  setDraftOf(d) {
    d = d || {};
    return {
      hide_administrator: d.hide_administrator ? 1 : 0,
      hidden_users: (d.hidden_users || []).slice(),
      hidden_groups: (d.hidden_groups || []).slice(),
      restrict_to_department: d.restrict_to_department ? 1 : 0,
      linkable_doctypes: (d.linkable_doctypes || []).slice(),
    };
  }
  /** quiet: the admin probe (no loading state on screen) */
  loadSettings = async (quiet) => {
    if (!quiet) this.setState({ setLoading: true });
    const d = await this.api.getSettings();
    if (d && this.api.resolveUsers) await this.api.resolveUsers(d.hidden_users || []);
    this.setState({ setData: d || null, setDraft: d ? this.setDraftOf(d) : null, setLoading: false, setFailed: !d });
  };
  patchSet = (patch) => this.setState((st) => ({ setDraft: { ...(st.setDraft || this.setDraftOf()), ...patch } }));
  setAdd = (key, v) => {
    if (!v) return;
    const cur = (this.state.setDraft || {})[key] || [];
    if (!cur.includes(v)) this.patchSet({ [key]: [...cur, v] });
  };
  setRemove = (key, v) => this.patchSet({ [key]: ((this.state.setDraft || {})[key] || []).filter((x) => x !== v) });
  saveSettings = async () => {
    const d = this.state.setDraft, data = this.state.setData;
    if (!d || !data || !data.can_edit || this.state.setBusy) return;
    this.setState({ setBusy: true });
    const res = await this.api.saveSettings(d);
    this.setState({ setBusy: false });
    if (!res) { this.toast(__('Could not save the settings')); return; }
    this.setState({ setData: res, setDraft: this.setDraftOf(res) });
    this.toast(__('Settings saved'));
  };

  /* ---------- Frappe controls (fxSlot in compose.js) ---------- */
  setFx() {
    const X = () => window.TMControls, A = this.api || {}, d = () => this.state.setDraft || {};
    const S = (key, make) => this.fxSlot(key, make);
    /* a Link that adds its pick to a list, then clears itself for the next one */
    const adder = (key, el, opts) => {
      const ctl = new (X().Link)(el, { ...opts, onChange: (v) => {
        if (!v) return;
        this.setAdd(key, v);
        setTimeout(() => ctl.set_value(null), 0);
      } });
      return ctl;
    };
    return {
      hideAdmin: S('setHideAdmin', (el) => new (X().Field)(el, { value: d().hide_administrator ? 1 : 0, inputId: 'tm-set-hide-admin', label: __('Hide Administrator'),
        onChange: (v) => this.patchSet({ hide_administrator: v ? 1 : 0 }) }, { fieldtype: 'Check', fieldname: 'hide_administrator' })),
      users: S('setUsers', (el) => new (X().UserMulti)(el, { value: d().hidden_users || [], inputId: 'tm-set-users', label: __('Hidden users'),
        placeholder: __('Search people by name or email…'),
        search: (q, ex) => A.searchAllUsers(q, ex), user: (id) => (A.USERS && A.USERS[id]) || null,
        onChange: (v) => this.patchSet({ hidden_users: v || [] }) })),
      groups: S('setGroups', (el) => adder('hidden_groups', el, { inputId: 'tm-set-groups', label: __('Hidden user groups'),
        placeholder: __('Add a user group…'), doctype: 'User Group' })),
      dept: S('setDept', (el) => new (X().Field)(el, { value: d().restrict_to_department ? 1 : 0, inputId: 'tm-set-dept', label: __('Assign only within the department'),
        description: __('Users can assign tasks only to people in their own department (from the Employee record).'),
        onChange: (v) => this.patchSet({ restrict_to_department: v ? 1 : 0 }) }, { fieldtype: 'Check', fieldname: 'restrict_to_department' })),
      doctypes: S('setDoctypes', (el) => adder('linkable_doctypes', el, { inputId: 'tm-set-doctypes', label: __('Document types'),
        placeholder: __('Add a document type…'), doctype: 'DocType', filters: { istable: 0, issingle: 0 } })),
    };
  }
  /* the draft into the mounted controls (no change events), and their read-only state */
  setSync() {
    const fx = this._fx, d = this.state.setDraft, data = this.state.setData;
    if (!fx || !d || this.state.screen !== 'settings') return;
    const ro = !(data && data.can_edit);
    const off = (ctl, dis) => {
      if (!ctl || !ctl.control) return;
      if (ctl.setDisabled) ctl.setDisabled(dis);
      else if (ctl.control.$input) ctl.control.$input.prop('disabled', dis);
      ctl.wrap.classList.toggle('is-disabled', dis);
      ctl.wrap.style.pointerEvents = dis ? 'none' : '';
    };
    if (fx.setHideAdmin) { fx.setHideAdmin.set_value(d.hide_administrator ? 1 : 0); off(fx.setHideAdmin, ro); }
    if (fx.setUsers) { fx.setUsers.set_value(d.hidden_users || []); off(fx.setUsers, ro); }
    if (fx.setDept) { fx.setDept.set_value(d.restrict_to_department ? 1 : 0); off(fx.setDept, ro || !data.department_available); }
    off(fx.setGroups, ro);
    off(fx.setDoctypes, ro);
  }
  componentDidUpdate(pp, ps, snap) {
    if (super.componentDidUpdate) super.componentDidUpdate(pp, ps, snap);
    this.setSync();
  }

  settingsVals() {
    const s = this.state, A = this.api;
    if (s.screen !== 'settings' || !A) return { screenSettings: false, setFx: {}, setGroups: [], setDoctypes: [] };
    const data = s.setData, d = s.setDraft || this.setDraftOf(data);
    const ro = !(data && data.can_edit);
    const chips = (key) => (d[key] || []).map((v) => ({
      label: v,
      removeLabel: __('Remove {0}', [v]),
      removeStyle: ro ? 'display:none;' : 'width:18px;height:18px;display:grid;place-items:center;margin-inline-start:2px;background:transparent;border:0;border-radius:99px;cursor:pointer;color:var(--fg3);',
      onRemove: () => this.setRemove(key, v),
    }));
    const dirty = !!data && JSON.stringify(this.setDraftOf(data)) !== JSON.stringify(this.setDraftOf(d));
    return {
      screenSettings: true,
      setLoading: !data && !s.setFailed,
      setFailed: !data && !!s.setFailed,
      setReady: !!data,
      setReadOnly: !!data && ro,
      setCanEdit: !!data && !ro,
      setNoDept: !!data && !data.department_available,
      setFx: data ? this.setFx() : {},
      setGroups: chips('hidden_groups'),
      setNoGroups: !(d.hidden_groups || []).length,
      setDoctypes: chips('linkable_doctypes'),
      setNoDoctypes: !(d.linkable_doctypes || []).length,
      setRetry: () => this.loadSettings(),
      setSave: this.saveSettings,
      setSaveLabel: s.setBusy ? __('Saving…') : __('Save'),
      setSaveStyle: 'height:34px;padding:0 18px;background:var(--primary);color:var(--primary-ink);border:0;border-radius:99px;cursor:pointer;font-size:13px;font-weight:600;opacity:' + (s.setBusy || !dirty ? '.6' : '1') + ';',
      setDirtyNote: dirty ? __('Unsaved changes') : '',
    };
  }
});
