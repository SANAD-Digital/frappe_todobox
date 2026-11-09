/* ToDoBox Desk: workflow stepper above the form.
   Uses Frappe's own "form-refresh" document event, so nothing is patched or polled. */
(function () {
	"use strict";

	if (window.__todobox_wf_progress_loaded || !window.frappe) return;
	window.__todobox_wf_progress_loaded = true;

	const ROOT_ID = "tbx-wf-progress";
	const METHOD = "todobox.services.wf_engine.valid_states";
	const CACHE_LIMIT = 120;
	const payloads = new Map();
	const inflight = new Map();

	const esc = (value) => frappe.utils.escape_html(value == null ? "" : String(value));
	const as_array = (value) => (Array.isArray(value) ? value : []);
	const to_int = (value, fallback = 0) => {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : fallback;
	};

	function state_fieldname(doctype) {
		return (frappe.workflow && frappe.workflow.get_state_fieldname(doctype)) || null;
	}

	function current_state(frm, fieldname) {
		return String(frm.doc[fieldname] || "").trim();
	}

	function cache_key(frm, fieldname) {
		const doc = frm.doc;
		return [doc.doctype, doc.name, doc.modified || "", doc[fieldname] || "", doc.docstatus].join("::");
	}

	function normalize(response) {
		if (Array.isArray(response)) return { states: as_array(response[0]), workflow: response[1] || {} };
		if (response && typeof response === "object") {
			return { ...response, states: as_array(response.states), workflow: response.workflow || {} };
		}
		return { states: [], workflow: {} };
	}

	function fetch_payload(frm, key) {
		if (payloads.has(key)) return Promise.resolve(payloads.get(key));
		if (inflight.has(key)) return inflight.get(key);

		const request = frappe
			.xcall(METHOD, { doctype: frm.doc.doctype, name: frm.doc.name })
			.then((response) => {
				const payload = normalize(response);
				payloads.set(key, payload);
				if (payloads.size > CACHE_LIMIT) payloads.delete(payloads.keys().next().value);
				return payload;
			})
			.finally(() => inflight.delete(key));

		inflight.set(key, request);
		return request;
	}

	function ensure_container(frm) {
		const wrapper = frm.$wrapper;
		if (!wrapper || !wrapper.length) return null;
		let root = wrapper.find(`#${ROOT_ID}`);
		if (!root.length) {
			const layout = wrapper.find(".layout-main-section").first();
			if (!layout.length) return null;
			root = $(`<div id="${ROOT_ID}"></div>`).prependTo(layout);
		}
		return root;
	}

	function clear(frm) {
		const root = frm.$wrapper && frm.$wrapper.find(`#${ROOT_ID}`);
		if (root && root.length) root.empty();
		frm.__tbx_wf_render_key = null;
	}

	function visible_states(raw) {
		return as_array(raw)
			.filter((row) => row && row.state)
			.map((row, index) => ({
				state: String(row.state),
				status_no: to_int(row.status_no, index + 1) || index + 1,
			}))
			.sort((a, b) => a.status_no - b.status_no);
	}

	function trace_rows(frm) {
		return as_array(frm.doc.todobox_wf_trace);
	}

	function latest_trace_by_state(rows) {
		const map = new Map();
		rows.forEach((row) => {
			if (!row || !row.workflow_state) return;
			const key = String(row.workflow_state);
			const date = String(row.date || row.creation || "");
			if (!map.has(key) || date > map.get(key)) map.set(key, date);
		});
		return map;
	}

	/* Rank of a state in the workflow definition (the same status_no || idx the server uses).
	   Needed when the current state is itself hidden from the bar. */
	function definition_rank(doctype, state) {
		const workflow = frappe.workflow.workflows && frappe.workflow.workflows[doctype];
		const rows = as_array(workflow && workflow.states);
		const index = rows.findIndex((row) => row.state === state);
		if (index < 0) return null;
		return to_int(rows[index].status_no, 0) || to_int(rows[index].idx, index + 1);
	}

	/* How many visible steps lie behind the current state.
	   A current state missing from the bar keeps its place instead of resetting it. */
	function steps_behind(frm, states, state, traces) {
		const rank = definition_rank(frm.doc.doctype, state);
		if (rank) return states.filter((row) => row.status_no < rank).length;

		let last_traced = -1;
		states.forEach((row, index) => {
			if (traces.has(row.state)) last_traced = index;
		});
		return last_traced + 1;
	}

	function step_kind(index, current_index, behind) {
		if (current_index >= 0) {
			if (index < current_index) return "complete";
			if (index === current_index) return "current";
			return index === current_index + 1 ? "pending" : "future";
		}
		if (index < behind) return "complete";
		return index === behind ? "pending" : "future";
	}

	const NODE = { complete: "&#10003;", current: "&#9679;", pending: "&#8987;" };

	function step_meta(kind, date) {
		if (date) return frappe.datetime.str_to_user(date);
		if (kind === "complete") return __("Completed");
		if (kind === "current") return __("Current", null, "ToDoBox");
		if (kind === "pending") return __("Pending");
		return __("Not Started");
	}

	function render(frm, payload, fieldname) {
		const root = ensure_container(frm);
		if (!root) return;

		const workflow = payload.workflow || {};
		const states = visible_states(payload.states);
		if (!to_int(workflow.show_status_bar, 0) || !states.length) {
			root.empty();
			return;
		}

		const state = current_state(frm, fieldname);
		const current_index = states.findIndex((row) => row.state === state);
		const traces = latest_trace_by_state(trace_rows(frm));
		const behind = current_index >= 0 ? current_index : steps_behind(frm, states, state, traces);

		const steps = states
			.map((row, index) => {
				const kind = step_kind(index, current_index, behind);
				const date = traces.get(row.state);
				return `
					<div class="tbx-wf-step is-${kind}" data-state="${esc(row.state)}">
						<span class="tbx-wf-step-bar" aria-hidden="true"></span>
						<span class="tbx-wf-step-node" aria-hidden="true">${NODE[kind] || esc(index + 1)}</span>
						<div class="tbx-wf-step-content">
							<span class="tbx-wf-step-title">${esc(__(row.state))}</span>
							<span class="tbx-wf-step-meta">${esc(step_meta(kind, date))}</span>
						</div>
					</div>`;
			})
			.join("");

		root.html(`
			<section class="tbx-wf-card" aria-label="${esc(__("Workflow Progress", null, "ToDoBox"))}">
				<header class="tbx-wf-head">
					<div class="tbx-wf-title">${esc(__("Workflow Progress", null, "ToDoBox"))}</div>
					<div class="tbx-wf-current">
						<span class="tbx-wf-current-label">${esc(__("Current", null, "ToDoBox"))}</span>
						<span class="tbx-wf-current-value">${esc(state ? __(state) : __("Not Started"))}</span>
					</div>
				</header>
				<div class="tbx-wf-track">${steps}</div>
			</section>`);
	}

	function refresh(frm) {
		if (!frm || !frm.doc || !frm.doc.doctype || (frm.meta && frm.meta.istable)) return;

		const fieldname = state_fieldname(frm.doc.doctype);
		if (!fieldname || frm.is_new()) {
			clear(frm);
			return;
		}

		const root = ensure_container(frm);
		if (!root) return;

		const key = cache_key(frm, fieldname);
		if (frm.__tbx_wf_render_key === key && root.children().length) return;
		frm.__tbx_wf_render_key = key;

		if (!root.children().length && !payloads.has(key)) {
			root.html(`<div class="tbx-wf-loading">${esc(__("Loading workflow progress...", null, "ToDoBox"))}</div>`);
		}

		fetch_payload(frm, key)
			.then((payload) => {
				// the form may have moved to another document meanwhile
				if (frm.__tbx_wf_render_key === key) render(frm, payload, fieldname);
			})
			.catch(() => {
				if (frm.__tbx_wf_render_key === key) clear(frm);
			});
	}

	$(document).on("form-refresh.todobox_wf_progress", (event, frm) => refresh(frm));

	// a form already open when this file loaded (its form-refresh has passed)
	$(() => window.cur_frm && refresh(window.cur_frm));
})();
