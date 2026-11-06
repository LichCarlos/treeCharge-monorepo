#!/usr/bin/env bash
set -euo pipefail
cd /opt/charge
task_database="charge_auth_verify_$(date -u +%Y%m%d%H%M%S)"
runuser -u postgres -- createdb -T template0 "$task_database"
printf 'Isolated account verification database: %s\n' "$task_database"
runuser -u postgres -- pg_dump -Fc -d charge |
  runuser -u postgres -- pg_restore --exit-on-error --single-transaction -d "$task_database"
runuser -u postgres -- psql -X -d "$task_database" -v ON_ERROR_STOP=1 -f server/db/tests/accounts.sql
runuser -u postgres -- dropdb "$task_database"
echo 'ACCOUNT VERIFICATION PASSED; original project database untouched.'
