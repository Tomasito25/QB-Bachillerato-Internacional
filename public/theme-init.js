// Aplica el aspecto guardado antes de pintar. localStorage sólo guarda estas preferencias, que
// no son sensibles; el resto de ajustes viven en IndexedDB, que es asíncrono.
(function () {
  var root = document.documentElement;
  var get = function (key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      /* Modo privado o almacenamiento bloqueado: se usan los de por defecto. */
      return fallback;
    }
  };
  var theme = get('qb-theme', 'system');
  var dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = get('qb-accent', 'indigo');
  root.dataset.text = get('qb-text', 'normal');
  root.dataset.font = get('qb-font', 'inter');
})();
