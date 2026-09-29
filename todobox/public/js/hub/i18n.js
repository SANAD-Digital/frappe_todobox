/* translation, language and direction: from window.todobox_boot (www/todobox.py) via frappe_shim.js */
(function () {
  var boot = window.todobox_boot || {};
  var lang = boot.lang || 'en';
  var rtl = boot.is_rtl != null ? !!boot.is_rtl : /^(ar|fa|he|ur|ps)\b/.test(lang);
  if (!window.__) {
    window.__ = function (t, r) {
      if (r == null) return t;
      if (!Array.isArray(r)) r = [r];
      return String(t).replace(/\{(\d+)\}/g, function (m, i) { return r[i] !== undefined ? r[i] : m; });
    };
  }
  window.TT_LANG = lang;
  /* After boot the engine refetches the page and replaces the template with its original English copy
     (reverting translated text to English). Defining __resources stops that fetch;
     all its other uses are key lookups that fall back to the default when missing. */
  window.__resources = window.__resources || {};
  window.TT_DIR = rtl ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', window.TT_DIR);
})();
