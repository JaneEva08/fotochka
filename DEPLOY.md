# Фоточка — выкладка на сервер и настройка ВКонтакте

Инструкция для сервера на Ubuntu/Debian. Везде замените `foto.example.ru` на свой поддомен.
Время: ~30–40 минут. ⚠️ Ключ ВК и пароль от `/admin` вводите **только на сервере** — не присылайте их в чаты и не показывайте на скриншотах (это отдельный критерий проверки проекта).

---

## Шаг 1. Поддомен
В панели, где куплен домен (DNS), добавьте запись:

| Тип | Имя | Значение |
|---|---|---|
| A | `foto` | IP вашего VPS |

Обновляется от 5 минут до пары часов. Проверка с компьютера: `ping foto.example.ru` — должен показать IP сервера.

## Шаг 2. Программы на сервере
Подключитесь к серверу (`ssh root@IP`) и выполните:
```bash
# Node.js 22 (сайту нужен именно 22-й или новее)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx certbot python3-certbot-nginx
node -v        # должно быть v22.13 или выше
```
Если nginx уже стоит (например, для ботов) — ничего страшного, просто добавим ещё один сайт.

## Шаг 3. Загрузить сайт
На **своём компьютере**, в папке, где лежит архив `fotochka-site.zip`:
```bash
scp fotochka-site.zip root@IP:/tmp/
```
На **сервере**:
```bash
apt-get install -y unzip
useradd --system --home /opt/fotochka --shell /usr/sbin/nologin fotochka
mkdir -p /opt/fotochka && unzip -o /tmp/fotochka-site.zip -d /opt/fotochka
mkdir -p /opt/fotochka/data
cp /opt/fotochka/.env.example /opt/fotochka/.env
chown -R fotochka:fotochka /opt/fotochka
chmod 600 /opt/fotochka/.env
```

## Шаг 4. Настройки (.env)
```bash
nano /opt/fotochka/.env
```
Заполните:
- `SITE_URL=https://foto.example.ru`
- `ADMIN_PASS=` — придумайте длинный пароль для страницы заказов `/admin` (логин — `manager`)
- `VK_TOKEN` и `VK_PEER_ID` — пока оставьте пустыми, заполним в шаге 8.

Сохранить: `Ctrl+O`, `Enter`, выйти: `Ctrl+X`.

## Шаг 5. Запуск как службы (сам перезапустится после сбоя и перезагрузки)
```bash
cp /opt/fotochka/deploy/fotochka.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fotochka
systemctl status fotochka --no-pager      # должно быть active (running)
curl -s http://127.0.0.1:3047/api/health  # должно ответить {"ok":true}
```
Если порт 3047 уже занят — поменяйте `PORT` в `.env` и в `deploy/nginx-fotochka.conf`.

## Шаг 6. nginx и HTTPS
```bash
cp /opt/fotochka/deploy/nginx-fotochka.conf /etc/nginx/sites-available/fotochka
nano /etc/nginx/sites-available/fotochka        # замените foto.example.ru на свой поддомен
ln -s /etc/nginx/sites-available/fotochka /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d foto.example.ru              # ответьте на вопросы, выберите редирект на HTTPS
```

## Шаг 7. Проверка
1. Откройте `https://foto.example.ru` **в режиме инкогнито** (требование ТЗ).
2. Откройте с телефона **через мобильный интернет без VPN** — так проверяем, что сайт доступен из России. Если не открывается — переносим на московский VPS (план «Б» в журнале решений).
3. Оформите тестовый заказ с вымышленными данными («Иван Тестов», +7 900 000-00-00).
4. Откройте `https://foto.example.ru/admin` → логин `manager`, ваш пароль → заказ в списке. Это аналог вкладки «Ответы» Яндекс Формы.

## Шаг 8. Уведомления менеджеру во ВКонтакте
**В сообществе** (Управление):
1. **Сообщения** → включить «Сообщения сообщества».
2. **Настройки → Работа с API → Ключи доступа → Создать ключ** → отметить «Сообщения сообщества» → создать → подтвердить. Скопируйте ключ (длинная строка) — **сразу в `.env` на сервере**, никуда больше.

**С аккаунта менеджера** (ваш личный):
3. Зайдите в сообщество и нажмите «Написать сообщение» → отправьте любое («Привет»). Без этого ВК запрещает сообществу писать первым.
4. Узнайте свой числовой ID: Настройки → «Адрес страницы» — если там `id123456789`, ID = `123456789`. Если адрес «красивый», нажмите «Изменить» — под полем ВК покажет номер страницы.

**На сервере:**
```bash
nano /opt/fotochka/.env      # VK_TOKEN=ключ   VK_PEER_ID=ваш ID
systemctl restart fotochka
```
5. Оформите ещё один тестовый заказ — в сообщениях от сообщества придёт уведомление. В `/admin` в колонке «ВК» — «отправлено». Если «ошибка» — посмотрите причину: `journalctl -u fotochka -n 50 --no-pager`.

## Шаг 9 (по желанию). Резервная копия заказов раз в сутки
```bash
mkdir -p /root/backups
( crontab -l 2>/dev/null; echo '30 3 * * * cp /opt/fotochka/data/orders.sqlite /root/backups/orders-$(date +\%F).sqlite' ) | crontab -
```

---

## Как обновить прайс
1. Поправьте жёлтые ячейки в `prais_fotopechat.xlsx`.
2. На своём компьютере: `python3 tools/xlsx_to_json.py prais_fotopechat.xlsx` → получится `public/prices.json` (скрипт сам проверит ошибки в прайсе).
3. `scp public/prices.json root@IP:/opt/fotochka/public/` — сайт и сервер подхватят новые цены без перезапуска.

## Перенос на сервер клиента в РФ (боевой запуск)
Те же шаги 2–8 на российском VPS + перенести `data/orders.sqlite`. После переноса пункт политики «данные хранятся в РФ» соответствует действительности. Заполнить реквизиты в документах (поиск по `[` в `public/privacy.html`, `oferta.html`, `soglasie.html`).

## Полезные команды
```bash
systemctl status fotochka          # работает ли
journalctl -u fotochka -f          # журнал в реальном времени
systemctl restart fotochka         # перезапуск после изменения .env
```
