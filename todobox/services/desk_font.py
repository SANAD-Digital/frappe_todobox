"""The Desk's typeface for the standalone /todobox page (and the website demo that renders it).

/todobox has its own shell and does not load the Desk CSS, so on its own it would only know
Frappe's default stack. desk_font_css() lifts the font part of every installed app's
``app_include_css`` (Frappe's own --font-stack, a theme app's @font-face rules and font
variables) into a small inline <style>, so whatever typeface the Desk is given — by Frappe or by
a theme — the tool gets too. Font sizes, weights and every other rule are left out.

The per-user choice a theme makes at runtime (e.g. an attribute or variable set by its JS from
the user's settings) is picked up in the browser by public/js/desk_font.js.
"""

import hashlib
import os
import re
from urllib.parse import urljoin

import frappe

_FONT_FACE = re.compile(r"@font-face\s*\{[^{}]*\}", re.I)
_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
# only page-level rules (:root, html, body and their attribute/class variants): not a widget's own preview fonts
_ROOT_SEL = re.compile(r"^(?::root|html|body)(?![\w-])[^\s>+~]*(?:\s+(?:body)(?![\w-])[^\s>+~]*)?$", re.I)
_URL = re.compile(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", re.I)
# font-family variables only: not sizes/weights/line-heights, and not the tool's own --font / --tb-font
_FONT_VAR = re.compile(r"^--(?!font$|tb-font$)[\w-]*font(?![\w-]*(?:size|weight|line|spacing|feature|smooth))[\w-]*$", re.I)


def desk_font_css(rtl: bool = False) -> str:
	key = "todobox:desk_font_css:%s:%s" % (_signature(), int(bool(rtl)))
	cache = frappe.cache()
	css = cache.get_value(key)
	if css is None:
		try:
			css = _build(rtl)
		except Exception:
			frappe.log_error(title="ToDoBox: desk font CSS", message=frappe.get_traceback())
			css = ""
		cache.set_value(key, css, expires_in_sec=24 * 3600)
	return css


def _signature() -> str:
	try:
		build = frappe.utils.get_build_version()
	except Exception:
		build = ""
	apps = ",".join(frappe.get_installed_apps())
	return hashlib.sha1(("%s|%s" % (build, apps)).encode()).hexdigest()[:12]


def _css_files(rtl: bool):
	from frappe.utils.jinja_globals import bundled_asset

	assets = os.path.join(frappe.local.sites_path, "assets")
	for path in frappe.get_hooks("app_include_css") or []:
		try:
			url = bundled_asset(path, rtl)
		except Exception:
			continue
		url = "/" + url.split("://", 1)[-1].split("/", 1)[-1] if "://" in url else url
		url = url.split("?", 1)[0]
		if not url.startswith("/assets/"):
			continue
		file = os.path.join(assets, url[len("/assets/") :])
		if os.path.isfile(file):
			yield url, file


def _absolute_urls(block: str, base: str) -> str:
	def fix(m):
		u = m.group(2).strip()
		if not re.match(r"^(?:/|data:|https?:|#)", u, re.I):
			u = urljoin(base, u)
		return 'url("%s")' % u.replace('"', "%22")

	return _URL.sub(fix, block)


def _build(rtl: bool) -> str:
	out = []
	for url, file in _css_files(rtl):
		with open(file, encoding="utf-8", errors="ignore") as f:
			css = re.sub(r"/\*.*?\*/", "", f.read(), flags=re.S)
		for face in _FONT_FACE.findall(css):
			out.append(_absolute_urls(re.sub(r"\s+", " ", face), url))
		css = _FONT_FACE.sub("", css)
		for selector, body in _RULE.findall(css):
			selector = selector.strip().split(";")[-1].strip()
			if not selector or selector.startswith("@") or not all(_ROOT_SEL.match(x.strip()) for x in selector.split(",")):
				continue
			decls = []
			for decl in body.split(";"):
				name, sep, value = decl.partition(":")
				name = name.strip()
				if sep and _FONT_VAR.match(name) and value.strip():
					decls.append("%s:%s" % (name, re.sub(r"\s+", " ", value.strip())))
			if decls:
				out.append("%s{%s}" % (re.sub(r"\s+", " ", selector), ";".join(decls)))
	# Frappe's embedded form controls (.tm-frappe) restate Frappe's default stack: follow the page instead
	out.append("html .tm-frappe{--font-stack:inherit}")
	return "\n".join(out).replace("</", "<\\/")
