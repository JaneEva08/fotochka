/* Фоточка — сервер заказов.
 * Без внешних зависимостей: Node.js 22+ (встроенные http и sqlite).
 * Запуск: node server/server.js   (настройки — в файле .env рядом с папкой server, см. .env.example) */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
process.removeAllListeners('warning'); // скрываем предупреждение «sqlite experimental»
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const PUB = path.join(ROOT, 'public');

/* ---------- настройки ---------- */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv(path.join(ROOT, '.env'));
const CFG = {
  port: +(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  db: process.env.DB_PATH || path.join(ROOT, 'data', 'orders.sqlite'),
  vkToken: process.env.VK_TOKEN || '',
  vkPeer: process.env.VK_PEER_ID || '',
  adminUser: process.env.ADMIN_USER || 'manager',
  adminPass: process.env.ADMIN_PASS || '',
  trustProxy: process.env.TRUST_PROXY === '1',
  siteUrl: process.env.SITE_URL || '',
};

const Calc = require(path.join(PUB, 'calc.js'));
let PRICES = JSON.parse(fs.readFileSync(path.join(PUB, 'prices.json'), 'utf8'));
fs.watchFile(path.join(PUB, 'prices.json'), () => { // прайс обновили — подхватываем без перезапуска
  try { PRICES = JSON.parse(fs.readFileSync(path.join(PUB, 'prices.json'), 'utf8')); log('prices reloaded'); } catch (e) { log('prices reload failed', e.message); }
});

/* ---------- база ---------- */
fs.mkdirSync(path.dirname(CFG.db), { recursive: true });
const db = new DatabaseSync(CFG.db);
db.exec(`CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE, token TEXT, created_at TEXT,
  name TEXT, phone TEXT, email TEXT, link TEXT, comment TEXT, point TEXT,
  lines_json TEXT, print INTEGER, surcharge INTEGER, discount INTEGER, total INTEGER,
  ip TEXT, vk_status TEXT)`);
const insertOrder = db.prepare(`INSERT INTO orders (number, token, created_at, name, phone, email, link, comment, point, lines_json, print, surcharge, discount, total, ip, vk_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`);
const setNumber = db.prepare('UPDATE orders SET number = ? WHERE id = ?');
const setVk = db.prepare('UPDATE orders SET vk_status = ? WHERE id = ?');
const getByNumber = db.prepare('SELECT * FROM orders WHERE number = ?');
const listOrders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300');

function log(...a) { console.log(new Date().toISOString(), ...a); }

/* ---------- защита от спама: не больше 5 заказов за 10 минут с одного адреса ---------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 5;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.every((t) => now - t > 600000)) hits.delete(k); }, 600000).unref();

/* ---------- утилиты ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
};
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, ...SECURITY, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function clientIp(req) {
  if (CFG.trustProxy && req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  return req.socket.remoteAddress || '';
}
function readJson(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}
const fmtMsk = (d) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d);

/* ---------- заказ ---------- */
function buildOrderView(row) {
  const lines = JSON.parse(row.lines_json);
  const point = Calc.find(PRICES.points, row.point) || { name: row.point, address: '', hours: '' };
  return {
    number: row.number, createdAt: row.created_at, point,
    lines, print: row.print, surcharge: row.surcharge, discount: row.discount, total: row.total,
  };
}

async function createOrder(req, res) {
  const ip = clientIp(req);
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { error: 'bad_request' }); }
  if (body.website) { log('honeypot', ip); return send(res, 200, { number: '0000', token: 'x' }); } // бот: делаем вид, что всё ок
  if (rateLimited(ip)) return send(res, 429, { error: 'too_many', message: 'Слишком много заказов подряд. Попробуйте через несколько минут или позвоните нам.' });

  const c = body.contacts || {};
  const errors = Calc.checkContacts(c, PRICES);
  const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, PRICES.settings.max_lines + 1) : [];
  const now = new Date();
  const r = Calc.calculate(PRICES, rawLines.map((l) => ({ format: l.format, paper: l.paper, edges: l.edges, qty: l.qty, urgency: l.urgency })), now);
  if (!r.ok) {
    if (r.errors.some((e) => e.reason === 'time')) return send(res, 409, { error: 'express_closed', message: 'Экспресс уже не принимаем — выберите «Завтра».' });
    return send(res, 422, { error: 'bad_lines', lines: r.errors });
  }
  if (rawLines.some((l) => !Calc.find(PRICES.edges, l.edges))) return send(res, 422, { error: 'bad_lines' });
  if (Object.keys(errors).length) return send(res, 422, { error: 'bad_contacts', fields: errors });
  if (!r.canOrder) return send(res, 422, { error: 'min_order', message: r.hint ? r.hint.text : 'Заказ не может быть оформлен' });
  // сумму считает сервер; если в браузере была другая (обновился прайс / кто-то подправил страницу) — просим подтвердить
  if (+body.total !== r.total) return send(res, 409, { error: 'price_changed', total: r.total, message: 'Цены обновились. Проверьте новую сумму и отправьте заказ ещё раз.' });

  const lines = rawLines.map((l, i) => {
    const f = Calc.find(PRICES.formats, l.format), p = Calc.find(PRICES.papers, l.paper), u = Calc.find(PRICES.urgency, l.urgency), e = Calc.find(PRICES.edges, l.edges);
    return { format: f.label, paper: p.label, edges: e.label, qty: r.lines[i].qty, urgency: u.label, term: u.term, readyAt: Calc.readyAt(PRICES, l.urgency, now).toISOString(), cost: r.lines[i].cost };
  });
  const token = crypto.randomBytes(16).toString('hex');
  const info = insertOrder.run('tmp-' + token, token, now.toISOString(), String(c.name).trim(), Calc.normPhone(c.phone), String(c.email).trim(), String(c.link).trim(),
    String(c.comment || '').trim(), c.point, JSON.stringify(lines), r.print, r.surcharge, r.discount, r.total, ip);
  const number = String(1000 + Number(info.lastInsertRowid));
  setNumber.run(number, info.lastInsertRowid);
  log('order', number, r.total, 'RUB');
  notifyVk(Number(info.lastInsertRowid), number).catch((e) => log('vk error', e.message));
  send(res, 201, { number, token });
}

