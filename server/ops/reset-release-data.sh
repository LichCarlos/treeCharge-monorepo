#!/usr/bin/env bash
set -euo pipefail
umask 077
release=${1:?Pass the release directory}
case "$release" in /opt/charge/releases/*) ;; *) echo 'Invalid release directory' >&2; exit 1;; esac
release=$(realpath -e "$release")
case "$release" in /opt/charge/releases/*) ;; *) exit 1;; esac
stamp=$(basename "$release")
[[ "$stamp" =~ ^[A-Za-z0-9._-]+$ ]] || exit 1
install -d -m 700 /var/lib/charge/release-resets
marker="/var/lib/charge/release-resets/$stamp.done"
exec 9>/var/lib/charge/release-resets/reset.lock
flock -x 9
already=$(runuser -u postgres -- psql -X -d charge -Atc "SELECT count(*) FROM charge.release_data_resets WHERE release_id='$stamp'")
if [ "$already" = 1 ]; then echo 'This release was already reset; preserving subsequent user records.'; exit 0; fi
if systemctl is-active --quiet charge-api; then echo 'Stop charge-api before resetting release data.' >&2; exit 1; fi
bash "$release/server/ops/backup-db.sh"
runuser -u postgres -- env PGOPTIONS="-c charge.release_id=$stamp" psql -X -d charge -v ON_ERROR_STOP=1 -f "$release/server/ops/reset-business-data.sql"
printf 'release=%s\nreset_at=%s\npolicy=all-business-data-accounts-retained\n' "$stamp" "$(date -u +%FT%TZ)" > "$marker"
echo 'Release business data reset complete; accounts retained.'
