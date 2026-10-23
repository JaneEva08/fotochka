/* Фоточка — калькулятор и форма заказа на главной странице. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var P = null; // прайс из /prices.json
  var lines = [{ format: '10x15', paper: 'glossy', edges: 'crop', qty: '10', urgency: 'standard', note: '' }];
  var last = null; // последний результат расчёта
  var box = $('#lines'), form = $('#orderForm'), msg = $('#formMsg');
  var rub = function (n) { return n.toLocaleString('ru-RU') + ' ₽'; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---------- прайс ---------- */
  function loadPrices() {
    return fetch('/prices.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); });
  }

  /* ---------- позиции калькулятора ---------- */
  function options(list, value, isDisabled) {
    return list.map(function (o) {
      var dis = isDisabled ? isDisabled(o) : false;
      return '<option value="' + o.code + '"' + (o.code === value ? ' selected' : '') + (dis ? ' disabled' : '') + '>' + esc(o.text || o.label) + (dis ? ' — недоступно' : '') + '</option>';
    }).join('');
  }
  function urgencyList() {
    return P.urgency.map(function (u) { return { code: u.code, text: cap(u.term) + (u.percent > 100 ? ' (+' + (u.percent - 100) + '%)' : '') }; });
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function render() {
    var now = new Date();
    box.innerHTML = '';
    lines.forEach(function (l, i) {
      var d = document.createElement('div');
      d.className = 'line';
      d.innerHTML =
        '<div><label for="l' + i + 'f">Формат</label><select id="l' + i + 'f" data-k="format">' + options(P.formats, l.format) + '</select></div>' +
        '<div><label for="l' + i + 'p">Бумага</label><select id="l' + i + 'p" data-k="paper">' + options(P.papers, l.paper) + '</select></div>' +
        '<div><label for="l' + i + 'e">Края</label><select id="l' + i + 'e" data-k="edges">' + options(P.edges, l.edges) + '</select></div>' +
        '<div><label for="l' + i + 'q">Кол-во, шт.</label><input id="l' + i + 'q" data-k="qty" inputmode="numeric" autocomplete="off" value="' + esc(l.qty) + '"></div>' +
        '<div class="ucell"><label for="l' + i + 'u">Срок</label><select id="l' + i + 'u" data-k="urgency">' +
          options(urgencyList(), l.urgency, function (o) { return !Calc.urgencyAllowed(P, l.format, o.code, now).ok; }) + '</select></div>' +
        '<div class="rmcell">' + (lines.length > 1 ? '<button type="button" class="rm" aria-label="Убрать позицию ' + (i + 1) + '">Убрать</button>' : '') + '</div>' +
        '<div class="ferr" role="alert"></div><div class="note">' + esc(l.note || '') + '</div>';
      d.addEventListener('change', function (e) { onChange(i, e.target); });
      d.addEventListener('input', function (e) { if (e.target.dataset.k === 'qty') { l.qty = e.target.value; l.note = ''; calc(); } });
      var rm = $('.rm', d); if (rm) rm.addEventListener('click', function () { lines.splice(i, 1); render(); });
      box.appendChild(d);
    });
    $('#add').disabled = lines.length >= P.settings.max_lines;
    calc();
  }

  function onChange(i, el) {
    var k = el.dataset.k, l = lines[i];
    if (!k || k === 'qty') return;
    l[k] = el.value; l.note = '';
    fixUrgency(l);
    render();
    var again = box.children[i] && $('[data-k="' + k + '"]', box.children[i]); if (again) again.focus();
  }

  // если выбранный срок стал недоступен (сменили формат / прошло 17:30) — ставим «Завтра» и объясняем почему
  function fixUrgency(l) {
    var a = Calc.urgencyAllowed(P, l.format, l.urgency, new Date());
    if (a.ok) return false;
    l.urgency = 'tomorrow';
    l.note = a.reason === 'format' ? 'Для этого формата экспресс недоступен — поставили «Завтра»' : a.msg.replace('. Сейчас можно заказать на завтра', ' — поставили «Завтра»');
    return true;
  }

  /* ---------- расчёт и итог ---------- */
  function calc() {
    var r = Calc.calculate(P, lines, new Date());
    last = r;
    Array.prototype.forEach.call(box.children, function (d, i) {
      var e = r.errors.filter(function (x) { return x.line === i; })[0];
      $('.ferr', d).textContent = e ? e.msg : '';
      $('[data-k="qty"]', d).classList.toggle('err', !!(e && e.reason === undefined));
    });
    $('#tPrint').textContent = rub(r.print);
    $('#tSur').textContent = '+' + rub(r.surcharge);
    $('#rSur').style.display = r.surcharge > 0 ? '' : 'none';
    $('#rDisc').style.display = r.discount > 0 ? '' : 'none';
    $('#tDiscLabel').textContent = 'Скидка ' + r.discountPercent + '%';
    $('#tDisc').textContent = '−' + rub(r.discount);
    $('#tTotal').textContent = r.ok ? rub(r.total) : '—';
    $('#hint').textContent = r.hint ? r.hint.text : '';
    $('#go').classList.toggle('off', !r.canOrder);
    $('#go').setAttribute('aria-disabled', String(!r.canOrder));
    renderMini(r);
    return r;
  }

  function renderMini(r) {
    var label = function (list, code) { var o = Calc.find(list, code); return o ? o.label : code; };
    var term = function (code) { var u = Calc.find(P.urgency, code); return u ? cap(u.term) : code; };
    var html = lines.map(function (l, i) {
      var q = r.lines[i] && r.lines[i].qty;
      return '<li><span>' + esc(label(P.formats, l.format)) + ', ' + esc(label(P.papers, l.paper).toLowerCase()) + ', ' + esc(label(P.edges, l.edges).toLowerCase()) + ' · ' + (q ? q + ' шт.' : '<em>укажите количество</em>') + '</span><span>' + esc(term(l.urgency)) + '</span></li>';
    }).join('');
    html += '<li><b>Итого</b><b>' + (r.ok ? rub(r.total) : '—') + '</b></li>';
    $('#mini').innerHTML = html;
  }

  /* ---------- маска телефона ---------- */
  function maskPhone(v) {
    // «+7…» или «8…»/«7…» в начале — код страны; иначе считаем, что ввели номер без него
    var raw = String(v).trim(), d = raw.replace(/\D/g, '');
    if (raw.charAt(0) === '+') d = d.slice(1);
    else if (d.charAt(0) === '8' || d.charAt(0) === '7') d = d.slice(1);
    d = d.slice(0, 10);
    if (!d && !raw) return '';
    var out = '+7';
    if (d.length) out += ' (' + d.slice(0, 3);
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
  }

  /* ---------- форма ---------- */
  function contacts() {
    var f = form.elements;
    return {
      name: f.name.value, phone: f.phone.value, email: f.email.value, link: f.link.value, comment: f.comment.value,
      point: (form.querySelector('input[name="point"]:checked') || {}).value || '',
      consentPd: f.consentPd.checked, consentOffer: f.consentOffer.checked,
    };
  }
  function showErrors(errs, only) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-err]'), function (el) {
      var k = el.dataset.err;
      if (only && only.indexOf(k) < 0) return;
      el.textContent = errs[k] || '';
      var inp = form.elements[k];
      if (inp && inp.classList) inp.classList.toggle('bad', !!errs[k]);
    });
  }
  var touched = {};
  form.addEventListener('focusout', function (e) {
    var k = e.target.name; if (!k || k === 'website') return;
    touched[k] = true;
    showErrors(Calc.checkContacts(contacts(), P), Object.keys(touched));
  });
  form.addEventListener('change', function (e) {
    var k = e.target.name; if (k === 'point' || k === 'consentPd' || k === 'consentOffer') { touched[k] = true; showErrors(Calc.checkContacts(contacts(), P), Object.keys(touched)); }
  });
  form.elements.phone.addEventListener('input', function (e) { e.target.value = maskPhone(e.target.value); });
  // ошибку убираем сразу, как только поле исправлено, — а не при уходе с поля:
  // иначе форма «прыгает» в момент нажатия кнопки и нажатие проходит мимо неё
  form.addEventListener('input', function (e) {
    var k = e.target.name; if (!k || !touched[k]) return;
    var err = Calc.checkContacts(contacts(), P)[k];
    var el = form.querySelector('[data-err="' + k + '"]');
    if (!err && el && el.textContent) showErrors({}, [k]);
  });

  function setMsg(text, info) { msg.textContent = text || ''; msg.classList.toggle('info', !!info); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    setMsg('');
    lines.forEach(fixUrgency);
    render();
    var r = last;
    if (!r.ok) { setMsg('Проверьте калькулятор: в заказе есть ошибки.'); $('#calc').scrollIntoView({ behavior: 'smooth' }); return; }
    if (!r.canOrder) { setMsg(r.hint ? r.hint.text : 'Заказ пока нельзя оформить.'); return; }
    var c = contacts(), errs = Calc.checkContacts(c, P);
    ['name', 'phone', 'email', 'link', 'point', 'consentPd', 'consentOffer'].forEach(function (k) { touched[k] = true; });
    showErrors(errs);
    var keys = Object.keys(errs);
    if (keys.length) {
      setMsg('Заполните, пожалуйста, отмеченные поля.');
      var first = form.elements[keys[0]]; if (first && first.focus) first.focus(); else $('#pointBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var btn = $('#submitBtn'); btn.disabled = true; btn.textContent = 'Отправляем…';
    fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: lines.map(function (l) { return { format: l.format, paper: l.paper, edges: l.edges, qty: l.qty, urgency: l.urgency }; }), contacts: c, total: r.total, website: form.elements.website.value }),
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (j) { return { status: resp.status, j: j }; });
    }).then(function (res) {
      if (res.status === 201) { location.href = '/zakaz-oformlen?n=' + encodeURIComponent(res.j.number) + '&t=' + encodeURIComponent(res.j.token); return; }
      var j = res.j;
      if (j.error === 'express_closed') { lines.forEach(fixUrgency); render(); setMsg(j.message + ' Мы поменяли срок — проверьте сумму и отправьте ещё раз.', true); }
      else if (j.error === 'price_changed') { return loadPrices().then(function (p) { P = p; render(); setMsg(j.message, true); }); }
      else if (j.error === 'bad_contacts') { showErrors(j.fields || {}); setMsg('Заполните, пожалуйста, отмеченные поля.'); }
      else setMsg(j.message || 'Не получилось отправить заказ. Проверьте данные и попробуйте ещё раз.');
    }).catch(function () {
      setMsg('Не получилось отправить заказ. Проверьте интернет и попробуйте ещё раз — всё, что вы ввели, сохранилось.');
    }).then(function () { btn.disabled = false; btn.textContent = 'Отправить заказ'; });
  });

  /* ---------- запуск ---------- */
  $('#add').addEventListener('click', function () { lines.push({ format: '10x15', paper: 'glossy', edges: 'crop', qty: '1', urgency: 'standard', note: '' }); render(); var q = box.lastChild && $('[data-k="qty"]', box.lastChild); if (q) { q.focus(); q.select(); } });
  $('#go').addEventListener('click', function (e) { if (last && !last.canOrder) e.preventDefault(); });

  // на телефоне итог закреплён внизу, но только пока на экране калькулятор — иначе он перекрывает форму
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) { document.body.classList.toggle('calc-visible', es[0].isIntersecting); }, { rootMargin: '0px 0px -30% 0px' }).observe($('#calc'));
  } else document.body.classList.add('calc-visible');

  loadPrices().then(function (p) {
    P = p; $('#minOrder').textContent = rub(P.settings.min_order);
    // цены «от … ₽» на карточках форматов — из прайса (минимальная по бумаге)
    document.querySelectorAll('.bubble[data-fmt]').forEach(function (el) { var row = P.prices[el.getAttribute('data-fmt')]; if (!row) return; var min = Math.min.apply(null, Object.keys(row).map(function (k) { return row[k]; })); el.textContent = 'от ' + rub(min); });
    render();
    // раз в минуту проверяем, не закрылся ли приём экспресса
    setInterval(function () { var changed = false; lines.forEach(function (l) { changed = fixUrgency(l) || changed; }); if (changed) render(); else calc(); }, 60000);
  }).catch(function () {
    box.innerHTML = '<div class="line"><div class="ferr" style="grid-column:1/-1">Не удалось загрузить прайс. Обновите страницу.</div></div>';
  });
})();
