/* Страница «Заказ оформлен»: берёт номер и ключ из адреса и показывает подтверждение. */
(function () {
  'use strict';
  var box = document.getElementById('receipt');
  var q = new URLSearchParams(location.search), n = q.get('n'), t = q.get('t');
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var rub = function (x) { return x.toLocaleString('ru-RU') + ' ₽'; };
  var tz = { timeZone: 'Europe/Moscow' };
  function when(iso) {
    var d = new Date(iso), now = new Date();
    var day = function (x) { return new Intl.DateTimeFormat('ru-RU', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz)).format(x); };
    var time = new Intl.DateTimeFormat('ru-RU', Object.assign({ hour: '2-digit', minute: '2-digit' }, tz)).format(d);
    var tomorrow = new Date(now.getTime() + 864e5);
    var prefix = day(d) === day(now) ? 'сегодня' : day(d) === day(tomorrow) ? 'завтра' : new Intl.DateTimeFormat('ru-RU', Object.assign({ day: 'numeric', month: 'long' }, tz)).format(d);
    return prefix + (time === '12:00' ? ' с 12:00' : ' к ' + time);
  }
  function empty() {
    box.innerHTML = '<span class="chip">Пусто</span><h2 style="margin-top:14px">Здесь <span class="g">пока пусто</span></h2>' +
      '<p class="lead" style="margin:10px 0 20px">Похоже, заказ ещё не оформлен. Посчитайте стоимость и оформите заказ — это займёт пару минут.</p>' +
      '<a class="btn up" href="/#calc">Посчитать заказ</a>';
  }
  if (!n || !t) return empty();
  fetch('/api/orders/' + encodeURIComponent(n) + '?t=' + encodeURIComponent(t), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (o) {
      document.title = 'Заказ №' + o.number + ' принят — Фоточка';
      var parts = o.lines.map(function (l) {
        return '<li><span>' + esc(l.format) + ', ' + esc(l.paper.toLowerCase()) + ', ' + esc(l.edges.toLowerCase()) + ' · ' + l.qty + ' шт.</span><b>' + esc(when(l.readyAt)) + '</b></li>';
      }).join('');
      box.innerHTML =
        '<span class="chip">✓ Заказ принят</span>' +
        '<h2 style="margin-top:14px">Заказ <span class="g">№' + esc(o.number) + '</span></h2>' +
        '<p class="lead" style="margin-bottom:10px">Сохраните номер — он понадобится при получении вместе с телефоном.</p>' +
        '<h3 style="font-size:14px;text-transform:uppercase;letter-spacing:.06em">Когда забирать</h3><ul class="parts">' + parts + '</ul>' +
        '<p><b style="color:var(--text)">Пункт выдачи:</b> ' + esc(o.point.name) + ' — ' + esc(o.point.address) + '. ' + esc(cap(o.point.hours)) + '.</p>' +
        '<div class="row" style="margin-top:14px"><span>Печать</span><span>' + rub(o.print) + '</span></div>' +
        (o.surcharge ? '<div class="row"><span>Срочность</span><span>+' + rub(o.surcharge) + '</span></div>' : '') +
        (o.discount ? '<div class="row disc"><span>Скидка</span><span>−' + rub(o.discount) + '</span></div>' : '') +
        '<div class="pay"><b>К оплате при получении</b><span class="price-big">' + rub(o.total) + '</span></div>' +
        '<p class="small" style="margin-top:0">Если с файлами что-то будет не так, менеджер свяжется с вами — срок изготовления отсчитается после исправления. Готовый заказ хранится 14 дней. Это подтверждение заказа, не кассовый чек: чек выдадим при оплате.</p>' +
        '<div class="noprint" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:18px"><button class="btn up" type="button" id="save">Сохранить подтверждение</button><a class="btn sec up" href="/#calc">Новый заказ</a></div>';
      document.getElementById('save').addEventListener('click', function () { window.print(); });
    })
    .catch(empty);
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
})();
