/* =============================================================================
   ToDoBox — Frappe form controls on the standalone /todobox page.

   The fields are the real Frappe controls (frappe.ui.form.make_control from
   controls.bundle.js, loaded on demand with frappe.require — the way Web Forms
   use them), wrapped so the React-driven drawer can mount them into slots:

     Data        — ControlData
     UserMulti   — ControlMultiSelectPills on enabled system users (avatars, workload)
     Link        — ControlLink / ControlDynamicLink (search_link, get_query filters)
     DateControl — ControlDate (Frappe's datepicker, system date format, first day of the week)
     Select      — ControlSelect (priority)
     TagsInput   — ControlMultiSelectPills with the known tags (typed text = new tag)
     TextEditor  — ControlTextEditor (Quill) with Frappe's toolbar
     pickDate()  — Frappe's datepicker opened right at a date button (due date, filters,
                   analytics range, recurrence), with nothing else around it

   Not field look-alikes, so they stay app components:
     Checklist   — add with Enter, edit inline, reorder, delete
     Attach      — multi-file drop zone + paste with upload progress. ControlAttach
                   holds ONE file URL and opens the Desk's Vue upload dialog (Desk
                   modal CSS, ~650 KB); a new task takes several private, unattached
                   uploads that the server links once the task exists.

   Every control: new X(parent, opts) · set_value(v) (no change event) ·
   get_value() · focus() · destroy(); opts.onChange(v) fires on user changes.
   ============================================================================= */
