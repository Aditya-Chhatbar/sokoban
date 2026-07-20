window.APP_VERSION = '7';

(function() {
  var v = '?v=' + window.APP_VERSION;

  document.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    el.href = el.href.split('?')[0] + v;
  });

  document.querySelectorAll('script[src]').forEach(function(el) {
    if (el.src.indexOf('version.js') !== -1) return;
    el.src = el.src.split('?')[0] + v;
  });
})();
