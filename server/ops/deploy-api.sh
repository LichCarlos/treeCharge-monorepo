#!/usr/bin/env bash
set -euo pipefail
umask 077
release=${1:?Pass an existing /opt/charge/releases/<release> directory}
case "$release" in /opt/charge/releases/*) ;; *) echo 'Invalid release directory' >&2; exit 1;; esac
[ -f "$release/package-lock.json" ] && [ -f "$release/dist/index.js" ]
install -d -m 755 /opt/charge/releases /opt/charge/downloads
cd "$release"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
was_active=false
if systemctl is-active --quiet charge-api; then was_active=true; systemctl stop charge-api; fi
trap 'if [ "$was_active" = true ]; then systemctl start charge-api; fi' EXIT
# Keep the migration script's established /opt/charge paths for upgrade compatibility.
cp -a server/db /opt/charge/server/
cp -a server/ops/. /opt/charge/server/ops/
install -d /opt/charge/src/domain/templates
cp src/domain/templates/default-templates.json /opt/charge/src/domain/templates/
bash /opt/charge/server/ops/backup-db.sh
bash /opt/charge/server/ops/deploy-db.sh
# Project owner's release policy: reset all users' business data, retain accounts.
# Reset once per release directory, never on process restart or a retry.
bash "$release/server/ops/reset-release-data.sh" "$release"
if ! id charge_api >/dev/null 2>&1; then useradd --system --home-dir /opt/charge --shell /sbin/nologin charge_api; fi
chown root:charge_api /etc/charge
chmod 750 /etc/charge
chown root:charge_api /etc/charge/database.env
chmod 640 /etc/charge/database.env
if [ ! -f /etc/charge/api.env ]; then
    printf '%s\n' 'NODE_ENV=production' 'HOST=127.0.0.1' 'PORT=3100' 'TRUST_PROXY=loopback' 'CORS_ORIGINS=https://lichcarlos.top' 'NODE_OPTIONS=--max-old-space-size=256' >/etc/charge/api.env
fi
chown root:charge_api /etc/charge/api.env
chmod 640 /etc/charge/api.env
chmod -R a+rX "$release"
ln -sfn "$release" /opt/charge/current
install -m 644 server/ops/charge-api.service /etc/systemd/system/charge-api.service
systemctl daemon-reload
systemctl enable --now charge-api
systemctl restart charge-api
trap - EXIT
for attempt in $(seq 1 20); do
    if curl --fail --silent http://127.0.0.1:3100/health; then printf '\n'; systemctl is-active charge-api; exit 0; fi
    sleep 1
done
echo 'API health check failed' >&2
journalctl -u charge-api -n 20 --no-pager
exit 1
