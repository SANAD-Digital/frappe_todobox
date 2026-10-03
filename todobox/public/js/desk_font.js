/* ToDoBox — remember the Desk's typeface for the standalone /todobox page.
 *
 * A theme can pick the font at runtime (an attribute or a variable set on <html> from the user's
 * settings), which the server cannot see. Here, in the Desk, we read the font the page really
 * renders with and keep it in localStorage; /todobox applies it before its first paint.
 * The @font-face rules themselves reach /todobox from the server (todobox.services.desk_font).
 */
(function () {
	"use strict";
	var KEY = "todobox:desk-font";
	var timer = null;

	function snapshot() {
		var root = document.documentElement, body = document.body;
		if (!root || !body || !window.getComputedStyle) return;
		var stack = getComputedStyle(root).getPropertyValue("--font-stack").trim();
		var family = getComputedStyle(body).fontFamily || "";
		// web fonts a theme loaded from elsewhere (e.g. Google Fonts) at runtime
		var links = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis.com"]'))
			.map(function (l) { return l.href; });
		var data = { family: family, stack: stack, links: links };
		try {
			var json = JSON.stringify(data);
			if (localStorage.getItem(KEY) !== json) localStorage.setItem(KEY, json);
		} catch (e) { /* private mode */ }
	}
	function later() { clearTimeout(timer); timer = setTimeout(snapshot, 400); }

	function start() {
		later();
		// a theme applies or changes the font after load (settings panel, user switch…)
		if (window.MutationObserver) {
			new MutationObserver(later).observe(document.documentElement, { attributes: true });
			if (document.body) new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
			new MutationObserver(later).observe(document.head, { childList: true });
		}
		if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", later);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
	else start();
})();
