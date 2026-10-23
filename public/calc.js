/* Фоточка — расчёт стоимости и сроков.
 * Один и тот же файл работает в браузере (window.Calc) и на сервере (require).
 * Все деньги считаются в целых числах: проценты срочности хранятся как 100/130/170,
 * поэтому ошибок плавающей точки (1019,999… вместо 1020) не бывает. Итог — вниз до рубля. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MSK_OFFSET_MIN = 180; // Москва, UTC+3, без перехода на летнее время

  function toMin(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function find(arr, code) { for (var i = 0; i < arr.length; i++) if (arr[i].code === code) return arr[i]; return null; }

  /* ---------- проверка количества ---------- */
  function checkQty(raw, P) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return { ok: false, msg: 'Укажите количество — от 1 до ' + P.settings.max_qty };
    if (!/^\d+$/.test(s)) return { ok: false, msg: 'Только целое число фото' };
    var q = parseInt(s, 10);
    if (q < 1) return { ok: false, msg: 'Укажите количество — от 1 до ' + P.settings.max_qty };
    if (q > P.settings.max_qty) return { ok: false, msg: 'Больше ' + P.settings.max_qty + ' фото? Напишите нам — сделаем отдельный расчёт' };
    return { ok: true, qty: q };
  }

  /* ---------- момент «сейчас» по Москве ---------- */
  function mskParts(date) {
    var d = new Date(date.getTime() + MSK_OFFSET_MIN * 60000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
  function mskDate(y, m, d, minutes) { // московское время → настоящий Date
    return new Date(Date.UTC(y, m, d, 0, minutes) - MSK_OFFSET_MIN * 60000);
  }

  /* Можно ли сейчас заказать экспресс (по времени суток) */
  function expressOpenNow(P, now) {
    var S = P.settings, t = mskParts(now || new Date()).min;
    var last = toMin(S.close) - S.express_stop_before_close_min; // 20:00 − 2:30 = 17:30
    return t <= last;
  }
  function expressLastTime(P) {
    var m = toMin(P.settings.close) - P.settings.express_stop_before_close_min;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Можно ли выбрать срок для формата */
  function urgencyAllowed(P, formatCode, urgencyCode, now) {
    if (urgencyCode !== 'express') return { ok: true };
    var f = find(P.formats, formatCode);
    if (!f || !f.express) return { ok: false, reason: 'format', msg: 'Через 2 часа печатаем только ' + P.formats.filter(function (x) { return x.express; }).map(function (x) { return x.label; }).join(' и ') };
    if (!expressOpenNow(P, now)) return { ok: false, reason: 'time', msg: 'Экспресс принимаем до ' + expressLastTime(P) + '. Сейчас можно заказать на завтра' };
    return { ok: true };
  }

  /* Время готовности позиции (настоящий Date) */
  function readyAt(P, urgencyCode, now) {
    var S = P.settings, n = mskParts(now || new Date());
    if (urgencyCode === 'express') {
      var start = Math.max(n.min, toMin(S.express_start_not_before));
      return mskDate(n.y, n.m, n.d, start + S.express_hours * 60);
    }
    var days = urgencyCode === 'tomorrow' ? 1 : 2;
    return mskDate(n.y, n.m, n.d + days, toMin(S.ready_from));
  }

  /* ---------- главный расчёт ----------
   * lines: [{format, paper, edges, qty, urgency}] — qty может быть строкой из поля ввода */
  function calculate(P, lines, now) {
    var S = P.settings, print = 0, base100 = 0, sur100 = 0, n = 0, errors = [];
    var out = lines.map(function (l, i) {
      var q = checkQty(l.qty, P);
      var price = P.prices[l.format] && P.prices[l.format][l.paper];
      var urg = find(P.urgency, l.urgency);
      var allowed = urgencyAllowed(P, l.format, l.urgency, now);
      var err = !q.ok ? q.msg : (!price ? 'Неизвестный формат или бумага' : (!urg ? 'Неизвестный срок' : (!allowed.ok ? allowed.msg : null)));
      if (err) { errors.push({ line: i, msg: err, reason: allowed.reason }); return { error: err }; }
      var cost = q.qty * price;                 // рубли, целое
      var withUrg100 = cost * urg.percent;      // сотые доли рубля, целое
      print += cost; base100 += withUrg100; sur100 += withUrg100 - cost * 100; n += q.qty;
      return { qty: q.qty, price: price, cost: cost, urgencyPercent: urg.percent };
    });
    var discount = n >= S.discount_threshold ? S.discount_percent : 0;
    var total = Math.floor(base100 * (100 - discount) / 10000);   // вниз до рубля
    var surcharge = Math.floor(sur100 / 100);                    // строка «Срочность», вниз
    var discountRub = print + surcharge - total;                 // разбивка всегда сходится

    var hint = null, ok = errors.length === 0;
    if (ok) {
      var left = S.discount_threshold - n;
      if (left > 0 && left <= S.hint_window) hint = { type: 'discount', text: 'Добавьте ещё ' + left + ' фото — и получите скидку ' + S.discount_percent + '% на весь заказ' };
      else if (discount) hint = { type: 'got', text: 'Скидка ' + S.discount_percent + '% за ' + S.discount_threshold + '+ фото — уже в цене' };
      if (total < S.min_order) hint = { type: 'min', text: 'Минимальный заказ — ' + S.min_order + ' ₽. Добавьте ещё на ' + (S.min_order - total) + ' ₽' };
    }
    return {
      ok: ok, canOrder: ok && total >= S.min_order && lines.length > 0 && lines.length <= S.max_lines,
      lines: out, errors: errors, photos: n,
      print: print, surcharge: surcharge, discountPercent: discount, discount: discountRub, total: total, hint: hint
    };
  }

  /* ---------- проверка контактов ---------- */
  function normPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
    return d.length === 10 ? '+7' + d : null;
  }
  function checkContacts(c, P) {
    var e = {};
    var name = String(c.name || '').trim();
    if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s-]*$/.test(name) || name.replace(/[\s-]/g, '').length < 2 || name.length > 60) e.name = 'Введите имя — хотя бы 2 буквы';
    if (!normPhone(c.phone)) e.phone = 'Проверьте номер — нужно 10 цифр после +7';
    var email = String(c.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 100) e.email = 'Похоже, в адресе ошибка. Пример: name@mail.ru';
    var link = String(c.link || '').trim(), okLink = false;
    try { var u = new URL(link); okLink = u.protocol === 'https:' && /\./.test(u.hostname) && link.length <= 500; } catch (x) {}
    if (!okLink) e.link = 'Вставьте ссылку на папку с фото — она начинается с https://';
    if (String(c.comment || '').length > 500) e.comment = 'Не больше 500 символов';
    if (!find(P.points, c.point)) e.point = 'Выберите пункт, где заберёте заказ';
    if (c.consentPd !== true) e.consentPd = 'Без согласия мы не сможем принять заказ';
    if (c.consentOffer !== true) e.consentOffer = 'Без согласия мы не сможем принять заказ';
    return e;
  }

  return {
    calculate: calculate, checkQty: checkQty, urgencyAllowed: urgencyAllowed, expressOpenNow: expressOpenNow,
    expressLastTime: expressLastTime, readyAt: readyAt, checkContacts: checkContacts, normPhone: normPhone,
    mskParts: mskParts, find: find
  };
});
