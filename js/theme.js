// Runs before the page is drawn, so a forced Light or Dark setting never flashes the other one first.
(function () {
  var mode = 'system';
  try { mode = localStorage.getItem('recipes.appearance') || 'system'; } catch (e) { /* keep the phone's setting */ }
  if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
})();
