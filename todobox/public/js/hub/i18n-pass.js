/* Translate template text before the engine reads it: English is the source, {{ ... }} stays as is */
(function () {
  /* the template inside <template data-dc> is inert (the browser doesn't fetch {{ }} links) */
  var tpl = document.querySelector('template[data-dc]');
  var root = (tpl && tpl.content && tpl.content.querySelector('x-dc')) || document.querySelector('x-dc');
  if (!root || !window.__) return;
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  function tr(str) {
    var core = str.trim();
    if (!core || !/[A-Za-z]/.test(core.replace(/\{\{[^}]*\}\}/g, ''))) return str;
    var slots = [];
    var key = core.replace(/\{\{[^}]*\}\}/g, function (m) { slots.push(m); return '{' + (slots.length - 1) + '}'; });
    var out = window.__(key);
    if (!out || out === key) return str;
    out = out.replace(/\{(\d+)\}/g, function (m, i) { return slots[i] !== undefined ? slots[i] : m; });
    return str.replace(core, out);
  }
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  var n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3) {
      var p = n.parentNode && n.parentNode.nodeName;
      if (p === 'STYLE' || p === 'SCRIPT') continue;
      var v = tr(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    } else {
      for (var i = 0; i < ATTRS.length; i++) {
        var a = n.getAttribute(ATTRS[i]);
        if (a && a.indexOf('{{') === -1) { var t = tr(a); if (t !== a) n.setAttribute(ATTRS[i], t); }
      }
    }
  }
})();
