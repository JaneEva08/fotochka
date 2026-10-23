// Проверка сервера: 5 сценариев из ТЗ + защита. Поднимает сервер на свободном порту с временной базой.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PORT = 3100 + Math.floor(Math.random() * 500);
const DB = path.join(os.tmpdir(), `fotochka-test-${process.pid}.sqlite`);
let srv;
const base = `http://127.0.0.1:${PORT}`;
const good = { name: 'Иван Тестов', phone: '+7 (900) 000-00-00', email: 'test@example.com', link: 'https://cloud.mail.ru/public/test', point: 'p1', consentPd: true, consentOffer: true, comment: '' };
const post = (body, ip) => fetch(base + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Real-IP': ip } : {}) }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, j: await r.json() }));
let ipN = 1; const ip = () => `10.0.0.${ipN++}`;

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASS: 'secret', TRUST_PROXY: '1', VK_TOKEN: '' }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/health'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('server did not start');
});
test.after(() => { srv.kill(); for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true }); });

test('ТЗ-1 верный заказ → 201, номер, страница подтверждения отдаёт данные', async () => {
  const r = await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: 10, urgency: 'standard' }], contacts: good, total: 200 }, ip());
  assert.equal(r.status, 201);
  const o = await (await fetch(`${base}/api/orders/${r.j.number}?t=${r.j.token}`)).json();
  assert.equal(o.total, 200); assert.equal(o.point.name, 'Центр'); assert.equal(o.lines[0].qty, 10);
  assert.equal((await fetch(`${base}/api/orders/${r.j.number}?t=wrong`)).status, 404, 'без ключа заказ не открывается');
});
test('ТЗ-2 пустые поля → 422 с ошибками по каждому полю', async () => {
  const r = await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: 10, urgency: 'standard' }], contacts: {}, total: 200 }, ip());
  assert.equal(r.status, 422); assert.deepEqual(Object.keys(r.j.fields).sort(), ['consentOffer', 'consentPd', 'email', 'link', 'name', 'phone', 'point']);
});
test('ТЗ-3 неверный телефон → 422, ошибка у телефона', async () => {
  const r = await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: 10, urgency: 'standard' }], contacts: { ...good, phone: '+7 (912) 34' }, total: 200 }, ip());
  assert.equal(r.status, 422); assert.deepEqual(Object.keys(r.j.fields), ['phone']);
});
test('ТЗ-4 заказ со скидкой (50 фото) → 900 ₽', async () => {
  const r = await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'fit', qty: 50, urgency: 'standard' }], contacts: good, total: 900 }, ip());
  assert.equal(r.status, 201);
  const o = await (await fetch(`${base}/api/orders/${r.j.number}?t=${r.j.token}`)).json();
  assert.equal(o.discount, 100); assert.equal(o.total, 900);
});
test('ТЗ-5 заказ со срочностью «Завтра» → +30%, готовность завтра с 12:00', async () => {
  const r = await post({ lines: [{ format: '20x30', paper: 'matte', edges: 'crop', qty: 2, urgency: 'tomorrow' }], contacts: good, total: 325 }, ip());
  assert.equal(r.status, 201);
  const o = await (await fetch(`${base}/api/orders/${r.j.number}?t=${r.j.token}`)).json();
  assert.equal(o.surcharge, 75); assert.equal(o.total, 325);
  assert.match(new Date(o.lines[0].readyAt).toISOString(), /T09:00:00/, '12:00 по Москве = 09:00 UTC');
});
test('Подделанная сумма из браузера → 409, сервер называет правильную', async () => {
  const r = await post({ lines: [{ format: '30x40', paper: 'matte', edges: 'crop', qty: 10, urgency: 'standard' }], contacts: good, total: 1 }, ip());
  assert.equal(r.status, 409); assert.equal(r.j.total, 3300);
});
test('Экспресс для 30×40 → отказ', async () => {
  const r = await post({ lines: [{ format: '30x40', paper: 'matte', edges: 'crop', qty: 1, urgency: 'express' }], contacts: good, total: 561 }, ip());
  assert.ok([409, 422].includes(r.status));
});
test('Ниже минимума → 422', async () => {
  const r = await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: 4, urgency: 'standard' }], contacts: good, total: 80 }, ip());
  assert.equal(r.status, 422); assert.equal(r.j.error, 'min_order');
});
test('Ловушка для ботов: делаем вид, что приняли, но не сохраняем', async () => {
  const r = await post({ lines: [], contacts: {}, total: 0, website: 'spam' }, ip());
  assert.equal(r.status, 200); assert.equal(r.j.number, '0000');
});
test('Не больше 5 заказов за 10 минут с одного адреса', async () => {
  const one = ip(); let last;
  for (let i = 0; i < 6; i++) last = await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: 10, urgency: 'standard' }], contacts: good, total: 200 }, one);
  assert.equal(last.status, 429);
});
test('Страница заказов закрыта паролем и экранирует данные', async () => {
  assert.equal((await fetch(base + '/admin')).status, 401);
  await post({ lines: [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: 10, urgency: 'standard' }], contacts: { ...good, comment: '<script>alert(1)</script>' }, total: 200 }, ip());
  const html = await (await fetch(base + '/admin', { headers: { Authorization: 'Basic ' + Buffer.from('manager:secret').toString('base64') } })).text();
  assert.match(html, /Иван Тестов/); assert.doesNotMatch(html, /<script>alert/);
});
test('Нельзя прочитать файлы сервера через адрес', async () => {
  for (const u of ['/../server/server.js', '/%2e%2e/server/server.js', '/..%2f.env']) assert.equal((await fetch(base + u)).status, 404, u);
});
