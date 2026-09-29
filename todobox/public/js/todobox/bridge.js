/* =============================================================================
   ToDoBox — server bridge (todobox.api)
   Every call settles exactly once: success, error or timeout. Without that a
   failed request would leave a Promise pending and freeze the UI.
   ============================================================================= */
(function () {
	var CALL_TIMEOUT_MS = 20000;
	var API = "todobox.api.";

	function guardedCall(opts) {
		var done = false;
		var cb = opts.callback || function () {};
		var onErr = opts.error;
		var timer = null;
		function finish(r) {
			if (done) return;
			done = true;
			if (timer) clearTimeout(timer);
			try { cb(r); } catch (e) { console.error("ToDoBoxBridge callback error:", e); }
		}
		opts.callback = finish;
		opts.error = function (err) {
			console.warn("ToDoBoxBridge call failed:", opts.method, err);
			if (typeof onErr === "function" && !done) { done = true; if (timer) clearTimeout(timer); onErr(err); return; }
			finish(null);
		};
		timer = setTimeout(function () {
			console.warn("ToDoBoxBridge call timed out:", opts.method);
			finish(null);
		}, CALL_TIMEOUT_MS);
		try {
			window.frappe.call(opts);
		} catch (e) {
			console.error("ToDoBoxBridge call threw:", opts.method, e);
			finish(null);
		}
	}

	/* resolves r.message when truthy, otherwise null (errors are shown by frappe.call) */
	function message(method, args) {
		return new Promise(function (resolve) {
			guardedCall({
				method: method,
				args: args || {},
				callback: function (r) { resolve(r && r.message ? r.message : null); },
			});
		});
	}

	window.ToDoBoxBridge = {
		getUsers: function () { return message(API + "get_active_users"); },
		getCounts: function () { return message(API + "get_counts"); },
		listTodos: function (params) { return message(API + "list_todos", params || {}); },
		getTodo: function (name) { return message(API + "get_todo", { name: name }); },
		updateTodo: function (name, patch) { return message(API + "update_todo", { name: name, patch: patch }); },
		addComment: function (name, kind, html, mentions) {
			return message(API + "add_comment", { name: name, kind: kind, html: html, mentions: JSON.stringify(mentions || []) });
		},
		createTodos: function (data) { return message(API + "create_todos", data || {}); },
		forwardTodo: function (name, args) {
			return message(API + "forward_todo", { name: name, to: args.to, mode: args.mode || "full", reason: args.reason || "" });
		},
		snoozeTodo: function (name, until, rule) { return message(API + "snooze_todo", { name: name, until: until, rule: rule }); },
		unsnoozeTodo: function (name) { return message(API + "unsnooze_todo", { name: name }); },
		getDayPlan: function () { return message(API + "get_day_plan"); },
		getNotifications: function () { return message(API + "get_notifications"); },
		markNotifRead: function (name) { return message(API + "mark_notif_read", { name: name }); },
		markAllNotifsRead: function () { return message(API + "mark_all_notifs_read"); },

		/* Checklist, templates, views, automation: resolve r.message (even when falsy),
		   or null on a server error so the UI can recover */
		callOrNull: function (method, args) {
			return new Promise(function (resolve) {
				guardedCall({
					method: method,
					args: args || {},
					callback: function (r) { resolve(r ? r.message : null); },
					error: function () { resolve(null); },
				});
			});
		},
		toggleChecklistItem: function (name, itemId) { return this.callOrNull(API + "toggle_checklist_item", { name: name, item_id: itemId }); },
		addChecklistItem: function (name, label) { return this.callOrNull(API + "add_checklist_item", { name: name, label: label }); },
		removeChecklistItem: function (name, itemId) { return this.callOrNull(API + "remove_checklist_item", { name: name, item_id: itemId }); },
		applyTaskTemplate: function (name, template) { return this.callOrNull(API + "apply_task_template", { name: name, template: template }); },
		getTaskTemplates: function (includeDisabled) { return this.callOrNull(API + "get_task_templates", { include_disabled: includeDisabled ? 1 : 0 }); },
		saveTaskTemplate: function (data) { return this.callOrNull(API + "save_task_template", { data: data }); },
		deleteTaskTemplate: function (name) { return this.callOrNull(API + "delete_task_template", { name: name }); },
	};
})();
