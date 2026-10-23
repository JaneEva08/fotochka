#!/usr/bin/env bash
# Разовая настройка автодеплоя на VPS. Запускать от root из папки deploy/server:
#
#   bash setup-autodeploy.sh <IP-или-домен-сервера> "<публичный ключ GitHub Actions>"
#
# Что делает (повторный запуск безопасен):
#   - ставит rsync и curl;
#   - создаёт пользователя deploy без пароля;
#   - кладёт скрипты выкладки в /usr/local/bin;
#   - разрешает deploy через sudo ровно одну команду — скрипт выкладки;
#   - пускает ключ GitHub Actions только на эту команду (без shell, без туннелей);
#   - сохраняет текущую версию сайта как initial, чтобы было куда откатиться;
#   - печатает строку для секрета DEPLOY_KNOWN_HOSTS.
set -Eeuo pipefail

APP_DIR=/opt/fotochka
REL_DIR=/opt/fotochka-releases
APP_USER=fotochka
SERVICE=fotochka
DEPLOY_USER=deploy
HERE=$(cd "$(dirname "$0")" && pwd)

die() { echo "ОШИБКА: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

[[ $(id -u) -eq 0 ]] || die "запустите от root"
HOST=${1:-}
PUBKEY=${2:-}
[[ -n $HOST ]] || die "первым аргументом укажите IP или домен сервера"
[[ $PUBKEY =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] \
  || die "вторым аргументом вставьте публичный ключ целиком, в кавычках: \"ssh-ed25519 AAAA... github-actions\""
[[ -d $APP_DIR ]] || die "нет $APP_DIR — сначала разверните сайт по DEPLOY.md"
id "$APP_USER" >/dev/null 2>&1 || die "нет пользователя $APP_USER — сайт ставили не по DEPLOY.md?"
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "нет службы $SERVICE"
for f in fotochka-deploy fotochka-deploy-wrap; do
  [[ -f $HERE/$f ]] || die "рядом со скриптом нет файла $f"
done

step "Пакеты"
command -v rsync >/dev/null && command -v curl >/dev/null \
  || { apt-get update -qq && apt-get install -y -qq rsync curl; }
command -v npm >/dev/null || die "на сервере нет npm (Node.js ставили в шаге 2 DEPLOY.md)"

step "Пользователь $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/sh "$DEPLOY_USER"
fi
passwd -l "$DEPLOY_USER" >/dev/null   # вход по паролю невозможен

step "Скрипты выкладки"
install -m 755 -o root -g root "$HERE/fotochka-deploy" /usr/local/bin/fotochka-deploy
install -m 755 -o root -g root "$HERE/fotochka-deploy-wrap" /usr/local/bin/fotochka-deploy-wrap

step "Права sudo: только скрипт выкладки"
SUDOERS=/etc/sudoers.d/fotochka-deploy
tmp=$(mktemp)
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/bin/fotochka-deploy" >"$tmp"
visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "sudoers не прошёл проверку"; }
install -m 440 -o root -g root "$tmp" "$SUDOERS"
rm -f "$tmp"

step "Ключ GitHub Actions"
HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
echo "restrict,command=\"/usr/local/bin/fotochka-deploy-wrap\" $PUBKEY" >"$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

# Если в sshd ограничен список пользователей — deploy туда не попадёт.
if sshd -T 2>/dev/null | grep -qiE '^allowusers '; then
  echo "ВНИМАНИЕ: в настройках SSH задан AllowUsers:"
  sshd -T | grep -iE '^allowusers '
  echo "Добавьте туда $DEPLOY_USER и перезапустите ssh, иначе GitHub не сможет подключиться."
fi

step "Снимок текущей версии (initial) для отката"
install -d -m 755 "$REL_DIR"
if [[ ! -d $REL_DIR/initial ]]; then
  rsync -a --exclude=/.env --exclude=/data/ --exclude=/.npm/ "$APP_DIR"/ "$REL_DIR/initial"/
  echo "сохранено в $REL_DIR/initial"
else
  echo "уже есть, не трогаю"
fi
[[ -f $REL_DIR/CURRENT ]] || echo initial >"$REL_DIR/CURRENT"

step "Самопроверка"
if SSH_ORIGINAL_COMMAND="ls /" runuser -u "$DEPLOY_USER" -- /usr/local/bin/fotochka-deploy-wrap 2>/dev/null; then
  die "обёртка пропустила постороннюю команду — что-то не так"
fi
echo "посторонние команды ключ не выполнит — ок"
runuser -u "$DEPLOY_USER" -- sudo -n -l /usr/local/bin/fotochka-deploy >/dev/null \
  || die "deploy не может запустить скрипт выкладки через sudo"
echo "sudo для скрипта выкладки — ок"

step "Готово. Строка для секрета DEPLOY_KNOWN_HOSTS:"
[[ -f /etc/ssh/ssh_host_ed25519_key.pub ]] || die "нет /etc/ssh/ssh_host_ed25519_key.pub"
echo "$HOST $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
echo
echo "Отпечаток ключа сервера (должен совпасть с тем, что ssh показывал при первом входе):"
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