/* ---------- уведомление менеджеру во ВКонтакте ---------- */
async function notifyVk(id, number) {
  if (!CFG.vkToken || !CFG.vkPeer) { setVk.run('off', id); return; }
  const o = getByNumber.get(number), v = buildOrderView(o);
  const text = [
    `🆕 Заказ №${number} — ${v.total} ₽ (оплата при получении)`,
    `Пункт: ${v.point.name}, ${v.point.address}`,
    ...v.lines.map((l) => `• ${l.format}, ${l.paper.toLowerCase()}, ${l.edges.toLowerCase()} × ${l.qty} — ${l.urgency.toLowerCase()}, к ${fmtMsk(new Date(l.readyAt))}`),
    `Клиент: ${o.name}, ${o.phone}`,
    `Фото: ${o.link}`,
    o.comment ? `Комментарий: ${o.comment}` : '',
    CFG.siteUrl ? `Все заказы: ${CFG.siteUrl}/admin` : '',
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({ peer_id: CFG.vkPeer, random_id: String(crypto.randomInt(1, 2 ** 31)), message: text, access_token: CFG.vkToken, v: '5.199' });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch('https://api.vk.com/method/messages.send', { method: 'POST', body: params, signal: AbortSignal.timeout(8000) });
      const j = await resp.json();
      if (j.error) throw new Error(`VK ${j.error.error_code}: ${j.error.error_msg}`);
      setVk.run('sent', id); return;
    } catch (e) {
      log(`vk attempt ${attempt} failed:`, e.message.replace(CFG.vkToken, '***'));
      if (attempt === 3) { setVk.run('failed', id); return; }
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

/* ---------- страница «Заказы» для менеджера ---------- */
function checkAuth(req) {
  if (!CFG.adminPass) return false;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  const a = Buffer.from(u + ':' + p.join(':')), b = Buffer.from(CFG.adminUser + ':' + CFG.adminPass);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function adminPage(req, res) {
  if (!CFG.adminPass) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  if (!checkAuth(req)) return send(res, 401, 'Нужен логин и пароль', 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Fotochka", charset="UTF-8"' });
  const rows = listOrders.all().map((o) => {
    const v = buildOrderView(o);
    return `<tr><td><b>№${esc(o.number)}</b><br><small>${esc(fmtMsk(new Date(o.created_at)))}</small></td>
      <td>${esc(o.name)}<br>${esc(o.phone)}<br>${esc(o.email)}</td>
      <td>${v.lines.map((l) => `${esc(l.format)} ${esc(l.paper.toLowerCase())}, ${esc(l.edges.toLowerCase())} × ${l.qty}<br><small>${esc(l.urgency)} → ${esc(fmtMsk(new Date(l.readyAt)))}</small>`).join('<br>')}</td>
      <td>${esc(v.point.name)}</td><td><b>${o.total} ₽</b><br><small>скидка ${o.discount} ₽</small></td>
      <td><a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">папка</a>${o.comment ? `<br><small>${esc(o.comment)}</small>` : ''}</td>
      <td><small>${{ sent: 'отправлено', failed: 'ошибка', off: 'выключено', pending: '…' }[o.vk_status] || esc(o.vk_status)}</small></td></tr>`;
  }).join('');
  send(res, 200, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заказы — Фоточка</title>
  <style>body{font:14px/1.45 system-ui,sans-serif;margin:20px;background:#f6f4fc;color:#17142b}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #e3def2;padding:8px;vertical-align:top;text-align:left}th{background:#ede8fb}small{color:#6e6a86}h1{font-size:20px}</style></head>
  <body><h1>Заказы «Фоточки» (последние 300)</h1><p><small>Только просмотр. Статусы и подтверждение заказов — в версии 2.</small></p>
  <table><tr><th>Заказ</th><th>Клиент</th><th>Состав и готовность</th><th>Пункт</th><th>Сумма</th><th>Фото</th><th>ВК</th></tr>${rows || '<tr><td colspan="7">Заказов пока нет</td></tr>'}</table></body></html>`, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
}

/* ---------- статика ---------- */
const PAGES = { '/': 'index.html', '/zakaz-oformlen': 'zakaz-oformlen.html', '/privacy': 'privacy.html', '/oferta': 'oferta.html', '/soglasie': 'soglasie.html' };
function serveStatic(req, res, pathname) {
  let rel = PAGES[pathname] || pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, fs.readFileSync(path.join(PUB, '404.html')), 'text/html; charset=utf-8');
  }
  const ext = path.extname(file);
  const cache = ext === '.woff2' ? 'public, max-age=31536000, immutable' : (ext === '.html' || ext === '.json' ? 'no-cache' : 'public, max-age=3600');
  send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream', { 'Cache-Control': cache });
}

/* ---------- маршруты ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (req.method === 'POST' && p === '/api/orders') return await createOrder(req, res);
    if (req.method === 'GET' && p.startsWith('/api/orders/')) {
      const row = getByNumber.get(decodeURIComponent(p.split('/')[3] || ''));
      const t = url.searchParams.get('t') || '';
      if (!row || !row.token || row.token.length !== t.length || !crypto.timingSafeEqual(Buffer.from(row.token), Buffer.from(t))) return send(res, 404, { error: 'not_found' });
      return send(res, 200, buildOrderView(row), undefined, { 'Cache-Control': 'no-store' });
    }
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/admin') return adminPage(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    log('error', e.stack);
    if (!res.headersSent) send(res, 500, { error: 'server_error', message: 'Что-то пошло не так. Попробуйте ещё раз.' });
  }
});
server.listen(CFG.port, CFG.host, () => log(`Фоточка: http://${CFG.host}:${CFG.port}  (ВК: ${CFG.vkToken ? 'включено' : 'выключено'}, /admin: ${CFG.adminPass ? 'включено' : 'выключено'})`));
