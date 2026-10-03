"""ToDoBox — the standalone full-screen app at /todobox (and /todobox/<path>).

The page has its own shell (no Desk, no website chrome). Everything the client
needs up front is serialised into ``window.todobox_boot``.
"""

import os
from urllib.parse import urlencode

import frappe
from frappe.translate import get_all_translations
from frappe.utils import cint, get_system_timezone
from frappe.utils.jinja_globals import is_rtl

from todobox.services.desk_font import desk_font_css

no_cache = 1

# Front-end files whose modification times make up the cache-busting version
_ASSET_DIRS = ("js", "js/hub", "js/todobox", "css")


def get_context(context):
	if frappe.session.user == "Guest":
		path = frappe.request.path if getattr(frappe, "request", None) else "/todobox"
		frappe.local.flags.redirect_location = "/login?" + urlencode({"redirect-to": path or "/todobox"})
		raise frappe.Redirect(302)  # temporary: a cached 301 would keep bouncing after login

	# generating the CSRF token writes the session: commit like the Desk does
	from frappe.sessions import get_csrf_token

	csrf_token = get_csrf_token()
	frappe.db.commit()

	lang = frappe.local.lang or "en"
	rtl = is_rtl() or lang.split("-")[0] in ("ar", "he", "fa", "ps", "ur")

	context.no_cache = 1
	context.lang = lang
	context.layout_direction = "rtl" if rtl else "ltr"
	context.asset_version = get_asset_version()
	context.desk_font_css = desk_font_css(rtl)
	context.boot_json = to_script_json(get_boot(csrf_token, lang, rtl, context.asset_version))
	return context


def get_boot(csrf_token: str, lang: str, rtl: bool, asset_version: str) -> dict:
	"""``todobox_boot``: the app's own values plus ``frappe`` — the ``frappe.boot`` that
	frappe-web.bundle.js and the Frappe form controls (Date/Datetime, Link, MultiSelectPills,
	TextEditor…) read: system/user date & number formats, first day of the week, time zones."""
	user = frappe.session.user
	info = (
		frappe.db.get_value(
			"User", user, ["full_name", "user_image", "email", "user_type", "time_zone"], as_dict=True
		)
		or frappe._dict()
	)

	return {
		"csrf_token": csrf_token,
		"lang": lang,
		"is_rtl": bool(rtl),
		"asset_version": asset_version,
		"is_desk_user": info.user_type == "System User",
		"user": {
			"name": user,
			"full_name": info.full_name or user,
			"email": info.email or user,
			"user_image": info.user_image or "",
		},
		"max_file_size": get_max_file_size(),
		# realtime (socket.io): read by frappe.realtime (frappe-web.bundle.js)
		"dev_server": cint(getattr(frappe, "_dev_server", 0)),
		"socketio_port": frappe.conf.get("socketio_port") or 9000,
		# the same merged dictionary the Desk ships in boot.__messages (→ frappe._messages)
		"translations": get_all_translations(lang) if lang != "en" else {},
		"frappe": get_frappe_boot(user, info, lang),
	}


def get_frappe_boot(user: str, info: dict, lang: str) -> dict:
	"""The subset of the Desk boot (frappe/boot.py) that the website bundle and controls use."""
	from frappe.locale import get_date_format, get_first_day_of_the_week, get_number_format, get_time_format
	from frappe.utils.jinja_globals import bundled_asset

	system_tz = get_system_timezone()
	try:
		from frappe.boot import get_link_title_doctypes

		link_title_doctypes = get_link_title_doctypes()
	except Exception:
		link_title_doctypes = []

	return {
		"lang": lang,
		"sitename": frappe.local.site,
		"sysdefaults": {
			"date_format": get_date_format(),
			"time_format": get_time_format(),
			"first_day_of_the_week": get_first_day_of_the_week(),
			"number_format": get_number_format().string,
			"float_precision": cint(frappe.get_system_settings("float_precision")) or 3,
			"currency": frappe.get_system_settings("currency") or "",
			"allow_clearing_link_fields": 1,
		},
		"time_zone": {"system": system_tz, "user": info.get("time_zone") or system_tz},
		"user": {
			"name": user,
			"full_name": info.get("full_name") or user,
			"user_image": info.get("user_image") or "",
			"language": lang,
			"last_selected_values": {},
		},
		"desk": info.get("user_type") == "System User",
		"link_title_doctypes": link_title_doctypes,
		"single_types": frappe.get_all("DocType", {"issingle": 1}, pluck="name"),
		"socketio_port": frappe.conf.get("socketio_port") or 9000,
		"disable_async": cint(frappe.conf.get("disable_async")),
		# loaded on demand with frappe.require() (the Date picker, Link, pills, editor…)
		"assets_json": {"controls.bundle.js": bundled_asset("controls.bundle.js")},
	}


def get_max_file_size() -> int:
	try:
		from frappe.core.api.file import get_max_file_size as _max

		return _max()
	except Exception:
		return cint(frappe.conf.get("max_file_size")) or 25 * 1024 * 1024


def get_asset_version() -> str:
	"""Latest modification time of the app's front-end files (changes on every deploy/edit)."""
	public = frappe.get_app_path("todobox", "public")
	latest = 0.0
	for sub in _ASSET_DIRS:
		folder = os.path.join(public, sub)
		try:
			with os.scandir(folder) as entries:
				for entry in entries:
					if entry.is_file():
						latest = max(latest, entry.stat().st_mtime)
		except OSError:
			continue
	return str(int(latest)) if latest else frappe.utils.get_build_version()


def to_script_json(value) -> str:
	"""JSON that is safe inside an inline <script> (and in Frappe's page post-processing)."""
	out = frappe.as_json(value, indent=None, separators=(",", ":"), ensure_ascii=False)
	out = out.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
	out = out.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
	# TemplatePage.update_toc() replaces these literals anywhere in the rendered HTML
	return out.replace("{index}", "\\u007bindex}").replace("{next}", "\\u007bnext}")
