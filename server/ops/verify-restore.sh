#!/usr/bin/env bash
set -euo pipefail
cd /opt/charge
# create a fresh isolated target; never overwrite/drop an existing database.
task_database="charge_restore_verify_$(date -u +%Y%m%d%H%M%S)"
task_backup=$(ls -1t /var/backups/charge/charge-*.dump | head -n 1)
runuser -u postgres -- createdb -T template0 "$task_database"
printf 'Restore test database: %s\n' "$task_database"
runuser -u postgres -- pg_restore --exit-on-error --single-transaction -d "$task_database" < "$task_backup"
runuser -u postgres -- psql -X -d "$task_database" -At -v ON_ERROR_STOP=1 <<'SQL'
SET search_path=charge,pg_catalog;
SELECT 'tables='||count(*) FROM information_schema.tables WHERE table_schema='charge' AND table_type='BASE TABLE';
SELECT 'templates='||count(*) FROM ledger_templates;
SELECT 'transactions='||count(*) FROM transactions;
SELECT 'migrations='||count(*) FROM schema_migrations;
SQL
runuser -u postgres -- psql -X -d "$task_database" -v ON_ERROR_STOP=1 -f server/db/tests/integration.sql
# This exact database was created successfully by this invocation.
runuser -u postgres -- dropdb "$task_database"
echo 'RESTORE VERIFIED; isolated test database removed; original charge database untouched.'