(function () {
	"use strict";

	var __ = function (t, r) { return window.__ ? window.__(t, r) : t; };
	var ASSETS = "/assets/todobox/";

	/* ------------------------------------------------------------------ utils -- */
	function isRTL() { return (document.documentElement.getAttribute("dir") || "ltr") === "rtl"; }
	function same(a, b) { return JSON.stringify(a == null || a === "" ? null : a) === JSON.stringify(b == null || b === "" ? null : b); }
	function esc(t) { return frappe.utils.escape_html(t == null ? "" : String(t)); }

	/** h('div', {class, text, html, onclick, style, …attrs}, ...children) */
	function h(tag, attrs) {
		var n = document.createElement(tag);
		var a = attrs || {};
		Object.keys(a).forEach(function (k) {
			var v = a[k];
			if (v == null || v === false) return;
			if (k === "class") n.className = v;
			else if (k === "text") n.textContent = v;
			else if (k === "html") n.innerHTML = v;
			else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
			else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
			else n.setAttribute(k, v === true ? "" : v);
		});
		for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
		return n;
	}
	function append(n, kid) {
		if (kid == null || kid === false) return;
		if (Array.isArray(kid)) { kid.forEach(function (k) { append(n, k); }); return; }
		n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
	}
	var SVGNS = "http://www.w3.org/2000/svg";
	function icon(id, cls) {
		var s = document.createElementNS(SVGNS, "svg");
		s.setAttribute("class", "tmc-ic" + (cls ? " " + cls : ""));
		s.setAttribute("aria-hidden", "true");
		var u = document.createElementNS(SVGNS, "use");
		u.setAttribute("href", "#i-" + id);
		s.appendChild(u);
		return s;
	}
	function avatarHtml(u, size) {
		u = u || {};
		var st = "width:" + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.42) + "px;";
		if (u.user_image) return '<span class="tmc-ava" style="' + st + '"><img src="' + esc(u.user_image) + '" alt=""></span>';
		return '<span class="tmc-ava" style="' + st + "background:" + esc(u.color || "var(--primary-soft)") + '">' +
			esc(u.initials || (u.name || "?").slice(0, 1).toUpperCase()) + "</span>";
	}
	/* ------------------------------------------------------------ dates -- */
	function pad(n) { return String(n).padStart(2, "0"); }
	function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
	function parseISO(v) {
		var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || "");
		return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
	}
	function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
	function todayISO() { return frappe.datetime.get_today(); }
	function dateFormat() { return String((frappe.boot.sysdefaults || {}).date_format || "dd-mm-yyyy"); }

	/* --------------------------------------------------------------- loading -- */
	/* controls.bundle.js is fetched once, the first time a control is needed (and
	   in the background when the browser is idle), with Frappe's own control CSS
	   (css/frappe_controls[_rtl].css, generated from website.bundle.css and scoped
	   to .tm-frappe) and a little layout glue (css/todobox_controls.css). */
	var loading = null;
	function addCss(href) {
		if (document.querySelector('link[href="' + href + '"]')) return;
		document.head.appendChild(h("link", { rel: "stylesheet", href: href }));
	}
	function ready() {
		if (loading) return loading;
		var ver = (window.todobox_boot && window.todobox_boot.asset_version) || "";
		addCss(ASSETS + "css/frappe_controls" + (isRTL() ? "_rtl" : "") + ".css?v=" + ver);
		addCss(ASSETS + "css/todobox_controls.css?v=" + ver);
		loading = new Promise(function (resolve, reject) {
			if (frappe.ui.form && frappe.ui.form.make_control) { resolve(); return; }
			var t = setTimeout(function () { reject(new Error("controls.bundle.js did not load")); }, 30000);
			frappe.require("controls.bundle.js", function () { clearTimeout(t); resolve(); });
		}).then(setupControls, function (e) { loading = null; throw e; });
		return loading;
	}
	var patched = false;
	function setupControls() {
		if (patched) return;
		patched = true;
		/* Link: this page never offers "Create a new …" / "Advanced Search" (Desk dialogs) */
		frappe.model.can_create = function () { return false; };
		frappe.model.can_select = frappe.model.can_read = function () { return true; };
	}
	if ("requestIdleCallback" in window) window.requestIdleCallback(function () { ready().catch(function () { /* */ }); }, { timeout: 6000 });
	else setTimeout(function () { ready().catch(function () { /* */ }); }, 3000);

	/* --------------------------------------------------------- popup handling -- */
	/* Esc closes the innermost open popup (datepicker, awesomplete list, date popover)
	   before anything else (the drawer, the app's shortcuts) sees the key. */
	var openPops = [];
	function visibleDatepicker() {
		var dp = document.querySelector(".datepickers-container .datepicker.active");
		return dp || null;
	}
	function openAwesomplete() {
		var ul = document.querySelector('.tm-frappe .awesomplete > ul:not([hidden])');
		return ul && ul.children.length ? ul : null;
	}
	function anyPopoverOpen() { return !!(openPops.length || visibleDatepicker() || openAwesomplete()); }
	function closeTopPopover() {
		var ul = openAwesomplete();
		if (ul) {
			var inp = ul.parentNode.querySelector("input");
			var aw = inp && jQuery(inp).data("awesomplete");
			if (inp && inp.awesomplete) inp.awesomplete.close();
			else if (aw) aw.close();
			else ul.setAttribute("hidden", "");
			return true;
		}
		if (visibleDatepicker()) {
			jQuery(".tm-frappe input").each(function () {
				var dp = jQuery(this).data("datepicker");
				if (dp && dp.visible) dp.hide();
			});
			return true;
		}
		var p = openPops[openPops.length - 1];
		if (p) { p.close(); return true; }
		return false;
	}
	window.addEventListener("keydown", function (e) {
		if (e.key !== "Escape" || !anyPopoverOpen()) return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		closeTopPopover();
	}, true);

	/* Search fields (Link, MultiSelectPills…) list their own suggestions: keep the
	   browser's autofill and password managers out of them. Chrome ignores
	   autocomplete="off" on fields that look like names/emails, so the input also gets
	   a unique token and name, plus the opt-outs of common password managers. */
	var nofill = 0;
	function noAutofill($in) {
		nofill += 1;
		var token = "tm-nofill-" + nofill + "-" + Math.random().toString(36).slice(2, 8);
		$in.attr({
			autocomplete: token, name: token, "aria-autocomplete": "list", spellcheck: "false",
			"data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true", "data-form-type": "other",
		});
	}

	/* ------------------------------------------------------------- Field base -- */
	/* A Frappe control (label above, .frappe-control markup, Frappe's look) in a
	   wrapper. df: Frappe docfield (label, reqd, description…); opts: value,
	   onChange, inputId, ariaLabel. The wrapper keeps the last value it reported so
	   that set_value() from the app does not echo back as a user change. */
	function Field(parent, opts, df, cls) {
		this.opts = opts || {};
		this.value = this.opts.value == null ? null : this.opts.value;
		this.wrap = h("div", { class: "tmc-ctl tmc-fc tm-frappe " + (cls || "") });
		parent.appendChild(this.wrap);
		if (typeof this.opts.label === "string" && !df.label) df.label = this.opts.label;
		if (this.opts.reqd) df.reqd = 1;
		if (this.opts.description) df.description = this.opts.description;
		this.df = df;
		this.doc = {};
		var self = this;
		this.control = frappe.ui.form.make_control({
			df: Object.assign({ fieldname: "value", label: "", change: function () { self.changed(); } }, df),
			parent: this.wrap,
			doc: this.doc,
			render_input: true,
		});
		/* air-datepicker's popup container lives in <body>: give it Frappe's styles too */
		jQuery("#datepickers-container").addClass("tm-frappe");
		var $in = this.control.$input;
		if ($in && this.opts.inputId) $in.attr("id", this.opts.inputId);
		if ($in && this.opts.ariaLabel) $in.attr("aria-label", this.opts.ariaLabel);
		if ($in && df.placeholder) $in.attr("placeholder", df.placeholder);
		if ($in) $in.attr("autocomplete", "off");
		if ($in && /Link|MultiSelect|Autocomplete/.test(df.fieldtype)) noAutofill($in);
		/* the app shows its own "required" message when sending, not while the form is empty */
		this.control.set_mandatory = function () {};
		/* …including the has-error the first render already put on an empty required field */
		if (this.control.$wrapper) this.control.$wrapper.removeClass("has-error");
		if (this.value != null && this.value !== "") this.push(this.value);
	}
	/** Frappe's own invalid-field state (.has-error on .frappe-control) */
	Field.prototype.set_error = function (bad) { if (this.control.$wrapper) this.control.$wrapper.toggleClass("has-error", !!bad); };
	Field.prototype.read = function () { var v = this.control.get_value(); return v === undefined || v === "" ? null : v; };
	Field.prototype.changed = function () {
		var v = this.read();
		if (same(v, this.value)) return;
		this.value = v;
		this.after_change && this.after_change(v);
		if (this.opts.onChange) this.opts.onChange(v);
	};
	/** app → control (no onChange) */
	Field.prototype.push = function (v) { return this.control.set_value(v == null ? "" : v); };
	Field.prototype.set_value = function (v) {
		if (same(v, this.value)) return;
		this.value = v;
		this.push(v);
		this.after_change && this.after_change(v);
	};
	Field.prototype.get_value = function () { return this.value; };
	/** Frappe's label / required asterisk / description, changed after the control exists */
	Field.prototype.set_label = function (label) {
		var c = this.control;
		if (!label || label === c.df.label || !c.set_label) return;
		c.set_label(label);
	};
	Field.prototype.set_reqd = function (reqd) {
		var c = this.control;
		if (!!c.df.reqd === !!reqd) return;
		c.df.reqd = reqd ? 1 : 0;
		if (c.set_required) c.set_required();
	};
	Field.prototype.set_description = function (text) {
		var c = this.control;
		if ((c.df.description || "") === (text || "")) return;
		c.df.description = text || "";
		if (c.set_description) c.set_description(text || "");
	};
	Field.prototype.focus = function () { if (this.control.set_focus) this.control.set_focus(); };
	Field.prototype.destroy = function () {
		var dp = this.control && this.control.datepicker;
		if (dp) { try { dp.destroy(); } catch (e) { /* */ } }
		this.wrap.remove();
	};
	function inherit(Child, Parent) {
		Child.prototype = Object.create((Parent || Field).prototype);
		Child.prototype.constructor = Child;
		return Child;
	}

	/* ------------------------------------------------------------------ Data -- */
	/* opts: value, label, reqd, placeholder, inputId, maxlength, onEnter() */
	var Data = inherit(function Data(parent, opts) {
		Field.call(this, parent, opts, { fieldtype: "Data", fieldname: opts.inputId || "data", placeholder: opts.placeholder || "" }, "tmc-data");
		var self = this, $in = this.control.$input;
		if (opts.maxlength) $in.attr("maxlength", opts.maxlength);
		$in.attr("dir", "auto");
		/* report every keystroke (Data only commits on change/blur) */
		$in.on("input", function () { self.value = $in.val(); if (opts.onChange) opts.onChange(self.value); });
		$in.on("keydown", function (e) {
			if (e.key === "Enter" && !e.isComposing && !e.ctrlKey && !e.metaKey && opts.onEnter) { e.preventDefault(); opts.onEnter(); }
		});
	});
	Data.prototype.read = function () { return this.control.$input.val(); };
	Data.prototype.set_value = function (v) {
		v = v || "";
		if (v === this.value) return;
		this.value = v;
		if (this.control.$input.val() !== v) this.control.$input.val(v);
	};

	/* MultiSelectPills.parse() pushes into this.rows — the very array held as the control's value
	   after set_value — so the "new" value is identical to the old one and Frappe skips the refresh:
	   only the first pill ever showed. Return a fresh array instead. */
	function freshParse(c) {
		c.parse = function (value) {
			if (typeof value == "object" || !this.rows) return value;
			var rows = (this.rows || []).slice();
			if (value) rows.push(value);
			this.rows = rows;
			return rows;
		};
	}

	/* ------------------------------------------------------------- UserMulti -- */
	/* MultiSelectPills of user ids. opts: value [ids], search(txt, exclude) →
	   Promise<[{id,name,initials,color,user_image,open,overdue}]> (enabled system users),
	   user(id) → {name, initials, color, user_image}, placeholder, inputId, label */
	var UserMulti = inherit(function UserMulti(parent, opts) {
		var self = this;
		this.meta = {};
		Field.call(this, parent, Object.assign({}, opts, { value: null }), {
			fieldtype: "MultiSelectPills", fieldname: opts.inputId || "users", placeholder: opts.placeholder || "",
			get_data: function (txt) {
				var chosen = (self.control && self.control.rows) || [];
				return Promise.resolve(opts.search(txt || "", chosen)).then(function (rows) {
					return (rows || []).filter(function (u) { return chosen.indexOf(u.id) < 0; }).slice(0, 8).map(function (u) {
						self.meta[u.id] = u;
						return { value: u.id, label: u.name || u.id, description: u.id };
					});
				});
			},
		}, "tmc-pills tmc-users");
		var c = this.control;
		freshParse(c);
		c.$input.attr("aria-label", opts.label || "").attr("spellcheck", "false");
		c.get_label = function (v) { var u = opts.user(v) || self.meta[v]; return (u && u.name) || v; };
		c.get_pill_html = function (v) { return self.pill(v); };
		/* only known users become pills (typed text that matches nobody is dropped) */
		var base_validate = c.validate;
		c.validate = function (rows) {
			rows = base_validate.call(c, rows) || [];
			return rows.filter(function (id) { return self.meta[id] || (opts.user(id) && opts.user(id).name && opts.user(id).name !== id) || (self.value || []).indexOf(id) >= 0; });
		};
		c.awesomplete.item = function (item) {
			var u = self.meta[item.value] || { name: item.label, id: item.value };
			var li = document.createElement("li");
			li.setAttribute("role", "option");
			li.setAttribute("aria-selected", "false");
			li.className = "tmc-user-opt";
			li.innerHTML = avatarHtml(u, 26) + '<span class="tmc-dd-main"><span class="tmc-dd-label">' + esc(u.name || item.value) +
				'</span><span class="tmc-dd-sub" dir="ltr">' + esc(item.value) + "</span></span>";
			return li;
		};
		if (opts.value && opts.value.length) this.set_value(opts.value);
	}, Field);
	UserMulti.prototype.pill = function (v) {
		var u = this.opts.user(v) || this.meta[v] || { name: v };
		return '<button type="button" class="data-pill btn tb-selected-value" data-value="' + encodeURIComponent(v) + '" title="' + esc(v) + '">' +
			avatarHtml(u, 18) + '<span class="btn-link-to-form">' + esc(u.name || v) + "</span>" +
			'<span class="btn-remove" role="button" aria-label="' + esc(__("Remove {0}", [u.name || v])) + '">' + frappe.utils.icon("x", "xs") + "</span></button>";
	};
	UserMulti.prototype.read = function () { return (this.control.rows || []).slice(); };
	UserMulti.prototype.push = function (v) { this.control.rows = (v || []).slice(); return this.control.set_value((v || []).slice()); };
	UserMulti.prototype.set_value = function (v) {
		v = (v || []).slice();
		if (same(v, this.value || [])) return;
		this.value = v;
		this.push(v);
	};
	UserMulti.prototype.changed = function () {
		var v = this.read();
		if (same(v, this.value || [])) return;
		this.value = v;
		if (this.opts.onChange) this.opts.onChange(v);
	};
	UserMulti.prototype.focus = function () { this.control.$input.focus(); };

	/* ------------------------------------------------------------- TagsInput -- */
	/* MultiSelectPills of free-form tags. opts: value [labels], suggestions() → [labels], placeholder */
	var TagsInput = inherit(function TagsInput(parent, opts) {
		var self = this;
		Field.call(this, parent, Object.assign({}, opts, { value: null }), {
			fieldtype: "MultiSelectPills", fieldname: "tags", placeholder: opts.placeholder || "",
			/* suggestions(q) → [labels] or a Promise of them (the Frappe Tag list) */
			get_data: function (txt) {
				var q = String(txt || "").trim(), ql = q.toLowerCase();
				return Promise.resolve(opts.suggestions(q)).then(function (list) {
					var chosen = (self.control && self.control.rows) || [];
					var all = (list || []).filter(function (t) { return t && chosen.indexOf(t) < 0; });
					var rows = all.filter(function (t) { return !ql || t.toLowerCase().indexOf(ql) >= 0; }).slice(0, 10)
						.map(function (t) { return { value: t, label: t }; });
					if (q && !all.concat(chosen).some(function (t) { return t.toLowerCase() === ql; })) {
						rows.unshift({ value: q.replace(/,/g, " "), label: __("Create tag “{0}”", [q]) });
					}
					return rows;
				});
			},
		}, "tmc-pills tmc-tags");
		var c = this.control;
		freshParse(c);
		c.$input.attr("aria-label", opts.ariaLabel || "");
		c.get_label = function (v) { return v; };
		c.get_pill_html = function (v) {
			return '<button type="button" class="data-pill btn tb-selected-value" data-value="' + encodeURIComponent(v) + '">' +
				'<svg class="tmc-ic" aria-hidden="true"><use href="#i-tag"></use></svg><span class="btn-link-to-form">' + esc(v) + "</span>" +
				'<span class="btn-remove" role="button" aria-label="' + esc(__("Remove tag {0}", [v])) + '">' + frappe.utils.icon("x", "xs") + "</span></button>";
		};
		/* Enter / comma add the typed tag even when the list is closed */
		c.$input.on("keydown", function (e) {
			if ((e.key === "," || e.key === "Enter") && c.$input.val().trim() && !(c.awesomplete.opened && c.awesomplete.index > -1)) {
				e.preventDefault();
				e.stopPropagation();
				self.addTyped();
			}
		});
		if (opts.value && opts.value.length) this.set_value(opts.value);
	}, Field);
	TagsInput.prototype.read = UserMulti.prototype.read;
	TagsInput.prototype.push = UserMulti.prototype.push;
	TagsInput.prototype.set_value = UserMulti.prototype.set_value;
	TagsInput.prototype.changed = UserMulti.prototype.changed;
	TagsInput.prototype.focus = UserMulti.prototype.focus;
	/** adds what is typed but not picked yet (before sending) */
	TagsInput.prototype.addTyped = function () {
		var c = this.control, t = String(c.$input.val() || "").trim().replace(/,/g, " ");
		c.$input.val("");
		if (!t || (c.rows || []).indexOf(t) >= 0) return;
		this.value = (c.rows || []).concat([t]);
		this.push(this.value);
		if (this.opts.onChange) this.opts.onChange(this.value.slice());
	};

	/* ----------------------------------------------------------------- Link -- */
	/* opts: value, doctype | dynamic (() → doctype), filters (get_query filters, or () → filters),
	   display(value) → text shown in the input, label, placeholder, inputId, ariaLabel, disabled, onOpen(value) */
	var Link = inherit(function Link(parent, opts) {
		var self = this;
		var df = {
			fieldtype: opts.dynamic ? "Dynamic Link" : "Link", fieldname: opts.inputId || "link",
			options: opts.doctype || "", placeholder: opts.placeholder || "", only_select: 1, with_link_btn: true, ignore_user_permissions: 0,
		};
		if (opts.dynamic) df.get_options = function () { return opts.dynamic() || ""; };
		/* filters: an object, or a function returning one (read on every search / validation) */
		if (opts.filters) df.get_query = function () { return { filters: typeof opts.filters === "function" ? opts.filters() : opts.filters }; };
		Field.call(this, parent, opts, df, "tmc-link");
		var c = this.control;
		c.get_filter_description = function () { return Promise.resolve(null); };
		c.$input.attr("spellcheck", "false");
		/* the "open" arrow opens the Desk in a new tab */
		if (c.$link_open) {
			c.$link_open.attr({ target: "_blank", rel: "noopener", "aria-label": __("Open Link") });
			c.$link_open.on("click", function (e) {
				if (!opts.onOpen || !self.value) return;
				e.preventDefault();
				opts.onOpen(self.value);
			});
		}
		if (opts.display) {
			c.translate_and_set_input_value = function (title, value) {
				var shown = value ? opts.display(value) : "";
				c.title_value_map = c.title_value_map || {};
				c.title_value_map[shown] = value;
				c.set_input_value(shown);
			};
		}
		c.$input.on("awesomplete-select", function (e) {
			var o = e.originalEvent, item = o && o.text && c.awesomplete.get_item(o.text.value);
			if (item && opts.remember) opts.remember(item);
		});
		this.setDisabled(!!opts.disabled);
	}, Field);
	Link.prototype.setDisabled = function (d) {
		this.opts.disabled = d;
		this.control.$input.prop("disabled", !!d);
		this.wrap.classList.toggle("is-disabled", !!d);
	};

	/* ----------------------------------------------------------- DateControl -- */
	/* ControlDate (Frappe's datepicker, system date format). opts: value 'YYYY-MM-DD', label, onChange, inputId */
	var DateControl = inherit(function DateControl(parent, opts) {
		Field.call(this, parent, opts, { fieldtype: "Date", fieldname: opts.inputId || "date" }, "tmc-date");
	}, Field);

	/* ------------------------------------------------------------ TextEditor -- */
	function emptyHtml(html) {
		var t = String(html || "");
		return !t.replace(/<(p|br|div)[^>]*>|<\/(p|div)>|&nbsp;|\s/g, "").length && !/<img/i.test(t);
	}
	/** ControlTextEditor wraps its value in <div class="ql-editor read-mode">: keep the inner HTML */
	function unwrap(html) {
		var m = /^<div class="ql-editor read-mode">([\s\S]*)<\/div>$/.exec(String(html || "").trim());
		return m ? m[1] : String(html || "");
	}
	/** plain text saved before the editor existed (textarea, API): keep its line breaks in Quill */
	function toEditorHtml(v) {
		var t = String(v == null ? "" : v);
		if (!t || /<[a-z!\/][^>]*>/i.test(t)) return t;
		return t.split(/\r?\n/).map(function (line) { return "<p>" + (line ? esc(line) : "<br>") + "</p>"; }).join("");
	}
	/* ControlTextEditor with Frappe's default toolbar. opts: value (html), label, placeholder, onChange */
	var TextEditor = inherit(function TextEditor(parent, opts) {
		Field.call(this, parent, opts, { fieldtype: "Text Editor", fieldname: opts.inputId || "details", placeholder: opts.placeholder || "" }, "tmc-editor");
		var q = this.control.quill, self = this;
		q.root.setAttribute("dir", "auto"); /* Arabic text in an English UI (and vice versa) aligns itself */
		/* report as you type (the control itself debounces by 300 ms) */
		q.on("text-change", function (d, o, source) { if (source === "user") self.changedSoon(); });
		this.changedSoon = frappe.utils.debounce(function () { self.changed(); }, 120);
	}, Field);
	TextEditor.prototype.read = function () {
		var html = unwrap(this.control.get_input_value());
		return emptyHtml(html) ? "" : html;
	};
	TextEditor.prototype.changed = function () {
		var v = this.read();
		if ((v || "") === (this.value || "")) return;
		this.value = v;
		if (this.opts.onChange) this.opts.onChange(v);
	};
	TextEditor.prototype.push = function (v) { return Field.prototype.push.call(this, toEditorHtml(v)); };
	TextEditor.prototype.set_value = function (v) {
		v = v || "";
		if (v === (this.value || "")) return;
		this.value = v;
		this.control.set_formatted_input(toEditorHtml(v));
		this.control.value = this.control.get_input_value();
	};
	TextEditor.prototype.focus = function () { this.control.quill.focus(); };

	/* ---------------------------------------------------------------- Select -- */
	/* ControlSelect. opts: value, label, options [{value, label}] */
	var Select = inherit(function Select(parent, opts) {
		Field.call(this, parent, opts, { fieldtype: "Select", fieldname: opts.inputId || "select", options: opts.options }, "tmc-select");
	}, Field);
	/* ------------------------------------------------------------- Checklist -- */
	/* opts: value [strings], placeholder */
	function Checklist(parent, opts) {
		this.opts = opts || {};
		this.value = (this.opts.value || []).slice();
		this.wrap = h("div", { class: "tmc-ctl tmc-check" });
		parent.appendChild(this.wrap);
		var self = this;
		this.list = h("div", { class: "tmc-check-list", role: "list" });
		this.newInput = h("input", {
			type: "text", class: "tmc-input tmc-check-new", placeholder: this.opts.placeholder || __("Add a step… (Enter)"), "aria-label": __("Add a step"),
			onkeydown: function (e) {
				if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); self.addTyped(); }
				else if (e.key === "Backspace" && !self.newInput.value && self.value.length) { e.preventDefault(); self.focusItem(self.value.length - 1); }
				else if (e.key === "ArrowUp" && self.value.length) { e.preventDefault(); self.focusItem(self.value.length - 1); }
			},
			onblur: function () { self.addTyped(true); },
		});
		this.addBtn = h("button", { type: "button", class: "tmc-icon-btn", "aria-label": __("Add step"), title: __("Add step"),
			onclick: function () { self.addTyped(); } }, icon("plus"));
		this.wrap.appendChild(this.list);
		this.wrap.appendChild(h("div", { class: "tmc-check-add" }, h("span", { class: "tmc-check-box is-ghost" }, icon("plus")), this.newInput, this.addBtn));
		this.refresh();
	}
	Checklist.prototype.get_value = function () { return this.value; };
	Checklist.prototype.destroy = function () { this.wrap.remove(); };
	Checklist.prototype.set_value = function (v) {
		v = (v || []).slice();
		if (same(v, this.value)) return;
		this.value = v;
		this.refresh();
	};
	Checklist.prototype.emit = function () { if (this.opts.onChange) this.opts.onChange(this.value.slice()); };
	Checklist.prototype.refresh = function () {
		var self = this;
		this.list.innerHTML = "";
		this.value.forEach(function (label, i) {
			var inp = h("input", {
				type: "text", class: "tmc-check-input", value: label, "aria-label": __("Step {0}", [i + 1]),
				oninput: function () { self.value[i] = inp.value; self.emit(); },
				onkeydown: function (e) { self.itemKey(e, i, inp); },
			});
			var row = h("div", { class: "tmc-check-row", role: "listitem", draggable: "false", "data-i": i },
				h("span", { class: "tmc-check-grip", title: __("Drag to reorder"), "aria-hidden": "true",
					onpointerdown: function () { row.setAttribute("draggable", "true"); } }, "⋮⋮"),
				h("span", { class: "tmc-check-box" }),
				inp,
				h("span", { class: "tmc-check-acts" },
					h("button", { type: "button", class: "tmc-icon-btn tmc-sm", tabindex: "-1", title: __("Move up"), "aria-label": __("Move up"), disabled: i === 0 ? true : null,
						onclick: function () { self.move(i, -1); } }, icon("chev-up")),
					h("button", { type: "button", class: "tmc-icon-btn tmc-sm", tabindex: "-1", title: __("Move down"), "aria-label": __("Move down"), disabled: i === self.value.length - 1 ? true : null,
						onclick: function () { self.move(i, 1); } }, icon("chev-down")),
					h("button", { type: "button", class: "tmc-icon-btn tmc-sm tmc-danger", title: __("Delete step"), "aria-label": __("Delete step"),
						onclick: function () { self.del(i); } }, icon("x"))));
			row.addEventListener("dragstart", function (e) { self.dragFrom = i; row.classList.add("is-drag"); try { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; } catch (x) { /* */ } });
			row.addEventListener("dragend", function () { row.setAttribute("draggable", "false"); row.classList.remove("is-drag"); self.dragFrom = null; });
			row.addEventListener("dragover", function (e) { if (self.dragFrom == null) return; e.preventDefault(); row.classList.add("is-over"); });
			row.addEventListener("dragleave", function () { row.classList.remove("is-over"); });
			row.addEventListener("drop", function (e) {
				e.preventDefault();
				row.classList.remove("is-over");
				if (self.dragFrom == null || self.dragFrom === i) return;
				var it = self.value.splice(self.dragFrom, 1)[0];
				self.value.splice(i, 0, it);
				self.dragFrom = null;
				self.refresh();
				self.emit();
			});
			self.list.appendChild(row);
		});
		this.wrap.classList.toggle("is-empty", !this.value.length);
	};
	Checklist.prototype.focusItem = function (i, atEnd) {
		var inp = this.list.querySelectorAll(".tmc-check-input")[i];
		if (!inp) { this.newInput.focus(); return; }
		inp.focus();
		if (atEnd !== false) { var n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (e) { /* */ } }
	};
	Checklist.prototype.itemKey = function (e, i, inp) {
		if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); e.stopPropagation(); this.move(i, e.key === "ArrowUp" ? -1 : 1); return; }
		if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); this.focusItem(i + 1); return; }
		if (e.key === "ArrowDown") { e.preventDefault(); this.focusItem(i + 1); return; }
		if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); this.focusItem(i - 1); return; }
		if (e.key === "Backspace" && !inp.value) { e.preventDefault(); this.del(i); this.focusItem(Math.max(0, i - 1)); }
	};
	Checklist.prototype.move = function (i, d) {
		var j = i + d;
		if (j < 0 || j >= this.value.length) return;
		var it = this.value.splice(i, 1)[0];
		this.value.splice(j, 0, it);
		this.refresh();
		this.emit();
		this.focusItem(j);
	};
	Checklist.prototype.del = function (i) {
		this.value.splice(i, 1);
		this.refresh();
		this.emit();
	};
	Checklist.prototype.addTyped = function (silentFocus) {
		var t = this.newInput.value.trim();
		if (!t) return;
		this.newInput.value = "";
		this.value.push(t);
		this.refresh();
		this.emit();
		if (!silentFocus) this.newInput.focus();
	};
	Checklist.prototype.focus = function () { this.newInput.focus(); };

	/* ----------------------------------------------------------------- Attach -- */
	/* Private, unattached uploads (frappe.upload_file → /api/method/upload_file) with
	   progress; the server links the File rows to the task after it is created. */
	function fmtSize(n) {
		if (!n && n !== 0) return "";
		/* LTR isolate so "17 KB" does not flip inside RTL text */
		var t = n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";
		return "⁦" + t + "⁩";
	}
	/* opts: value [{name,label,url,size}], onChange, onDiscard(name), onPending(count) */
	function Attach(parent, opts) {
		this.opts = opts || {};
		this.value = (this.opts.value || []).slice();
		this.pending = [];
		this.wrap = h("div", { class: "tmc-ctl tmc-attach" });
		parent.appendChild(this.wrap);
		var self = this;
		this.file = h("input", { type: "file", multiple: true, class: "tmc-hidden", tabindex: "-1", "aria-hidden": "true",
			onchange: function () { self.addFiles(self.file.files); self.file.value = ""; } });
		this.zone = h("div", { class: "tmc-drop", role: "button", tabindex: "0", "aria-label": __("Attach files"),
			onclick: function () { self.file.click(); },
			onkeydown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); self.file.click(); } },
			ondragover: function (e) { e.preventDefault(); self.zone.classList.add("is-over"); },
			ondragleave: function () { self.zone.classList.remove("is-over"); },
			ondrop: function (e) { e.preventDefault(); self.zone.classList.remove("is-over"); if (e.dataTransfer) self.addFiles(e.dataTransfer.files); },
		}, icon("paperclip"), h("span", { class: "tmc-drop-text" },
			h("b", { text: __("Drop files here") }), " ", __("or"), " ", h("span", { class: "tmc-drop-link", text: __("browse") })),
			h("span", { class: "tmc-drop-sub", text: __("You can also paste an image") }));
		this.list = h("div", { class: "tmc-files" });
		this.wrap.appendChild(this.file);
		this.wrap.appendChild(this.zone);
		this.wrap.appendChild(this.list);
		this.refresh();
	}
	Attach.prototype.get_value = function () { return this.value; };
	Attach.prototype.destroy = function () { this.wrap.remove(); };
	Attach.prototype.focus = function () { this.zone.focus(); };
	Attach.prototype.set_value = function (v) {
		v = (v || []).slice();
		if (same(v, this.value)) return;
		this.value = v;
		this.refresh();
	};
	Attach.prototype.refresh = function () {
		var self = this;
		this.list.innerHTML = "";
		var row = function (f, p) {
			var bar = p ? h("span", { class: "tmc-file-bar" }, h("span", { style: { width: Math.round((p.progress || 0) * 100) + "%" } })) : null;
			return h("div", { class: "tmc-file" + (p && p.error ? " is-error" : "") + (p && !p.error ? " is-up" : ""), title: f.label },
				icon("paperclip"),
				h("span", { class: "tmc-file-main" },
					h("span", { class: "tmc-file-name", text: f.label }),
					h("span", { class: "tmc-file-sub", text: p ? (p.error || __("Uploading… {0}%", [Math.round((p.progress || 0) * 100)])) : fmtSize(f.size) }),
					bar),
				h("button", { type: "button", class: "tmc-icon-btn tmc-sm", "aria-label": __("Remove attachment"), title: __("Remove attachment"),
					onclick: function () { if (p) self.dropPending(p); else self.remove(f); } }, icon("x")));
		};
		this.value.forEach(function (f) { self.list.appendChild(row(f, null)); });
		this.pending.forEach(function (p) { self.list.appendChild(row({ label: p.label }, p)); });
	};
	Attach.prototype.notifyPending = function () {
		var n = this.pending.filter(function (p) { return !p.error; }).length;
		if (this.opts.onPending) this.opts.onPending(n);
	};
	Attach.prototype.addFiles = function (files) {
		var self = this;
		Array.prototype.slice.call(files || []).forEach(function (file) {
			var label = file.name && file.name !== "image.png" ? file.name : __("Pasted image") + " " + new Date().toTimeString().slice(0, 8).replace(/:/g, "") + ".png";
			var p = { label: label, progress: 0, error: null };
			self.pending.push(p);
			var named = file.name === label ? file : new File([file], label, { type: file.type });
			frappe.upload_file(named, { is_private: 1, folder: "Home/Attachments", silent: true,
				on_progress: function (x) { p.progress = x; self.paintProgress(p); } }).then(function (doc) {
				self.pending = self.pending.filter(function (q) { return q !== p; });
				if (p.dropped) { if (self.opts.onDiscard) self.opts.onDiscard(doc.name); return; }
				self.value = self.value.concat([{ name: doc.name, label: doc.file_name || label, url: doc.file_url, size: file.size }]);
				self.refresh();
				self.notifyPending();
				if (self.opts.onChange) self.opts.onChange(self.value.slice());
			}, function (err) {
				p.error = (err && err.message) || __("Upload failed");
				self.refresh();
				self.notifyPending();
			});
		});
		this.refresh();
		this.notifyPending();
	};
	Attach.prototype.paintProgress = function (p) {
		var i = this.pending.indexOf(p);
		var rows = this.list.querySelectorAll(".tmc-file.is-up, .tmc-file.is-error");
		var r = rows[i];
		if (!r) return;
		var pct = Math.round(p.progress * 100);
		var bar = r.querySelector(".tmc-file-bar > span");
		if (bar) bar.style.width = pct + "%";
		var sub = r.querySelector(".tmc-file-sub");
		if (sub) sub.textContent = __("Uploading… {0}%", [pct]);
	};
	Attach.prototype.dropPending = function (p) {
		p.dropped = true;
		this.pending = this.pending.filter(function (q) { return q !== p; });
		this.refresh();
		this.notifyPending();
	};
	Attach.prototype.remove = function (f) {
		this.value = this.value.filter(function (x) { return x !== f; });
		this.refresh();
		if (this.opts.onChange) this.opts.onChange(this.value.slice());
		if (f.name && this.opts.onDiscard) this.opts.onDiscard(f.name);
	};

	/* ------------------------------------------------------------- pickDate() -- */
	/* For a date shown as a button (task due date, filters, ranges, recurrence): Frappe's
	   own datepicker opens right at the button. A ControlDate is laid invisibly over the
	   button and focused — nothing else is shown — and removed when the picker closes.
	   o: anchor (element), value 'YYYY-MM-DD', onPick(value), min_date, max_date (Date) */
	var current = null;
	function pickDate(o) {
		o = o || {};
		if (current) current.close();
		return ready().then(function () {
			var a = o.anchor, r = a && a.getBoundingClientRect ? a.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 1, height: 1 };
			var host = h("div", { class: "tm-frappe tmc-dp-anchor", style: {
				position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", zIndex: "1060",
			} });
			document.body.appendChild(host);
			var dfo = {
				/* docfield options Frappe passes to its datepicker */
				onHide: function (inst, done) {
					if (!done) return;
					/* Frappe applies the picked day through a debounced input event; the picker is
					   torn down before that runs, so hand the picked day over here */
					var d = inst && inst.selectedDates && inst.selectedDates[0];
					if (d) pick(iso(d));
					setTimeout(function () { pop.close(); }, 0);
				},
			};
			if (o.min_date) dfo.minDate = o.min_date;
			if (o.max_date) dfo.maxDate = o.max_date;
			var pop = {
				value: o.value || null,
				close: function () {
					if (!host) return;
					try { control.datepicker && control.datepicker.destroy(); } catch (e) { /* */ }
					host.remove();
					host = null;
					var i = openPops.indexOf(pop);
					if (i >= 0) openPops.splice(i, 1);
					if (current === pop) current = null;
				},
			};
			var pick = function (v) {
				if (!v || same(v, pop.value)) return;
				pop.value = v;
				if (o.onPick) o.onPick(v);
			};
			var control = frappe.ui.form.make_control({
				df: { fieldtype: "Date", fieldname: "value", options: dfo,
					change: function () { pick(control.get_value() || null); } },
				parent: host, doc: {}, render_input: true, only_input: true,
			});
			jQuery("#datepickers-container").addClass("tm-frappe");
			control.$input.attr({ tabindex: "-1", "aria-label": o.title || __("Date") });
			openPops.push(pop);
			current = pop;
			/* set the value first (selecting it would close an open picker), then focus the
			   field: that is what opens Frappe's datepicker */
			return Promise.resolve(pop.value ? control.set_value(pop.value) : null).then(function () {
				if (!host) return pop;
				try { control.$input.get(0).focus({ preventScroll: true }); } catch (e) { /* */ }
				if (control.datepicker && !control.datepicker.visible) control.datepicker.show();
				return pop;
			});
		}, function (e) {
			console.error(e);
			frappe.show_alert({ message: esc(__("Could not load the date picker")), indicator: "red" });
		});
	}
	function closeDatePop() { if (current) current.close(); }

	window.TMControls = {
		ready: ready,
		h: h, icon: icon,
		Field: Field, Data: Data, UserMulti: UserMulti, Link: Link, DateControl: DateControl, Select: Select,
		TextEditor: TextEditor, TagsInput: TagsInput, Checklist: Checklist, Attach: Attach,
		pickDate: pickDate, closeDatePop: closeDatePop,
		anyPopoverOpen: anyPopoverOpen, closeTopPopover: closeTopPopover,
		date: { iso: iso, parseISO: parseISO, addDays: addDays, today: todayISO, format: dateFormat },
		esc: esc,
	};
})();
