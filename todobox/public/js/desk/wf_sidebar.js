/* ToDoBox Desk: "Workflow Action" sidebar button, count badge and flyout list. */
(function () {
	"use strict";

	if (window.__todobox_wf_sidebar_loaded || !window.frappe) return;
	window.__todobox_wf_sidebar_loaded = true;

	const METHOD = "todobox.services.wf_engine.get_sidebar_workflow_actions";
	const TODOBOX_ROUTE = "/todobox/actions/pending";
	const NS = ".todobox_wf_sidebar";
	const LIMIT = 20;
	const FALLBACK_MS = 120000; // only a safety net: realtime does the live work
	const DEBOUNCE_MS = 800;
	const OWN_ACTION_MS = 15000;

	const row_time = (row) => String(row.creation || row.modified || "");

	class WorkflowActionsPanel {
		constructor(wrapper) {
			this.wrapper = wrapper;
			this.items = [];
			this.total = 0;
			this.seen_ids = new Set();
			this.newest_time = "";
			this.loaded = false;
			this.own_action_until = 0;
			this.request_id = 0;
			this.make();
		}

		make() {
			this.wrapper.find(".sidebar-workflow-actions").removeClass("hidden");
			this.dropdown = $(this.dropdown_html()).prependTo(this.wrapper);
			this.list = this.dropdown.find(".notifications-list");
			this.title = this.dropdown.find(".workflow-actions-tab-title");
			this.panel = this.dropdown.find(".panel-workflow-actions");
			this.setup_header();
			this.setup_events();
			this.setup_live_updates();
			this.refresh();
		}

		dropdown_html() {
			return `<div class="dropdown-workflow-actions hidden">
				<div class="notifications-list" role="menu">
					<div class="notification-list-header">
						<div class="header-items">
							<ul class="notification-item-tabs nav nav-tabs" role="tablist">
								<li class="notifications-category active workflow-actions-tab-title">${__("Workflow Actions", null, "ToDoBox")}</li>
							</ul>
						</div>
						<div class="header-actions"></div>
					</div>
					<div class="notification-list-body">
						<div class="panel-workflow-actions"></div>
						<a class="workflow-actions-todobox" href="${TODOBOX_ROUTE}">${__("Open in ToDoBox")}</a>
					</div>
				</div>
			</div>`;
		}

		setup_header() {
			const actions = this.dropdown.find(".header-actions");
			$(`<span class="workflow-actions-refresh" title="${__("Refresh")}">${frappe.utils.icon("rotate-ccw")}</span>`)
				.on("click", (e) => {
					e.stopPropagation();
					this.refresh(true);
				})
				.appendTo(actions);
			$(`<span class="workflow-actions-close" title="${__("Close")}">${frappe.utils.icon("x")}</span>`)
				.on("click", () => this.hide())
				.appendTo(actions);
		}

		setup_events() {
			$(window).on(`resize${NS}`, () => this.is_open() && this.update_position());
			$(document)
				.on(`sidebar-expand${NS}`, () => this.is_open() && this.update_position())
				.on(`page-change${NS}`, () => this.hide())
				.on(`click${NS}`, (e) => {
					const inside = $(e.target).closest(
						".sidebar-workflow-actions, .dropdown-workflow-actions .notifications-list"
					);
					if (!inside.length) this.hide();
				});
			this.wrapper.find(".sidebar-notification").on(`click${NS}`, () => this.hide());
		}

		setup_live_updates() {
			const refresh = () => this.schedule_refresh();

			if (frappe.realtime) {
				frappe.realtime.doctype_subscribe && frappe.realtime.doctype_subscribe("Workflow Action");
				frappe.realtime.on("list_update", (data) => {
					if (data && data.doctype === "Workflow Action") refresh();
				});
				frappe.realtime.on("notification", refresh);
			}

			$(document).on(`visibilitychange${NS}`, () => {
				if (!document.hidden) refresh();
			});

			// Own actions: the new rows they create must not chime.
			const mark_own = () => {
				this.own_action_until = Date.now() + OWN_ACTION_MS;
			};
			frappe.ui.form.on("*", { before_workflow_action: mark_own, after_workflow_action: mark_own });

			setInterval(() => {
				if (!document.hidden) refresh();
			}, FALLBACK_MS);
		}

		schedule_refresh() {
			if (this.refresh_timer) return;
			this.refresh_timer = setTimeout(() => {
				this.refresh_timer = null;
				this.refresh();
			}, DEBOUNCE_MS);
		}

		is_open() {
			return !this.dropdown.hasClass("hidden");
		}

		toggle() {
			this.is_open() ? this.hide() : this.show();
		}

		show() {
			this.update_position();
			this.wrapper.find(".dropdown-notifications").addClass("hidden");
			this.dropdown.removeClass("hidden");
			this.refresh(true);
		}

		hide() {
			this.dropdown.addClass("hidden");
		}

		update_position() {
			const is_rtl = frappe.utils.is_rtl();
			if (window.matchMedia("(max-width: 767.98px)").matches) {
				this.list.css({ position: "absolute", top: 0, left: is_rtl ? "auto" : 0, right: is_rtl ? 0 : "auto" });
				return;
			}
			const sidebar = $(".body-sidebar").first()[0];
			if (!sidebar) return;
			const rect = sidebar.getBoundingClientRect();
			this.list.css({
				position: "fixed",
				top: 0,
				left: is_rtl ? "auto" : `${Math.round(rect.right)}px`,
				right: is_rtl ? `${Math.round(window.innerWidth - rect.left)}px` : "auto",
			});
		}

		refresh(show_loading = false) {
			if (show_loading && this.is_open() && !this.items.length) {
				this.panel.html(`<div class="text-muted text-center p-4">${__("Loading...")}</div>`);
			}

			const request_id = ++this.request_id;
			return frappe
				.xcall(METHOD, { limit: LIMIT })
				.then((response) => {
					if (request_id !== this.request_id) return;
					this.apply(this.normalize(response));
				})
				.catch(() => {
					if (request_id === this.request_id && this.is_open()) {
						this.panel.html(
							`<div class="text-muted text-center p-4">${__("Unable to load workflow actions.", null, "ToDoBox")}</div>`
						);
					}
				});
		}

		normalize(response) {
			if (Array.isArray(response)) return { items: response, total: response.length };
			const items = (response && (response.rows || response.items)) || [];
			const total = Number.parseInt(response && (response.total ?? response.count), 10);
			return { items, total: Number.isNaN(total) ? items.length : total };
		}

		apply({ items, total }) {
			if (this.loaded && this.has_new_arrival(items, total)) this.chime();

			items.forEach((row) => {
				if (row.name) this.seen_ids.add(row.name);
				if (row_time(row) > this.newest_time) this.newest_time = row_time(row);
			});

			this.items = items;
			this.total = total;
			this.loaded = true;

			this.update_title();
			this.update_badge();
			if (this.is_open()) this.render();
		}

		/* A true arrival: the total went up, and a never-seen row is newer than everything seen so far.
		   An older row sliding into the top 20 (once another is resolved) fails the time test.
		   Another browser tab's action is recognised through the row's owner. */
		has_new_arrival(items, total) {
			if (total <= this.total || Date.now() < this.own_action_until) return false;
			const me = frappe.session.user;
			return items.some(
				(row) =>
					row.name &&
					!this.seen_ids.has(row.name) &&
					row_time(row) > this.newest_time &&
					row.owner !== me
			);
		}

		chime() {
			const user = frappe.session.user;
			if (user === "Guest" || user === "Administrator") return;
			try {
				frappe.utils.play_sound("alert");
			} catch (e) {
				// browsers may block autoplay; never let that break the live update
			}
		}

		update_title() {
			const suffix = this.total > 0 ? ` (${this.total})` : "";
			this.title.text(`${__("Workflow Actions", null, "ToDoBox")}${suffix}`);
		}

		update_badge() {
			const anchor = this.wrapper.find(".sidebar-workflow-actions .item-anchor");
			if (!anchor.length) return;
			let badge = anchor.find(".workflow-actions-count-badge");
			if (!badge.length) {
				badge = $(`<span class="sidebar-item-suffix workflow-actions-count-badge hidden"></span>`).appendTo(anchor);
			}
			badge.text(this.total > 99 ? "99+" : this.total > 0 ? String(this.total) : "");
			badge.toggleClass("hidden", this.total <= 0);
		}

		render() {
			this.panel.empty();
			if (!this.items.length) {
				this.panel.html(`<div class="notification-null-state">
					<div class="text-center">
						<img src="/assets/frappe/images/ui-states/notification-empty-state.svg" alt="" class="null-state">
						<div class="title">${__("No Workflow Actions", null, "ToDoBox")}</div>
						<div class="subtitle">${__("There are no open workflow actions for you.", null, "ToDoBox")}</div>
					</div>
				</div>`);
				return;
			}
			this.items.forEach((item) => this.panel.append(this.row(item)));
		}

		row(item) {
			const esc = frappe.utils.escape_html;
			const actions = (item.actions || [])
				.map((action) => esc(__(typeof action === "string" ? action : action.action || "")))
				.join(frappe.utils.is_rtl() ? "، " : ", ");
			const time = item.modified ? frappe.datetime.prettyDate(item.modified) : "";
			const $row = $(`<a class="recent-item notification-item workflow-action-item" href="#">
				<div class="notification-body">
					<div class="message">
						<div><b>${esc(__(item.reference_doctype || ""))}</b>: ${esc(item.reference_name || "")}</div>
						<div class="notification-timestamp text-muted">${__("Current State")}: ${esc(__(item.workflow_state || "-"))}</div>
						<div class="notification-timestamp text-muted">${__("Actions")}: ${actions || __("No actions available", null, "ToDoBox")}</div>
						${time ? `<div class="notification-timestamp text-muted">${time}</div>` : ""}
					</div>
				</div>
			</a>`);
			$row.on("click", (e) => {
				e.preventDefault();
				this.hide();
				frappe.set_route("Form", item.reference_doctype, item.reference_name);
			});
			return $row;
		}
	}

	function setup_button(sidebar) {
		if (sidebar.__tbx_wf_panel || !sidebar.$standard_items_sections || frappe.session.user === "Guest") return;
		if (!sidebar.$standard_items_sections.length) return;

		sidebar.add_item(sidebar.$standard_items_sections, {
			label: __("Workflow Action", null, "ToDoBox"),
			icon: "list",
			standard: true,
			type: "Button",
			class: "sidebar-workflow-actions hidden",
			onClick: () => {
				sidebar.__tbx_wf_panel.toggle();
				if (frappe.is_mobile()) sidebar.wrapper.removeClass("expanded");
			},
		});
		sidebar.__tbx_wf_panel = new WorkflowActionsPanel(sidebar.$standard_items_sections);
	}

	const proto = frappe.ui.Sidebar && frappe.ui.Sidebar.prototype;
	if (proto && !proto.__tbx_wf_patched) {
		const original = proto.add_standard_items;
		proto.add_standard_items = function (...args) {
			const result = original.apply(this, args);
			setup_button(this);
			return result;
		};
		proto.__tbx_wf_patched = true;
	}

	// the sidebar may already be built by the time this file runs
	frappe.after_ajax(() => {
		if (frappe.app && frappe.app.sidebar && frappe.app.sidebar.standard_items_setup) {
			setup_button(frappe.app.sidebar);
		}
	});
})();
