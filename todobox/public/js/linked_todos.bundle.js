/* ToDoBox Desk: "Tasks" in a document's form sidebar (right above "Attachments"), opening every task (ToDo) linked to the document in a
   dialog: vertical status navigation on the side, the tasks on the right (same layout as a settings dialog).
   It shows only when the document has tasks (services/linked_todos.py sets the count on load). */
(function () {
	"use strict";

	if (window.__todobox_linked_todos_loaded || !window.frappe) return;
	window.__todobox_linked_todos_loaded = true;

	const METHOD = "todobox.services.linked_todos.get_linked_todos";
	const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));

	const VIEWS = [
		{ id: "all", label: () => __("All"), icon: "list-todo", test: () => true },
		{ id: "open", label: () => __("Open"), icon: "circle-dot", test: (t) => t.status === "Open" },
		{ id: "overdue", label: () => __("Overdue"), icon: "alarm-clock", test: (t) => !!t.overdue },
		{ id: "closed", label: () => __("Closed"), icon: "circle-check", test: (t) => t.status === "Closed" },
		{ id: "cancelled", label: () => __("Cancelled"), icon: "circle-x", test: (t) => t.status === "Cancelled" },
	];

	function count_of(frm) {
		return (frm.doc.__onload && frm.doc.__onload.todobox_todo_count) || 0;
	}

	/* a section of the form sidebar right above "Attachments", like "Assign": icon, label, count. The sidebar is reused
	   by the next document of the same type, so it is updated (or hidden) on every refresh. */
	function refresh(frm) {
		const $sidebar = frm && frm.sidebar && frm.sidebar.sidebar;
		if (!$sidebar || !$sidebar.length) return;
		let $section = $sidebar.find(".tbx-lt-section");
		const n = frm.is_new() || frm.doctype === "ToDo" ? 0 : count_of(frm);
		if (!n) {
			$section.addClass("hidden");
			return;
		}
		if (!$section.length) {
			$section = $(`<div class="sidebar-section tbx-lt-section">
				<a class="form-sidebar-items tbx-lt-open" role="button" tabindex="0">
					<span class="form-sidebar-label">
						${frappe.utils.icon("list-todo")}
						<span class="ellipsis">${esc(__("Tasks"))}</span>
					</span>
					<span class="tbx-lt-section-count"></span>
				</a>
			</div>`);
			const $files = $sidebar.find(".form-attachments");
			if ($files.length) $section.insertBefore($files);
			else $sidebar.append($section);
			$section.on("click keydown", ".tbx-lt-open", (e) => {
				if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
				e.preventDefault();
				const f = window.cur_frm;
				if (f) open_dialog(f.doctype, f.docname);
			});
		}
		$section.removeClass("hidden").find(".tbx-lt-section-count").text(n);
	}

	const TONE = (t) => (t.overdue ? "red" : { Open: "orange", Closed: "green", Cancelled: "gray" }[t.status] || "gray");
	const PRIORITY_TONE = { High: "red", Medium: "orange", Low: "gray" };

	function status_pill(t) {
		const label = t.overdue ? __("Overdue") : __(t.status);
		return `<span class="indicator-pill ${TONE(t)}">${esc(label)}</span>`;
	}

	function avatar(user, users) {
		const u = users[user] || {};
		return frappe.avatar(user, "avatar-small", u.name || user, u.image || undefined);
	}

	/* "Overdue by 3 days" / "Due today" / the date */
	function due_text(t) {
		if (!t.date) return "";
		const days = frappe.datetime.get_day_diff(t.date, frappe.datetime.get_today());
		if (t.status === "Open" && days < 0) return __("Overdue by {0} days", [-days]);
		if (t.status === "Open" && days === 0) return __("Due today");
		return __("Due {0}", [frappe.datetime.str_to_user(t.date)]);
	}

	/* one row of a list in the Desk's own style: task | assigned to | assigned by | due | priority | status */
	function row_html(t, users) {
		const who = (u) => esc((users[u] || {}).name || u || "—");
		const subject = `<span class="tbx-lt-subject${t.readable ? "" : " is-private"}">${esc(t.readable ? t.subject : __("Private task"))}</span>`;
		const done =
			t.status === "Closed" && t.completed_on
				? `<span class="tbx-lt-sub">${esc(__("Completed {0}", [frappe.datetime.str_to_user(String(t.completed_on).slice(0, 10))]))}</span>`
				: "";
		const cells = `
			<div class="tbx-lt-c tbx-lt-c-task">${subject}${done}</div>
			<div class="tbx-lt-c tbx-lt-c-user">${avatar(t.allocated_to, users)}<span class="ellipsis">${who(t.allocated_to)}</span></div>
			<div class="tbx-lt-c tbx-lt-c-by ellipsis">${who(t.assigned_by)}</div>
			<div class="tbx-lt-c tbx-lt-c-due${t.overdue ? " is-late" : ""}">${t.date ? esc(due_text(t)) : "—"}</div>
			<div class="tbx-lt-c tbx-lt-c-prio">${
				t.priority ? `<i class="tbx-lt-dot ${PRIORITY_TONE[t.priority] || "gray"}"></i>${esc(__(t.priority))}` : "—"
			}</div>
			<div class="tbx-lt-c tbx-lt-c-state">${status_pill(t)}</div>`;
		return t.readable
			? `<a class="tbx-lt-row" href="/todobox/all/${encodeURIComponent(t.name)}" title="${esc(__("Open in ToDoBox"))}">${cells}</a>`
			: `<div class="tbx-lt-row">${cells}</div>`;
	}

	function head_row() {
		return `<div class="tbx-lt-row tbx-lt-cols">
			<div class="tbx-lt-c tbx-lt-c-task">${esc(__("Task"))}</div>
			<div class="tbx-lt-c tbx-lt-c-user">${esc(__("Assigned To"))}</div>
			<div class="tbx-lt-c tbx-lt-c-by">${esc(__("Assigned By"))}</div>
			<div class="tbx-lt-c tbx-lt-c-due">${esc(__("Due Date"))}</div>
			<div class="tbx-lt-c tbx-lt-c-prio">${esc(__("Priority"))}</div>
			<div class="tbx-lt-c tbx-lt-c-state">${esc(__("Status"))}</div>
		</div>`;
	}

	/* progress ring + "1 of 3 completed" + what is still open */
	function summary_html(todos) {
		const live = todos.filter((t) => t.status !== "Cancelled");
		const done = live.filter((t) => t.status === "Closed").length;
		const open = live.filter((t) => t.status === "Open").length;
		const late = live.filter((t) => t.overdue).length;
		const pct = live.length ? Math.round((done / live.length) * 100) : 0;
		const r = 17, c = 2 * Math.PI * r;
		const rest = [
			open ? __("{0} open", [open]) : "",
			late ? `<span class="tbx-lt-late">${esc(__("{0} overdue", [late]))}</span>` : "",
		].filter(Boolean);
		return `<div class="tbx-lt-summary">
			<svg class="tbx-lt-ring" viewBox="0 0 42 42" aria-hidden="true">
				<circle cx="21" cy="21" r="${r}" class="tbx-lt-ring-track"></circle>
				<circle cx="21" cy="21" r="${r}" class="tbx-lt-ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"></circle>
				<text x="21" y="21" dy="0.35em" text-anchor="middle">${pct}%</text>
			</svg>
			<div class="tbx-lt-summary-text">
				<div class="tbx-lt-summary-title">${esc(__("{0} of {1} completed", [done, live.length]))}</div>
				${rest.length ? `<div class="tbx-lt-summary-sub">${rest.join(" · ")}</div>` : ""}
			</div>
		</div>`;
	}

	function open_dialog(doctype, name) {
		const d = new frappe.ui.Dialog({ title: __("Tasks of {0}", [__(doctype) + " " + name]), size: "extra-large" });
		d.$wrapper.addClass("tbx-lt");
		d.$body.html(`<div class="tbx-lt-page"><div class="tbx-lt-side"></div><div class="tbx-lt-pane">
			<div class="tbx-lt-empty">${esc(__("Loading..."))}</div></div></div>`);
		d.show();

		let data = { todos: [], users: {} };
		let view = "all";
		const draw = () => {
			const nav = VIEWS.map((v) => {
				const n = data.todos.filter(v.test).length;
				if (!n && v.id !== "all" && v.id !== view) return "";
				return `<button type="button" class="tbx-lt-tab${v.id === view ? " active" : ""}" data-view="${v.id}">
					<span class="tbx-lt-ico">${frappe.utils.icon(v.icon, "sm")}</span>
					<span class="tbx-lt-label">${esc(v.label())}</span>
					<span class="tbx-lt-count">${n}</span>
				</button>`;
			}).join("");
			const current = VIEWS.find((v) => v.id === view);
			const rows = data.todos.filter(current.test);
			d.$body.find(".tbx-lt-side").html(summary_html(data.todos) + `<div class="tbx-lt-nav">${nav}</div>`);
			d.$body.find(".tbx-lt-pane").html(
				rows.length
						? `<div class="tbx-lt-list">${head_row()}${rows.map((t) => row_html(t, data.users)).join("")}</div>`
						: `<div class="tbx-lt-empty">${frappe.utils.icon("inbox", "lg")}<div>${esc(__("No tasks here"))}</div></div>`
			);
		};
		d.$body.on("click", ".tbx-lt-tab", (e) => {
			view = e.currentTarget.dataset.view;
			draw();
		});

		frappe
			.xcall(METHOD, { doctype, name })
			.then((r) => {
				data = r || data;
				draw();
			})
			.catch(() => d.hide());
	}

	$(document).on("form-refresh.todobox_linked_todos", (event, frm) => refresh(frm));
	// a form already open when this file loaded (its form-refresh has passed)
	$(() => window.cur_frm && refresh(window.cur_frm));
})();
