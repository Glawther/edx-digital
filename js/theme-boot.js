// Applies the saved theme before the first paint. A file of its own (not a module, not inline)
// so it runs early and the security policy can forbid inline scripts.
(function () {
  var theme = 'light';
  try { theme = localStorage.getItem('edx_theme') || 'light'; } catch (error) { /* storage blocked: light */ }
  document.documentElement.setAttribute('data-theme', theme);
})();
