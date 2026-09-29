/* =============================================================================
   ToDoBox: Quick Look ("All fields")

   Centered panel showing all document fields (read-only) from
   frappe.desk.form.load.getdoctype / getdoc via frappe_shim.js.
   The "Edit" button opens the real Desk form inside the same panel; Esc or clicking
   outside closes it.  The UI calls it via:
     window.ToDoBoxQuickLook.expand({ kind: "doc", doctype, name })
   ============================================================================= */
(function () {
	if (window.ToDoBoxQuickLook) return;

	/* inside the edit frame: hide the Desk chrome around the form */
	const FRAME_CSS = `
		.body-sidebar-container, .navbar, .sticky-top, .layout-footer,
		.page-head .sidebar-toggle-btn { display: none !important; }
		.main-section, #body { margin-left: 0 !important; margin-right: 0 !important;
			padding-left: 0 !important; padding-right: 0 !important;
			width: 100% !important; max-width: none !important; }
		body { overflow-x: hidden !important; }
	`;
	const FRESH_MS = 60000;
	const NO_VALUE = ["Section Break", "Column Break", "Tab Break", "HTML", "Button", "Heading", "Fold", "Image", "Password", "Geolocation", "Table HTML"];

	/* inline icons (the panel may open outside the ToDoBox sprite) */
	const svg = (d, cls) => `<svg class="${cls || "tm-ql-i"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
	const IC = {
		doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
		pencil: '<path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
		list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
		open: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
		x: '<path d="M6 6l12 12M18 6L6 18"/>',
		sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/><path d="M6 8.5h1.5M6 11h1.5"/>',
		clip: '<path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
		user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
		tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/>',
		clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
		info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
	};
	/* sidebar (Frappe .form-sidebar): resizable, collapsible, width / state kept per browser */
	const SIDE_W = { def: 248, min: 188, max: 420 };
	const LS_W = "todobox.ql.side_w";
	const LS_C = "todobox.ql.side_collapsed";
	const ls_get = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
	const ls_set = (k, v) => { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* storage unavailable */ } };
	const is_mobile = () => !!(window.matchMedia && window.matchMedia("(max-width: 767px)").matches);
	const WIDE = ["Table", "Table MultiSelect", "Text Editor", "HTML Editor", "Markdown Editor", "Small Text", "Text", "Long Text", "Code", "JSON"];
	const NUMERIC = ["Int", "Float", "Currency", "Percent"];

	const F = () => window.frappe;
	const __ = (t, r) => (window.__ ? window.__(t, r) : t);
	const esc = (v) => F().utils.escape_html(v == null ? "" : String(v));
	const same = (a, b) => !!(a && b && a.doctype === b.doctype && a.name === b.name);
	const key = (t) => t.doctype + "|" + t.name;

	let panel = null;
	let backdrop = null;
	let panel_open = false;
	let toc_held = null;     // id of the section picked in the chips (until the user scrolls)
	let mode = "view";       // view | edit
	let wanted = null;       // document shown/requested
	let seq = 0;             // invalidates stale request results
	const fetched_at = {};   // key -> last fetch time
	const edited = new Set();// docs opened for editing: re-read on next view

	/* Desk frame (edit only): created on first edit and kept for reuse */
	let frame = null;
	let frame_ready = false;
	let current = null;
	let watch = 0;
	let side_w = SIDE_W.def;

	/* ----------------------------------------------------------- panel -- */
	function ensure_panel() {
		if (panel) return;
		backdrop = document.createElement("div");
		backdrop.className = "tm-ql-backdrop";
		backdrop.addEventListener("click", close_panel);
		panel = document.createElement("div");
		panel.className = "tm-ql-panel";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-modal", "true");
		panel.setAttribute("aria-labelledby", "tm-ql-title");
		panel.innerHTML = `
			<div class="tm-ql-head modal-header">
				<button type="button" class="tm-ql-side-toggle sidebar-toggle-btn" aria-controls="tm-ql-side" aria-expanded="true" title="${esc(__("Toggle Sidebar"))}" aria-label="${esc(__("Toggle Sidebar"))}">${svg(IC.sidebar)}</button>
				<div class="tm-ql-tile">${svg(IC.doc)}</div>
				<div class="tm-ql-titles">
					<div class="tm-ql-title-row">
						<h2 class="tm-ql-title modal-title" id="tm-ql-title"></h2>
						<span class="tm-ql-status"></span>
					</div>
					<div class="tm-ql-meta-row">
						<span class="tm-ql-eyebrow"></span>
						<span class="tm-ql-sub"></span>
					</div>
				</div>
				<div class="tm-ql-actions">
					<button type="button" class="tm-ql-btn tm-ql-edit btn btn-default btn-sm"></button>
					<a class="tm-ql-btn tm-ql-open btn btn-default btn-sm" href="#" target="_blank" rel="noopener" title="${esc(__("Open in Desk"))}">${svg(IC.open)}<span>${esc(__("Open in Desk"))}</span></a>
					<span class="tm-ql-sep" aria-hidden="true"></span>
					<button type="button" class="tm-ql-close btn-modal-close" aria-label="${esc(__("Close"))}" title="${esc(__("Close"))}">${svg(IC.x)}</button>
				</div>
			</div>
			<nav class="tm-ql-toc" aria-label="${esc(__("Sections"))}" hidden></nav>
			<div class="tm-ql-layout">
				<aside class="tm-ql-side layout-side-section form-sidebar" id="tm-ql-side" aria-label="${esc(__("Document info"))}">
					<div class="tm-ql-side-scroll"></div>
					<div class="tm-ql-resize sidebar-resize-handle" role="separator" aria-orientation="vertical" tabindex="0"
						aria-label="${esc(__("Resize sidebar"))}" title="${esc(__("Drag to resize, double-click to reset"))}"></div>
				</aside>
				<div class="tm-ql-body layout-main-section">
					<div class="tm-ql-view"></div>
					<div class="tm-ql-loading" aria-hidden="true">${skeleton_main()}</div>
				</div>
			</div>`;
		panel.querySelector(".tm-ql-close").addEventListener("click", close_panel);
		panel.querySelector(".tm-ql-edit").addEventListener("click", () => set_mode(mode === "edit" ? "view" : "edit"));
		panel.querySelector(".tm-ql-open").addEventListener("click", () => setTimeout(close_panel, 0));
		panel.querySelector(".tm-ql-toc").addEventListener("click", (e) => {
			const chip = e.target.closest && e.target.closest("[data-ql-to]");
			if (!chip) return;
			const view = panel.querySelector(".tm-ql-view");
			const el = view.querySelector("#" + chip.getAttribute("data-ql-to"));
			if (!el) return;
			const smooth = !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
			toc_held = el.id; // the picked chip stays active even when the page cannot scroll that far
			view.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: smooth ? "smooth" : "auto" });
			spy();
		});
		const qv = panel.querySelector(".tm-ql-view");
		qv.addEventListener("scroll", spy, { passive: true });
		["wheel", "touchstart", "keydown", "mousedown"].forEach((ev) => qv.addEventListener(ev, () => { toc_held = null; }, { passive: true }));
		panel.addEventListener("click", (e) => {
			const a = e.target.closest && e.target.closest("a[data-ql-link]");
			if (!a) return;
			e.preventDefault();
			F().set_route("Form", a.getAttribute("data-doctype"), a.getAttribute("data-name"));
		});
		document.body.appendChild(backdrop);
		document.body.appendChild(panel);
		init_side();
	}

	/* --------------------------------------------------------- sidebar -- */
	function init_side() {
		const saved = parseInt(ls_get(LS_W), 10);
		set_side_w(isFinite(saved) ? saved : SIDE_W.def, false);
		set_side_collapsed(is_mobile() || ls_get(LS_C) === "1", false);
		panel.querySelector(".tm-ql-side-toggle").addEventListener("click", () => {
			set_side_collapsed(!panel.classList.contains("side-collapsed"), !is_mobile());
		});
		const h = panel.querySelector(".tm-ql-resize");
		const rtl = () => panel.getAttribute("dir") === "rtl";
		h.addEventListener("pointerdown", (e) => {
			if (e.button !== 0 || is_mobile()) return;
			e.preventDefault();
			const x0 = e.clientX;
			const w0 = side_w;
			try { h.setPointerCapture(e.pointerId); } catch (err) { /* */ }
			panel.classList.add("side-resizing");
			const move = (ev) => set_side_w(w0 + (ev.clientX - x0) * (rtl() ? -1 : 1), false);
			const up = () => {
				h.removeEventListener("pointermove", move);
				h.removeEventListener("pointerup", up);
				h.removeEventListener("pointercancel", up);
				panel.classList.remove("side-resizing");
				ls_set(LS_W, side_w);
			};
			h.addEventListener("pointermove", move);
			h.addEventListener("pointerup", up);
			h.addEventListener("pointercancel", up);
		});
		h.addEventListener("dblclick", () => set_side_w(SIDE_W.def, true));
		h.addEventListener("keydown", (e) => {
			const step = e.shiftKey ? 48 : 16;
			const dir = rtl() ? -1 : 1;
			let w = null;
			if (e.key === "ArrowRight") w = side_w + step * dir;
			else if (e.key === "ArrowLeft") w = side_w - step * dir;
			else if (e.key === "Home") w = SIDE_W.min;
			else if (e.key === "End") w = SIDE_W.max;
			else if (e.key === "Enter") w = SIDE_W.def;
			if (w == null) return;
			e.preventDefault();
			set_side_w(w, true);
		});
	}

	function set_side_w(w, persist) {
		const room = panel.clientWidth ? panel.clientWidth * 0.45 : SIDE_W.max;
		const max = Math.max(SIDE_W.min, Math.min(SIDE_W.max, room));
		side_w = Math.round(Math.min(max, Math.max(SIDE_W.min, Number(w) || SIDE_W.def)));
		panel.style.setProperty("--tm-ql-side-w", side_w + "px");
		const h = panel.querySelector(".tm-ql-resize");
		h.setAttribute("aria-valuemin", SIDE_W.min);
		h.setAttribute("aria-valuemax", Math.round(max));
		h.setAttribute("aria-valuenow", side_w);
		if (persist) ls_set(LS_W, side_w);
	}

	function set_side_collapsed(on, persist) {
		panel.classList.toggle("side-collapsed", !!on);
		const b = panel.querySelector(".tm-ql-side-toggle");
		b.setAttribute("aria-expanded", on ? "false" : "true");
		if (persist) ls_set(LS_C, on ? "1" : "0");
	}

	function skeleton_main() {
		const f = '<span class="tm-ql-sk-field"><i class="tm-ql-sk w30"></i><i class="tm-ql-sk w100 tall"></i></span>';
		const sec = `<span class="tm-ql-sk-sec"><i class="tm-ql-sk w20 head"></i><span class="tm-ql-sk-grid">${f.repeat(4)}</span></span>`;
		return `<span class="tm-ql-sk-doc">${sec}${sec}</span>`;
	}

	function skeleton_side() {
		const s = '<div class="tm-ql-side-sec"><i class="tm-ql-sk w40"></i><i class="tm-ql-sk w80"></i><i class="tm-ql-sk w60"></i></div>';
		return `<div class="tm-ql-side-sk" aria-hidden="true">${s}${s}${s}</div>`;
	}

	function full_name(u) {
		try {
			const ui = F().user_info ? F().user_info(u) : null;
			return (ui && ui.fullname) || u;
		} catch (e) { return u; }
	}

	function avatar(u) {
		const n = full_name(u);
		const ini = String(n).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
		return `<span class="tm-ql-avatar" title="${esc(n)}" aria-hidden="true">${esc(ini)}</span>`;
	}

	function when(v) {
		if (!v) return "";
		let full = v;
		try { full = F().datetime.str_to_user(v); } catch (e) { /* */ }
		let rel = "";
		try { rel = F().datetime.prettyDate ? F().datetime.prettyDate(v) : ""; } catch (e) { rel = ""; }
		return `<span class="tm-ql-when" title="${esc(full)}">${esc(rel || full)}</span>`;
	}

	/* sidebar content: built only from the document already loaded (no extra calls) */
	function render_side(meta, doc) {
		const box = panel.querySelector(".tm-ql-side-scroll");
		if (!doc || !meta) { box.innerHTML = ""; return; }
		const sec = (icon, label, body, count) => `<div class="tm-ql-side-sec sidebar-section">
			<div class="tm-ql-side-label sidebar-label">${svg(icon)}<span>${esc(label)}</span>${count ? `<span class="tm-ql-side-count">${esc(count)}</span>` : ""}</div>
			${body}</div>`;
		const none = (t) => `<div class="tm-ql-side-empty">${esc(t)}</div>`;
		let out = "";

		let assign = [];
		try { assign = doc._assign ? JSON.parse(doc._assign) : []; } catch (e) { assign = []; }
		if (!Array.isArray(assign)) assign = [];
		out += sec(IC.user, __("Assigned To"), assign.length
			? `<ul class="tm-ql-side-list">${assign.map((u) => `<li class="tm-ql-side-person">${avatar(u)}<span class="tm-ql-side-text">${esc(full_name(u))}</span></li>`).join("")}</ul>`
			: none(__("No one assigned")), assign.length || "");

		const files = (meta.fields || []).filter((df) => (df.fieldtype === "Attach" || df.fieldtype === "Attach Image") && !df.hidden && doc[df.fieldname] && !/^data:/.test(doc[df.fieldname]));
		out += sec(IC.clip, __("Attachments"), files.length
			? `<ul class="tm-ql-side-list">${files.map((df) => {
				const v = String(doc[df.fieldname]);
				return `<li><a class="tm-ql-side-file" href="${esc(v)}" target="_blank" rel="noopener" title="${esc(__(df.label || df.fieldname))}">${svg(IC.clip)}<span class="tm-ql-side-text">${esc(v.split("/").pop())}</span></a></li>`;
			}).join("")}</ul>`
			: none(__("No attachments")), files.length || "");

		const tags = String(doc._user_tags || "").split(",").map((t) => t.trim()).filter(Boolean);
		out += sec(IC.tag, __("Tags"), tags.length
			? `<div class="tm-ql-side-tags">${tags.map((t) => `<span class="tm-ql-side-tag">${esc(t)}</span>`).join("")}</div>`
			: none(__("No tags")));

		const row = (u, label, v) => (u || v ? `<li class="tm-ql-side-person">${u ? avatar(u) : ""}<span class="tm-ql-side-text"><span class="tm-ql-side-who">${esc(u ? full_name(u) : "")}</span><span class="tm-ql-side-muted">${esc(label)} · ${when(v)}</span></span></li>` : "");
		const activity = row(doc.modified_by, __("last edited"), doc.modified) + row(doc.owner, __("created"), doc.creation);
		out += sec(IC.clock, __("Activity"), activity ? `<ul class="tm-ql-side-list">${activity}</ul>` : none(__("No activity")));

		box.innerHTML = out;
	}

	function set_loading(on) {
		const el = panel && panel.querySelector(".tm-ql-loading");
		if (el) el.style.display = on ? "" : "none";
	}

	function set_mode(m) {
		mode = m;
		const btn = panel.querySelector(".tm-ql-edit");
		const lbl = m === "edit" ? __("Details") : __("Edit");
		btn.innerHTML = svg(m === "edit" ? IC.list : IC.pencil) + `<span>${esc(lbl)}</span>`;
		btn.title = lbl;
		panel.classList.toggle("editing", m === "edit");
		panel.querySelector(".tm-ql-side-toggle").hidden = m === "edit";
		if (!wanted) return;
		if (m === "edit") {
			edited.add(key(wanted));
			show_frame(wanted);
		} else {
			if (frame) frame.style.display = "none";
			render_view(wanted);
		}
	}

	/* ------------------------------------------------------ read view -- */
	function render_view(target) {
		const id = ++seq;
		const view = panel.querySelector(".tm-ql-view");
		const k = key(target);
		const force = edited.has(k) || !fetched_at[k] || Date.now() - fetched_at[k] > FRESH_MS;
		set_loading(true);
		Promise.all([
			F().model.with_doctype(target.doctype),
			F().model.with_doc(target.doctype, target.name, null, force),
		]).then(([meta, doc]) => {
			if (id !== seq || !panel_open || mode !== "view") return;
			if (doc) { fetched_at[k] = Date.now(); edited.delete(k); }
			view.innerHTML = doc && meta ? build(meta, doc) : empty_state(__("Could not load the document"));
			view.scrollTop = 0;
			set_toc();
			set_subtitle(meta, doc);
			render_side(meta, doc);
			set_loading(false);
		});
	}

	function set_subtitle(meta, doc) {
		const sub = panel.querySelector(".tm-ql-sub");
		const badge = panel.querySelector(".tm-ql-status");
		if (!doc || !meta) { sub.textContent = ""; badge.innerHTML = ""; return; }
		const tf = meta.title_field;
		sub.textContent = tf && doc[tf] && doc[tf] !== doc.name ? String(doc[tf]) : "";
		const status = doc.workflow_state || doc.status || (meta.is_submittable ? ["Draft", "Submitted", "Cancelled"][doc.docstatus || 0] : "");
		badge.innerHTML = status ? `<span class="tm-ql-badge indicator-pill ${indicator(status, doc.docstatus)}" data-docstatus="${esc(doc.docstatus || 0)}">${esc(__(status))}</span>` : "";
	}

	/* Frappe-like indicator colour for a status (design only) */
	function indicator(status, docstatus) {
		const s = String(status || "").toLowerCase();
		if (docstatus == 2 || /cancel|reject|overdue|fail|expired|lost|disabled|block/.test(s)) return "red";
		if (/complet|closed|paid|approv|done|active|enabled|resolved|success|delivered|accepted|won/.test(s)) return "green";
		if (/open|pending|draft|hold|progress|review|unpaid|partly|to /.test(s)) return "orange";
		if (docstatus == 1 || /submit/.test(s)) return "blue";
		return "gray";
	}

	function empty_state(text) {
		return `<div class="tm-ql-empty"><span class="tm-ql-empty-ic">${svg(IC.doc)}</span><span>${esc(text)}</span></div>`;
	}

	/* no tab / section strip: all tabs' fields are rendered one after another in a single scroll */
	function set_toc() {
		const toc = panel.querySelector(".tm-ql-toc");
		toc_held = null;
		toc.hidden = true;
		toc.innerHTML = "";
	}

	function spy() {
		const toc = panel && panel.querySelector(".tm-ql-toc");
		if (!toc || toc.hidden) return;
		const view = panel.querySelector(".tm-ql-view");
		const anchors = Array.from(view.querySelectorAll("[data-ql-anchor]"));
		let cur = anchors[0];
		if (toc_held && view.querySelector("#" + toc_held)) cur = view.querySelector("#" + toc_held);
		else {
			const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 2;
			anchors.forEach((a) => { if (a.offsetTop - view.scrollTop <= 40) cur = a; });
			if (atEnd && view.scrollTop > 0) cur = anchors[anchors.length - 1];
		}
		toc.querySelectorAll("[data-ql-to]").forEach((c) => {
			const on = !!cur && c.getAttribute("data-ql-to") === cur.id;
			c.classList.toggle("active", on);
			if (on) c.setAttribute("aria-current", "true"); else c.removeAttribute("aria-current");
		});
	}

	function build(meta, doc) {
		const sections = [];
		let sec = null;
		const new_section = (label, tab) => {
			sec = { label: label || "", tab: !!tab, cols: [[]] };
			sections.push(sec);
		};
		new_section("");
		(meta.fields || []).forEach((df) => {
			if (df.fieldtype === "Tab Break") { new_section(df.label, true); return; }
			if (df.fieldtype === "Section Break") { new_section(df.label); return; }
			if (df.fieldtype === "Column Break") { sec.cols.push([]); return; }
			if (df.hidden || NO_VALUE.includes(df.fieldtype) || df.fieldname === "naming_series") return;
			const html = value_html(df, doc[df.fieldname], doc);
			if (html) sec.cols[sec.cols.length - 1].push({ df, html });
		});
		let out = "";
		let pending_tab = "";
		let n = 0;
		sections.forEach((s) => {
			if (s.tab) pending_tab = s.label;
			const cols = s.cols.filter((c) => c.length);
			if (!cols.length) return;
			n++;
			/* the first block without a heading is anchored as "Details" for the section chips */
			/* tabs are flattened: no tab heading; an unnamed first section of a tab takes the tab's name */
			const own = s.label && !s.tab ? s.label : "";
			const label = own ? __(own) : (pending_tab && n > 1 ? __(pending_tab) : "");
			pending_tab = "";
			const anchor = label || (n === 1 ? __("Details") : "");
			out += `<section class="tm-ql-sec" id="tm-ql-a${n}"${anchor ? ` data-ql-anchor="${esc(anchor)}"` : ""}>`;
			if (label) out += `<h4 class="tm-ql-sec-h">${esc(label)}</h4>`;
			out += `<div class="tm-ql-cols" style="--tm-ql-cols:${Math.min(cols.length, 3)}">`;
			cols.forEach((c) => {
				out += `<div class="tm-ql-col">`;
				c.forEach(({ df, html }) => {
					/* long content (tables, rich / multi-line text) gets the full width of its column */
					const wide = WIDE.includes(df.fieldtype);
					const cls = "tm-ql-field" + (wide ? " wide" : "") + (NUMERIC.includes(df.fieldtype) ? " num" : "");
					out += `<div class="${cls}"><div class="tm-ql-label">${esc(__(df.label || df.fieldname))}</div><div class="tm-ql-value">${html}</div></div>`;
				});
				out += `</div>`;
			});
			out += `</div></section>`;
		});
		return out ? `<div class="tm-ql-doc">${out}</div>` : empty_state(__("No details to show"));
	}

	function empty(v) { return v == null || v === "" || (Array.isArray(v) && !v.length); }

	function num(v, digits) {
		const n = Number(v);
		if (!isFinite(n)) return esc(v);
		const opts = digits == null ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
		try { return esc(n.toLocaleString(window.TT_LANG || "en", opts)); } catch (e) { return esc(n); }
	}

	function link(doctype, name, text) {
		if (!doctype || !name) return esc(text || name);
		return `<a href="${esc(F().desk_url(doctype, name))}" data-ql-link data-doctype="${esc(doctype)}" data-name="${esc(name)}">${esc(text || name)}</a>`;
	}

	function value_html(df, v, doc) {
		const ft = df.fieldtype;
		if (ft === "Check") return v ? `<span class="tm-ql-check">✓</span>` : "";
		if (ft === "Table" || ft === "Table MultiSelect") return table_html(df, v || []);
		if (empty(v)) return "";
		switch (ft) {
			case "Link": return link(df.options, v);
			case "Dynamic Link": return link(doc[df.options], v);
			case "Int": return num(v, 0);
			case "Float": return num(v);
			case "Percent": return num(v) + "%";
			case "Currency": {
				const cur = df.options && typeof doc[df.options] === "string" && /^[A-Z]{3}$/.test(doc[df.options]) ? " " + esc(doc[df.options]) : "";
				return num(v, 2) + cur;
			}
			case "Date": case "Datetime": return esc(F().datetime.str_to_user(v));
			case "Time": return esc(String(v).split(".")[0]);
			case "Rating": { const n = Math.round(Number(v) * 5); return `<span class="tm-ql-stars">${"★".repeat(n)}${"☆".repeat(Math.max(0, 5 - n))}</span>`; }
			case "Color": return `<span class="tm-ql-swatch" style="background:${esc(v)}"></span>${esc(v)}`;
			case "Attach": case "Attach Image": case "Signature": {
				if (/^data:image\//.test(v) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/i.test(v)) return `<a href="${esc(v)}" target="_blank" rel="noopener"><img class="tm-ql-img" src="${esc(v)}" alt=""></a>`;
				return `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(String(v).split("/").pop())}</a>`;
			}
			case "Text Editor": case "HTML Editor": case "Markdown Editor": return `<div class="tm-ql-rich">${sanitize(String(v))}</div>`;
			case "Small Text": case "Text": case "Long Text": case "Code": case "JSON":
				return `<div class="tm-ql-pre">${esc(typeof v === "object" ? JSON.stringify(v, null, 2) : v)}</div>`;
			default: return esc(ft === "Select" ? __(v) : v);
		}
	}

	function table_html(df, rows) {
		if (!rows.length) return "";
		const meta = F().model.get_meta(df.options) || { fields: [] };
		const fields = (meta.fields || []).filter((f) => !f.hidden && !NO_VALUE.includes(f.fieldtype) && f.fieldtype !== "Table");
		if (df.fieldtype === "Table MultiSelect") {
			const lf = fields.find((f) => f.fieldtype === "Link") || fields[0];
			if (!lf) return "";
			return rows.map((r) => `<span class="tm-ql-chip">${esc(r[lf.fieldname])}</span>`).join("");
		}
		let cols = fields.filter((f) => f.in_list_view);
		if (!cols.length) cols = fields.slice(0, 4);
		if (!cols.length) return "";
		const cc = (c) => (NUMERIC.includes(c.fieldtype) ? ' class="num"' : c.fieldtype === "Check" ? ' class="chk"' : "");
		let out = `<div class="tm-ql-table-wrap"><table class="tm-ql-table"><thead><tr><th class="idx" scope="col">#</th>`;
		cols.forEach((c) => { out += `<th${cc(c)} scope="col">${esc(__(c.label || c.fieldname))}</th>`; });
		out += `</tr></thead><tbody>`;
		rows.forEach((r, i) => {
			out += `<tr><td class="idx">${i + 1}</td>`;
			cols.forEach((c) => { out += `<td${cc(c)}>${c.fieldtype === "Check" ? (r[c.fieldname] ? '<span class="tm-ql-check">✓</span>' : "") : value_html(c, r[c.fieldname], r)}</td>`; });
			out += `</tr>`;
		});
		return out + `</tbody></table></div><div class="tm-ql-table-foot">${esc(rows.length === 1 ? __("1 row") : __("{0} rows", [rows.length]))}</div>`;
	}

	/* safe HTML for display (allowlist) */
	const ALLOWED = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "strike", "ul", "ol", "li", "blockquote", "pre", "code",
		"h1", "h2", "h3", "h4", "h5", "h6", "a", "span", "div", "img", "table", "thead", "tbody", "tr", "td", "th", "hr", "sub", "sup"]);
	function sanitize(str) {
		const doc = new DOMParser().parseFromString("<div>" + str + "</div>", "text/html");
		const walk = (node) => {
			Array.from(node.children).forEach((el) => {
				const tag = el.tagName.toLowerCase();
				if (!ALLOWED.has(tag)) {
					if (["script", "style", "iframe", "object", "embed", "link", "meta"].includes(tag)) { el.remove(); return; }
					el.replaceWith(...Array.from(el.childNodes));
					return;
				}
				Array.from(el.attributes).forEach((a) => {
					const n = a.name.toLowerCase();
					const v = a.value || "";
					const ok = ["class", "style", "href", "src", "alt", "title", "colspan", "rowspan", "dir"].includes(n);
					if (!ok || ((n === "href" || n === "src") && /^\s*javascript:/i.test(v)) || (n === "style" && /url\s*\(|expression/i.test(v))) el.removeAttribute(a.name);
				});
				if (tag === "a") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
				walk(el);
			});
		};
		const root = doc.body.firstChild;
		walk(root);
		return root.innerHTML;
	}

	/* ------------------------------------------------ Desk form (edit) -- */
	function fw() {
		try { return frame && frame.contentWindow && frame.contentWindow.frappe ? frame.contentWindow : null; } catch (e) { return null; }
	}

	function show_frame(target) {
		const body = panel.querySelector(".tm-ql-body");
		set_loading(true);
		if (!frame) {
			frame = document.createElement("iframe");
			frame.className = "tm-ql-frame";
			frame.title = __("Document preview");
			frame.addEventListener("load", on_frame_load);
			frame.src = F().desk_url(target.doctype, target.name);
			current = { ...target };
			body.appendChild(frame);
			return;
		}
		frame.style.display = "";
		if (!frame_ready) return; // still booting: the requested form is shown when done
		const w = fw();
		if (same(current, target) && w && w.cur_frm && w.cur_frm.docname === target.name) { set_loading(false); return; }
		try {
			w.frappe.set_route("Form", target.doctype, target.name);
		} catch (e) {
			frame_ready = false;
			frame.src = F().desk_url(target.doctype, target.name);
			return;
		}
		wait_for_form();
	}

	function on_frame_load() {
		const w = fw();
		if (!w) { set_loading(false); return; }
		try {
			const doc = frame.contentDocument;
			if (!doc.getElementById("tm-ql-frame-css")) {
				const style = doc.createElement("style");
				style.id = "tm-ql-frame-css";
				style.textContent = FRAME_CSS;
				doc.head.appendChild(style);
			}
			// Esc inside the displayed form closes the panel too
			w.addEventListener("keydown", (e) => {
				if (e.key === "Escape" && panel_open && !doc.querySelector(".modal.show")) close_panel();
			});
		} catch (err) { /* cosmetic only */ }
		frame_ready = true;
		if (wanted && mode === "edit" && !same(current, wanted)) {
			try { w.frappe.set_route("Form", wanted.doctype, wanted.name); } catch (e) { /* */ }
		}
		wait_for_form();
	}

	/* wait until the requested form renders in the frame, then remove the loading indicator */
	function wait_for_form() {
		const id = ++watch;
		const started = Date.now();
		const tick = () => {
			if (id !== watch) return;
			const w = fw();
			const f = w && w.cur_frm;
			if ((f && wanted && f.doctype === wanted.doctype && f.docname === wanted.name && f.page && f.page.wrapper && w.jQuery(f.page.wrapper).is(":visible"))
				|| Date.now() - started > 8000) {
				current = wanted ? { ...wanted } : current;
				if (mode === "edit") set_loading(false);
				return;
			}
			setTimeout(tick, 40);
		};
		tick();
	}

	/* ------------------------------------------------------------ API -- */
	/* prefetch: meta and document in memory so opening is near-instant */
	function prefetch(target) {
		if (!target || !target.doctype || !target.name) return;
		const k = key(target);
		if (fetched_at[k] && Date.now() - fetched_at[k] < FRESH_MS) return;
		F().model.with_doctype(target.doctype).then((meta) => {
			if (!meta) return;
			F().model.with_doc(target.doctype, target.name, null, true).then((d) => { if (d) fetched_at[k] = Date.now(); });
		});
	}

	function expand(target) {
		if (!target || !target.doctype || !target.name) return false;
		ensure_panel();
		panel_open = true;
		wanted = { ...target };
		panel.setAttribute("dir", document.documentElement.getAttribute("dir") || "ltr");
		panel.querySelector(".tm-ql-eyebrow").textContent = __(target.doctype);
		const t = panel.querySelector(".tm-ql-title");
		t.textContent = target.name;
		t.title = `${__(target.doctype)} · ${target.name}`;
		panel.querySelector(".tm-ql-sub").textContent = "";
		panel.querySelector(".tm-ql-status").innerHTML = "";
		const toc = panel.querySelector(".tm-ql-toc");
		toc.hidden = true;
		toc.innerHTML = "";
		panel.querySelector(".tm-ql-view").innerHTML = "";
		panel.querySelector(".tm-ql-side-scroll").innerHTML = skeleton_side();
		if (is_mobile()) set_side_collapsed(true, false);
		panel.querySelector(".tm-ql-open").setAttribute("href", F().desk_url(target.doctype, target.name));
		set_mode("view");
		requestAnimationFrame(() => {
			backdrop.classList.add("open");
			panel.classList.add("open");
			set_side_w(side_w, false); // re-clamp to the current viewport
		});
		return true;
	}

	function close_panel() {
		if (!panel_open) return;
		panel_open = false;
		seq++;
		panel.classList.remove("open");
		backdrop.classList.remove("open");
		// the edit frame stays loaded for reuse
	}

	window.ToDoBoxQuickLook = {
		expand: (target) => expand(target ? { ...target } : null),
		prefetch: (target) => prefetch(target ? { ...target } : null),
		is_open: () => panel_open,
		close: close_panel,
	};
})();
