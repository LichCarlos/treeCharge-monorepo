#!/usr/bin/env bash
set -euo pipefail
umask 077
install -d -m 700 /var/backups/charge
task_stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
task_target="/var/backups/charge/charge-$task_stamp.dump"
if [ -e "$task_target" ]; then echo 'Backup name collision' >&2; exit 1; fi
runuser -u postgres -- pg_dump -Fc -d charge > "$task_target.partial"
pg_restore --list "$task_target.partial" >/dev/null
mv "$task_target.partial" "$task_target"
sha256sum "$task_target" > "$task_target.sha256"
printf 'Backup created: %s\n' "$task_target"
