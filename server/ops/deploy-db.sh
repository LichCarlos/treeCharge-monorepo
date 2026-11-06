#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/charge
install -d -m 700 /etc/charge /var/backups/charge
# Does not change existing PostgreSQL service, authentication rules or ports.
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE ROLE charge_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='charge_owner')\gexec
SELECT 'CREATE ROLE charge_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname='charge_app')\gexec
SELECT 'CREATE DATABASE charge OWNER charge_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS(SELECT FROM pg_database WHERE datname='charge')\gexec
REVOKE ALL ON DATABASE charge FROM PUBLIC;
GRANT CONNECT ON DATABASE charge TO charge_app;
SQL
if [ ! -f /etc/charge/database.env ]; then
  password=$(openssl rand -hex 32)
  # Secret is passed through stdin; never appears in process arguments or logs.
  printf "ALTER ROLE charge_app PASSWORD '%s';\n" "$password" | runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 >/dev/null
  printf 'PGHOST=127.0.0.1\nPGPORT=5432\nPGDATABASE=charge\nPGUSER=charge_app\nPGPASSWORD=%s\n' "$password" > /etc/charge/database.env
  unset password
fi
runuser -u postgres -- psql -X -d charge -v ON_ERROR_STOP=1 <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
for migration in server/db/migrations/*.sql; do
  version=$(basename "$migration" .sql)
  digest=$(sha256sum "$migration" | cut -d ' ' -f 1)
  exists=$(runuser -u postgres -- psql -X -d charge -Atc "SELECT to_regclass('charge.schema_migrations') IS NOT NULL")
  applied=''
  if [ "$exists" = t ]; then
    applied=$(runuser -u postgres -- psql -X -d charge -Atc "SELECT sha256 FROM charge.schema_migrations WHERE version='$version'")
  fi
  if [ -n "$applied" ]; then
    [ "$applied" = "$digest" ] || { echo "Migration checksum mismatch: $version" >&2; exit 1; }
    echo "Unchanged: $version"
    continue
  fi
  {
    printf 'BEGIN; SET ROLE charge_owner;\n'
    cat "$migration"
    printf "\nINSERT INTO charge.schema_migrations(version,sha256) VALUES('%s','%s'); COMMIT;\n" "$version" "$digest"
  } | runuser -u postgres -- psql -X -d charge -q -v ON_ERROR_STOP=1
  echo "Applied: $version"
done
# Seed immutable system template versions only; never create example transactions.
python3 server/ops/seed-templates.py src/domain/templates/default-templates.json |
  runuser -u postgres -- psql -X -d charge -q -v ON_ERROR_STOP=1
set -a
. /etc/charge/database.env
set +a
psql -X -At -v ON_ERROR_STOP=1 -c 'SELECT current_database(),current_user;' 
unset PGPASSWORD
echo 'Database ready; credentials stay in /etc/charge/database.env (0600).'
