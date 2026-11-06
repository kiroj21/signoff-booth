/* Sign-Off Booth: shows which parts of a page you can change.
   Add ?marks=1 to any booth page address (for example /tablet?k=KEY&marks=1) and every customisable spot gets
   a dashed outline and a label that names the setting in brand/brand.json. Nothing is changed on the page itself. */
(function () {
  if (!/[?&]marks=1\b/.test(location.search)) return;
  var css = document.createElement('style');
  css.textContent =
    '[data-brand]{outline:3px dashed #D6249F !important;outline-offset:3px;position:relative}' +
    '.brand-chip{position:absolute;z-index:99999;background:#D6249F;color:#fff;font:700 12px/1.2 system-ui,sans-serif;padding:3px 7px;border-radius:4px;pointer-events:none;white-space:nowrap;letter-spacing:0;text-transform:none}';
  document.head.appendChild(css);
  function mark() {
    document.querySelectorAll('.brand-chip').forEach(function (n) { n.remove(); });
    document.querySelectorAll('[data-brand]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      var c = document.createElement('div');
      c.className = 'brand-chip';
      c.textContent = el.getAttribute('data-brand');
      c.style.left = Math.max(2, r.left + window.scrollX) + 'px';
      c.style.top = Math.max(2, r.top + window.scrollY - 20) + 'px';
      document.body.appendChild(c);
    });
  }
  window.addEventListener('load', function () { mark(); setInterval(mark, 1500); });
})();
