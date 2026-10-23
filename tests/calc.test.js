// Автотесты расчёта по таблице test-cases_kalkulyator.xlsx. Запуск: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/prices.json');
const C = require('../public/calc.js');

// Московское время → Date (Москва UTC+3)
const at = (hhmm, day = 14) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 9, day, h - 3, m)); };
const NOON = at('14:00');
const L = (format, paper, qty, urgency = 'standard', edges = 'crop') => ({ format, paper, qty, urgency, edges });
const calc = (lines, now = NOON) => C.calculate(P, lines, now);
const sum = (r) => ({ print: r.print, surcharge: r.surcharge, discount: r.discount, total: r.total });

test('TC01 базовый расчёт', () => assert.deepEqual(sum(calc([L('10x15', 'glossy', 10)])), { print: 200, surcharge: 0, discount: 0, total: 200 }));
test('TC02 49 фото — без скидки, подсказка «ещё 1»', () => { const r = calc([L('10x15', 'glossy', 49)]); assert.equal(r.total, 980); assert.match(r.hint.text, /ещё 1 фото/); });
test('TC03 ровно 50 — скидка', () => { const r = calc([L('10x15', 'glossy', 50)]); assert.deepEqual(sum(r), { print: 1000, surcharge: 0, discount: 100, total: 900 }); assert.equal(r.hint.type, 'got'); });
test('TC04 две позиции, разная срочность, скидка', () => assert.deepEqual(sum(calc([L('10x15', 'matte', 30), L('20x30', 'glossy', 20, 'tomorrow')])), { print: 2920, surcharge: 660, discount: 358, total: 3222 }));
test('TC05 экспресс 15×21', () => assert.deepEqual(sum(calc([L('15x21', 'matte', 20, 'express')])), { print: 1040, surcharge: 728, discount: 0, total: 1768 }));
test('TC06 дробная наценка — вниз', () => assert.deepEqual(sum(calc([L('15x21', 'matte', 3, 'tomorrow')])), { print: 156, surcharge: 46, discount: 0, total: 202 }));
test('TC07 скидка от суммы с наценками', () => assert.deepEqual(sum(calc([L('10x15', 'matte', 50, 'express')])), { print: 1200, surcharge: 840, discount: 204, total: 1836 }));
test('TC08 ровно ,5 — тоже вниз', () => assert.equal(calc([L('10x15', 'glossy', 25), L('15x21', 'glossy', 25)]).total, 1462));
test('TC08a плавающая точка не «теряет» рубль', () => {
  assert.equal(calc([L('10x15', 'matte', 25, 'express')]).total, 1020);
  assert.equal(calc([L('10x15', 'matte', 50, 'express')]).total, 1836);
  // полный перебор: каждая позиция × количество 1..1000 × срочность = точное значение
  for (const f of Object.keys(P.prices)) for (const p of ['glossy', 'matte']) for (const u of P.urgency) {
    if (u.code === 'express' && !C.find(P.formats, f).express) continue;
    for (let q = 1; q <= 1000; q++) {
      const exact100 = q * P.prices[f][p] * u.percent * (q >= 50 ? 90 : 100); // в 1/10000 рубля
      assert.equal(calc([L(f, p, q, u.code)]).total, Math.floor(exact100 / 10000), `${f} ${p} ${u.code} ${q}`);
    }
  }
});
test('TC09 все три срочности', () => assert.deepEqual(sum(calc([L('10x15', 'glossy', 10, 'express'), L('15x21', 'matte', 20, 'tomorrow'), L('20x30', 'glossy', 30)])), { print: 4540, surcharge: 452, discount: 500, total: 4492 }));
test('TC10 окно подсказки', () => { assert.match(calc([L('10x15', 'glossy', 40)]).hint.text, /ещё 10 фото/); assert.equal(calc([L('10x15', 'glossy', 39)]).hint, null); });
test('TC11 ниже минимума', () => { const r = calc([L('10x15', 'glossy', 4)]); assert.equal(r.total, 80); assert.equal(r.canOrder, false); assert.match(r.hint.text, /ещё на 20 ₽/); });
test('TC12 ровно минимум', () => assert.equal(calc([L('10x15', 'glossy', 5)]).canOrder, true));
test('TC13 минимум по итогу со срочностью', () => { const r = calc([L('10x15', 'matte', 4, 'tomorrow')]); assert.deepEqual(sum(r), { print: 96, surcharge: 28, discount: 0, total: 124 }); assert.equal(r.canOrder, true); });
test('TC14 экспресс недоступен для 30×40', () => { assert.equal(C.urgencyAllowed(P, '30x40', 'express', NOON).reason, 'format'); assert.equal(C.urgencyAllowed(P, '10x15', 'express', NOON).ok, true); });
test('TC17 экспресс в 17:30 — можно, готов к 19:30', () => { assert.equal(C.urgencyAllowed(P, '10x15', 'express', at('17:30')).ok, true); assert.equal(C.readyAt(P, 'express', at('17:30')).getTime(), at('19:30').getTime()); });
test('TC17a в 17:31 — нельзя', () => { assert.equal(C.urgencyAllowed(P, '10x15', 'express', at('17:31')).reason, 'time'); assert.equal(calc([L('10x15', 'glossy', 10, 'express')], at('17:31')).ok, false); });
test('TC17b экспресс в 08:00 → к 13:00', () => assert.equal(C.readyAt(P, 'express', at('08:00')).getTime(), at('13:00').getTime()));
test('TC17c 10:00 и 10:59 → к 13:00', () => { for (const t of ['10:00', '10:59']) assert.equal(C.readyAt(P, 'express', at(t)).getTime(), at('13:00').getTime()); });
test('TC17d 11:00 → 13:00, 11:01 → 13:01', () => { assert.equal(C.readyAt(P, 'express', at('11:00')).getTime(), at('13:00').getTime()); assert.equal(C.readyAt(P, 'express', at('11:01')).getTime(), at('13:01').getTime()); });
test('TC18/21 ноль, минус, дробь, пусто', () => { for (const v of ['0', '-5', '2,5', '2.5', '', '  ']) assert.equal(C.checkQty(v, P).ok, false, v); });
test('TC19 максимум 1000', () => assert.equal(calc([L('10x15', 'glossy', 1000)]).total, 18000));
test('TC20 1001 — ошибка', () => assert.match(C.checkQty('1001', P).msg, /Напишите нам/));
test('TC22 нечисловой ввод; « 10 » принимается', () => { assert.equal(C.checkQty('abc', P).ok, false); assert.equal(C.checkQty('1e3', P).ok, false); assert.equal(C.checkQty(' 10 ', P).qty, 10); });
test('TC23 одинаковый формат с разной срочностью', () => assert.deepEqual(sum(calc([L('10x15', 'glossy', 10), L('10x15', 'glossy', 10, 'express')])), { print: 400, surcharge: 140, discount: 0, total: 540 }));
test('TC27 готовность по частям, заказ в 14:00', () => {
  assert.equal(C.readyAt(P, 'express', NOON).getTime(), at('16:00').getTime());
  assert.equal(C.readyAt(P, 'tomorrow', NOON).getTime(), at('12:00', 15).getTime());
  assert.equal(C.readyAt(P, 'standard', NOON).getTime(), at('12:00', 16).getTime());
});
test('Заказ в 23:30 «завтра» — на следующий календарный день', () => assert.equal(C.readyAt(P, 'tomorrow', at('23:30')).getTime(), at('12:00', 15).getTime()));

test('Контакты: телефон', () => {
  assert.equal(C.normPhone('+7 (912) 345-67-89'), '+79123456789');
  assert.equal(C.normPhone('89123456789'), '+79123456789');
  assert.equal(C.normPhone('+7 (912) 34'), null);
});
test('Контакты: всё верно / всё пусто', () => {
  const ok = { name: 'Анна-Мария', phone: '+7 912 345 67 89', email: 'a@mail.ru', link: 'https://cloud.mail.ru/public/abc', point: 'p1', consentPd: true, consentOffer: true };
  assert.deepEqual(C.checkContacts(ok, P), {});
  const e = C.checkContacts({}, P);
  assert.deepEqual(Object.keys(e).sort(), ['consentOffer', 'consentPd', 'email', 'link', 'name', 'phone', 'point']);
  assert.ok(C.checkContacts({ ...ok, link: 'http://x.ru' }, P).link);
  assert.ok(C.checkContacts({ ...ok, email: 'name@mail' }, P).email);
  assert.ok(C.checkContacts({ ...ok, name: 'А' }, P).name);
});
