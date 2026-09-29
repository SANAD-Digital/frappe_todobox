/* =============================================================================
   ToDoBox — augments Frappe's website client for the standalone /todobox page.

   www/todobox.html loads frappe-web.bundle.js exactly like a Frappe web page
   (jQuery, moment + moment-timezone, __, frappe.datetime, frappe.utils,
   frappe.realtime, frappe.require…) with window.todobox_boot.frappe as
   frappe.boot. The form controls (controls.bundle.js) are loaded on demand by
   js/todobox/controls.js through frappe.require().

   This file only adds what the website bundle does not have, or has in a form
   that needs Desk/website CSS the page does not load:
     · frappe.call / xcall with the Desk contract (error/always callbacks, GET,
       headers, server messages, 401/403/417/5xx handling) — the website version
       has no error callback and returns a jqXHR
     · msgprint / hide_msgprint / show_alert styled by the app (Frappe's use
       Bootstrap modals from website/desk CSS)
     · model.with_doctype / with_doc / get_meta returning the meta / doc
     · set_route → opens the Desk in a new tab; ui.FileUploader + upload_file
     · session from the boot; translation contexts "ToDoBox" / "ToDo Tool";
       realtime connected lazily and quietly; icons mapped to the app's sprite
   ============================================================================= */
(function () {
	"use strict";

	var frappe = window.frappe;
	if (!frappe || !frappe.provide || !window.jQuery) {
		console.error("ToDoBox: frappe-web.bundle.js did not load");
		return;
	}
	var boot = window.todobox_boot || {};
	var fboot = frappe.boot || (frappe.boot = {});
	var lang = boot.lang || fboot.lang || "en";
	var user = boot.user || {};

	/* ------------------------------------------------------------ translation -- */
	/* Frappe's __ plus the app's message contexts (msgctxt "ToDoBox" / "ToDo Tool") */
	var CONTEXTS = ["ToDoBox", "ToDo Tool"];
	var messages = frappe._messages || (frappe._messages = {});
	var base_translate = frappe._;
	function translate(txt, replace, context) {
		if (!txt || typeof txt !== "string") return txt;
		if (!context) {
			for (var i = 0; i < CONTEXTS.length; i++) {
				if (messages[txt + ":" + CONTEXTS[i]]) { context = CONTEXTS[i]; break; }
			}
		}
		return base_translate(txt, replace, context);
	}
	frappe._ = window.__ = translate;

	var escape_html = frappe.utils.escape_html;
	function el(tag, cls, html) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (html != null) n.innerHTML = html;
		return n;
	}

	/* ---------------------------------------------------------------- session -- */
	/* website.js resets frappe.session to {user} from cookies on "page-change" */
	function set_session() {
		frappe.session = Object.assign(frappe.session || {}, {
			user: user.name, user_fullname: user.full_name, user_email: user.email, logged_in_user: user.name,
		});
		frappe.user_id = user.name;
	}
	set_session();
	jQuery(document).on("page-change", set_session);
	frappe.csrf_token = boot.csrf_token || frappe.csrf_token;
	fboot.desk = !!boot.is_desk_user;

	/* ------------------------------------------------------- msgprint / alert -- */
	var msg_dialog = null;
	function hide_msgprint() {
		if (!msg_dialog) return;
		msg_dialog.backdrop.remove();
		msg_dialog = null;
	}
	function msgprint(msg, title) {
		if (msg == null || msg === "") return;
		if (Array.isArray(msg)) { msg.forEach(function (m) { msgprint(m, title); }); return; }
		var data = typeof msg === "object" ? msg : { message: msg, title: title };
		if (typeof data.message !== "string") data.message = data.message == null ? "" : String(data.message);
		if (!data.message) return;
		if (!msg_dialog) {
			var backdrop = el("div", "tm-msg-backdrop");
			var box = el("div", "tm-msg");
			box.setAttribute("role", "alertdialog");
			box.setAttribute("aria-modal", "true");
			box.setAttribute("dir", document.documentElement.getAttribute("dir") || "ltr");
			box.innerHTML =
				'<div class="tm-msg-head"><span class="tm-msg-dot"></span><span class="tm-msg-title"></span>' +
				'<button type="button" class="tm-msg-x" aria-label="' + escape_html(translate("Close")) + '">&times;</button></div>' +
				'<div class="tm-msg-body"></div>' +
				'<div class="tm-msg-foot"><button type="button" class="tm-msg-ok">' + escape_html(translate("OK")) + "</button></div>";
			backdrop.appendChild(box);
			backdrop.addEventListener("click", function (e) { if (e.target === backdrop) hide_msgprint(); });
			box.querySelector(".tm-msg-x").addEventListener("click", hide_msgprint);
			box.querySelector(".tm-msg-ok").addEventListener("click", hide_msgprint);
			document.body.appendChild(backdrop);
			msg_dialog = { backdrop: backdrop, box: box, body: box.querySelector(".tm-msg-body") };
			setTimeout(function () { var ok = box.querySelector(".tm-msg-ok"); if (ok) ok.focus(); }, 0);
		}
		var t = msg_dialog.box.querySelector(".tm-msg-title");
		if (data.title || !t.textContent) t.textContent = data.title || translate("Message");
		msg_dialog.box.setAttribute("data-indicator", data.indicator || "");
		if (msg_dialog.body.childNodes.length) msg_dialog.body.appendChild(el("hr"));
		msg_dialog.body.appendChild(el("div", "tm-msg-part", data.message));
		return msg_dialog;
	}
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && msg_dialog) { e.stopPropagation(); e.preventDefault(); hide_msgprint(); }
	}, true);

	function show_alert(msg, seconds) {
		var data = typeof msg === "object" && msg ? msg : { message: msg };
		var wrap = document.querySelector(".tm-alerts");
		if (!wrap) { wrap = el("div", "tm-alerts"); document.body.appendChild(wrap); }
		var a = el("div", "tm-alert");
		a.setAttribute("role", "status");
		a.setAttribute("data-indicator", data.indicator || "");
		a.innerHTML = '<span class="tm-alert-dot"></span><span></span>';
		a.lastChild.innerHTML = data.message || "";
		wrap.appendChild(a);
		setTimeout(function () { a.remove(); }, (seconds || 4) * 1000);
	}

	function show_server_messages(r, opts) {
		if (!r || !r._server_messages || (opts && opts.silent)) return;
		var list;
		try { list = JSON.parse(r._server_messages); } catch (e) { return; }
		hide_msgprint();
		(list || []).forEach(function (m) {
			var data = m;
			try { data = JSON.parse(m); } catch (e) { /* plain string */ }
			if (data && typeof data === "object" && data.alert) show_alert(data);
			else msgprint(data);
		});
	}

	/* ------------------------------------------------------------ frappe.call -- */
	function encode_args(args) {
		var params = new URLSearchParams();
		Object.keys(args || {}).forEach(function (k) {
			var v = args[k];
			if (v === undefined) return; /* like JSON: an unset argument is not sent */
			if (v && typeof v === "object") v = JSON.stringify(v);
			params.append(k, v == null ? "" : String(v));
		});
		return params.toString();
	}

	function session_expired() {
		var here = location.pathname + location.search;
		msgprint({ title: translate("Not permitted"), indicator: "red", message: translate("Your session has expired. Please log in again.") });
		setTimeout(function () { location.href = "/login?redirect-to=" + encodeURIComponent(here); }, 1500);
	}

	function handle_error_status(status, data) {
		if (status === 401) { session_expired(); return; }
		if (status === 403) {
			if (data && data._error_message) {
				msgprint({ title: translate("Not permitted"), indicator: "red", message: data._error_message });
			} else if (!(data && data._server_messages)) {
				msgprint({ title: translate("Not permitted"), indicator: "red", message: translate("You do not have enough permissions to complete this action") });
			}
			return;
		}
		if (status === 404) { msgprint({ title: translate("Not found"), indicator: "red", message: translate("The resource you are looking for is not available") }); return; }
		if (status === 413) {
			msgprint({ title: translate("File too big"), indicator: "red", message: translate("File size exceeded the maximum allowed size of {0} MB", [((boot.max_file_size || 5242880) / 1048576).toFixed(0)]) });
			return;
		}
		if (status === 508) { msgprint({ title: translate("Please try again"), indicator: "red", message: translate("Another transaction is blocking this one. Please try again in a few seconds.") }); return; }
		if (status >= 500 && !(data && data._server_messages)) {
			var detail = "";
			if (data && data.exception) detail = "<pre class=\"tm-msg-pre\">" + escape_html(String(data.exception).split("\n").slice(-1)[0]) + "</pre>";
			msgprint({ title: translate("Server Error"), indicator: "red", message: translate("Something went wrong") + detail });
		}
	}

	/* The Desk contract: POST /api/method/<method> (form-encoded, objects as JSON),
	   callback(r) on success, error(r) on failure, always(r), server messages shown.
	   Returns a Promise of the full response ({message, ...}). */
	function call(opts) {
		if (typeof opts === "string") {
			opts = { method: arguments[0], args: arguments[1], callback: arguments[2], headers: arguments[3] };
		}
		opts = opts || {};
		var args = Object.assign({}, opts.args);
		delete args.cmd;
		var type = String(opts.type || "POST").toUpperCase();
		var url = opts.url || "/api/method/" + opts.method;
		var headers = Object.assign({
			Accept: "application/json",
			"X-Frappe-CSRF-Token": frappe.csrf_token,
			"X-Frappe-CMD": opts.method || "",
		}, opts.headers || {});
		if (args.doctype && typeof args.doctype === "string") headers["X-Frappe-Doctype"] = encodeURIComponent(args.doctype);
		var body = encode_args(args);
		var init = { method: type, headers: headers, credentials: "same-origin" };
		if (type === "GET") {
			if (body) url += (url.indexOf("?") === -1 ? "?" : "&") + body;
		} else {
			headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
			init.body = body;
		}

		var result = null;
		var p = fetch(url, init)
			.then(function (res) {
				return res.text().then(function (text) {
					var data = null;
					try { data = text ? JSON.parse(text) : {}; } catch (e) { data = null; }
					return { status: res.status, data: data, text: text };
				});
			}, function (err) {
				return { status: 0, data: null, text: "", network: err };
			})
			.then(function (o) {
				var data = o.data;
				result = data;
				if (data && data.__messages) Object.assign(messages, data.__messages);
				if (data && data.session_expired) { session_expired(); }
				show_server_messages(data, opts);
				if (data && data.exc) { try { console.error(JSON.parse(data.exc)); } catch (e) { console.error(data.exc); } }
				if (o.status === 200 && data) {
					if (typeof opts.callback === "function") {
						try { opts.callback(data, o.text); } catch (e) { console.error(e); }
					}
					return data;
				}
				handle_error_status(o.status, data);
				if (typeof opts.error === "function") {
					try { opts.error(data || { status: o.status }); } catch (e) { console.error(e); }
				}
				var err = new Error("ToDoBox: " + (opts.method || url) + " failed (" + o.status + ")");
				err.response = data;
				err.status = o.status;
				throw err;
			})
			.finally(function () {
				if (typeof opts.always === "function") {
					try { opts.always(result); } catch (e) { console.error(e); }
				}
			});
		p.catch(function () { /* the error callback already handled it */ });
		return p;
	}

	function xcall(method, params, type, opts) {
		return new Promise(function (resolve, reject) {
			call(Object.assign({
				method: method,
				args: params,
				type: type || "POST",
				callback: function (r) { resolve(r.message); },
				error: function (r) { reject(r && r.message); },
			}, opts || {}));
		});
	}

	/* --------------------------------------------------------------- realtime -- */
	/* frappe.realtime (socketio_client.js) with a lazy connection. When there is no
	   socket.io server the app still refreshes when the tab becomes visible again,
	   so a failed connection is not an error here. */
	try {
		if (frappe.realtime && frappe.realtime.init) {
			frappe.realtime.init(window.socketio_port, true);
			var sock = frappe.realtime.socket;
			if (sock) {
				sock.off("connect_error");
				sock.on("connect_error", function () { /* offline / no socket.io server */ });
				sock.off("msgprint");
				sock.on("msgprint", function (m) { msgprint(m); });
			}
		}
	} catch (e) { /* realtime is optional */ }

	/* ------------------------------------------------------------------ model -- */
	/* Same storage as the Desk (window.locals); the helpers resolve the meta / doc. */
	var locals = window.locals || (window.locals = { DocType: {} });
	function store(docs) {
		(docs || []).forEach(function (d) {
			if (!d || !d.doctype || !d.name) return;
			(locals[d.doctype] = locals[d.doctype] || {})[d.name] = d;
		});
	}
	function get_meta(doctype) { return (locals.DocType || {})[doctype] || null; }
	var meta_inflight = {};
	function with_doctype(doctype, cb) {
		var p;
		if (get_meta(doctype)) p = Promise.resolve(get_meta(doctype));
		else {
			p = meta_inflight[doctype] || (meta_inflight[doctype] = new Promise(function (resolve) {
				call({
					method: "frappe.desk.form.load.getdoctype", type: "GET", silent: true,
					args: { doctype: doctype, with_parent: 1 },
					callback: function (r) { store(r.docs); resolve(get_meta(doctype)); },
					error: function () { resolve(null); },
				});
			}).finally(function () { delete meta_inflight[doctype]; }));
		}
		return p.then(function (m) { if (cb && m) cb(m); return m; });
	}
	function with_doc(doctype, name, cb, force) {
		var have = (locals[doctype] || {})[name];
		var p = have && !force ? Promise.resolve(have) : new Promise(function (resolve) {
			call({
				method: "frappe.desk.form.load.getdoc", type: "GET",
				args: { doctype: doctype, name: name },
				callback: function (r) { store(r.docs); resolve((locals[doctype] || {})[name] || null); },
				error: function () { resolve(null); },
			});
		});
		return p.then(function (d) { if (cb && d) cb(name, d); return d; });
	}

	/* ------------------------------------------------------------ Desk routes -- */
	/* Desk routes open in a new tab: ToDoBox keeps running here */
	function desk_url(doctype, name) {
		return "/desk/" + frappe.router.slug(doctype) + (name ? "/" + encodeURIComponent(name) : "");
	}
	function open_tab(url) {
		var w = window.open(url, "_blank");
		if (w) { try { w.opener = null; } catch (e) { /* */ } }
		return w;
	}
	function set_route() {
		var a = Array.prototype.slice.call(arguments);
		if (a.length === 1 && Array.isArray(a[0])) a = a[0];
		if (a.length === 1 && typeof a[0] === "string") a = a[0].split("/");
		var url;
		if (a[0] === "Form" && a[1]) url = desk_url(a[1], a[2]);
		else if ((a[0] === "List" || a[0] === "Tree" || a[0] === "Report") && a[1]) url = desk_url(a[1]);
		else url = "/desk/" + a.map(function (x) { return encodeURIComponent(x); }).join("/");
		return open_tab(url);
	}

	/* ------------------------------------------------------------ FileUploader -- */
	/* Frappe's FileUploader is the Desk's Vue dialog (not in the website bundle):
	   open the browser's file picker and upload to /api/method/upload_file
	   (private by default, like the Desk). on_success(file_doc) per file. */
	function FileUploader(opts) {
		opts = opts || {};
		var input = document.createElement("input");
		input.type = "file";
		input.multiple = opts.allow_multiple !== false;
		input.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
		document.body.appendChild(input);
		var cleanup = function () { setTimeout(function () { input.remove(); }, 0); };
		input.addEventListener("cancel", cleanup);
		input.addEventListener("change", function () {
			var files = Array.prototype.slice.call(input.files || []);
			cleanup();
			files.reduce(function (chain, file) {
				return chain.then(function () {
					return upload_file(file, opts).then(function (doc) { if (doc && opts.on_success) opts.on_success(doc); }, function () { /* shown */ });
				});
			}, Promise.resolve());
		});
		input.click();
	}
	/* opts: is_private, folder, doctype/docname/fieldname, on_progress(0..1), silent.
	   Resolves the File doc, or null (errors are shown unless silent). XHR for progress. */
	function upload_file(file, opts) {
		opts = opts || {};
		var max = boot.max_file_size || 0;
		if (max && file.size > max) {
			if (!opts.silent) handle_error_status(413, null);
			return Promise.reject(new Error(translate("File size exceeded the maximum allowed size of {0} MB", [(max / 1048576).toFixed(0)])));
		}
		var fd = new FormData();
		fd.append("file", file, file.name || "pasted.png");
		fd.append("is_private", opts.is_private === 0 ? "0" : "1");
		fd.append("folder", opts.folder || "Home/Attachments");
		if (opts.doctype && opts.docname) { fd.append("doctype", opts.doctype); fd.append("docname", opts.docname); }
		if (opts.fieldname) fd.append("fieldname", opts.fieldname);
		if (!opts.on_progress && !opts.silent) show_alert({ message: escape_html(translate("Uploading {0}…", [file.name])) }, 2);
		return new Promise(function (resolve, reject) {
			var xhr = new XMLHttpRequest();
			xhr.open("POST", "/api/method/upload_file", true);
			xhr.setRequestHeader("Accept", "application/json");
			xhr.setRequestHeader("X-Frappe-CSRF-Token", frappe.csrf_token || "");
			xhr.upload.onprogress = function (e) { if (e.lengthComputable && opts.on_progress) opts.on_progress(e.loaded / e.total); };
			xhr.onload = function () {
				var data = null;
				try { data = JSON.parse(xhr.responseText); } catch (e) { /* */ }
				if (xhr.status === 200 && data && data.message) { resolve(data.message); return; }
				var msg = translate("Upload failed");
				try { if (data && data._server_messages) msg = JSON.parse(JSON.parse(data._server_messages)[0]).message || msg; } catch (e) { /* */ }
				if (!opts.silent) { show_server_messages(data, {}); handle_error_status(xhr.status, data); }
				reject(new Error(String(msg).replace(/<[^>]+>/g, "")));
			};
			xhr.onerror = function () { reject(new Error(translate("Upload failed"))); };
			xhr.send(fd);
		});
	}

	/* ------------------------------------------------------------------ icons -- */
	/* Frappe controls reference its icon sprite (#icon-x, #es-line-close…), which this
	   page does not load: point the few they use at the app's own symbols. */
	var ICONS = {
		x: "i-x", close: "i-x", "close-alt": "i-x", "es-line-close": "i-x", "arrow-right": "i-forward",
		select: "i-chev-down", "es-line-down": "i-chev-down", link: "i-link", "es-line-link": "i-link",
		calendar: "i-calendar", attachment: "i-paperclip", "es-line-attachment": "i-paperclip", search: "i-search",
	};
	var base_icon = frappe.utils.icon;
	frappe.utils.icon = function (name) {
		var html = base_icon.apply(this, arguments);
		var id = ICONS[name];
		return id ? html.replace(/href="#[^"]*"/, 'href="#' + id + '"').replace('class="', 'class="tm-fi ') : html;
	};

	/* website/upload.js requests the Desk's Vue upload dialog (file_uploader.bundle.js,
	   ~650 KB) on every web page; this page has its own upload UI (FileUploader above,
	   the compose drop zone), so that bundle is not loaded. */
	var base_require = frappe.require;
	frappe.require = function (links, callback) {
		var list = (typeof links === "string" ? [links] : links || []).filter(function (l) { return l !== "file_uploader.bundle.js"; });
		if (!list.length) { if (callback) callback(); return Promise.resolve(); }
		return base_require.call(frappe, list, callback);
	};

	/* ------------------------------------------------------------------ extend -- */
	/* the Link formatter (frappe.format) builds Desk URLs with the Desk router's slug() */
	frappe.router = frappe.router || { slug: function (name) { return String(name || "").toLowerCase().replace(/ /g, "-"); } };
	frappe.ui.keyCode = frappe.ui.keyCode || { ESCAPE: 27, LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, ENTER: 13, TAB: 9, SPACE: 32, BACKSPACE: 8 };
	Object.assign(frappe, {
		standalone: true,
		call: call,
		xcall: xcall,
		msgprint: msgprint,
		hide_msgprint: hide_msgprint,
		show_alert: show_alert,
		toast: show_alert,
		set_route: set_route,
		desk_url: desk_url,
		open_tab: open_tab,
		upload_file: upload_file,
	});
	window.msgprint = msgprint;
	frappe.ui.FileUploader = FileUploader;
	Object.assign(frappe.model, { with_doctype: with_doctype, with_doc: with_doc, get_meta: get_meta });
})();
