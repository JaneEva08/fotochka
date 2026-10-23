/* Тема: сохранённый выбор → системная настройка → тёмная. Подключается в <head>, чтобы не было «мигания». */
(function () {
  var KEY = 'fotochka-theme', root = document.documentElement, t = null;
  try { t = localStorage.getItem(KEY); } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.setAttribute('data-theme', t);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', n);
    try { localStorage.setItem(KEY, n); } catch (e2) {}
  });
})();
