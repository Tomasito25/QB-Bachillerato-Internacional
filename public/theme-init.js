// Aplica el tema guardado antes de pintar. localStorage sólo guarda esta preferencia,
// que no es sensible; el resto de ajustes viven en IndexedDB, que es asíncrono.
(function () {
  var theme = 'system';
  try {
    theme = localStorage.getItem('qb-theme') || 'system';
  } catch (e) {
    /* Modo privado o almacenamiento bloqueado: se usa el del sistema. */
  }
  var dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
