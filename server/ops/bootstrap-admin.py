"""Run on the project server as root. Never prints or copies the generated password."""
import base64
import hashlib
import json
from pathlib import Path
import secrets
import subprocess


def query(sql):
    result = subprocess.run(
        ['runuser', '-u', 'postgres', '--', 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', 'charge'],
        input=sql, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd='/opt/charge', check=False)
    if result.returncode:
        raise SystemExit('Administrator provisioning failed; inspect PostgreSQL logs locally (credentials not printed).')
    return result.stdout.strip()


exists = query("SELECT count(*) FROM charge.app_users WHERE system_role='super_admin' AND disabled_at IS NULL AND deleted_at IS NULL;")
if int(exists):
    print('An active system administrator already exists; no account or password changed.')
    raise SystemExit(0)

credentials_path = Path('/etc/charge/bootstrap-admin.credentials')
password = secrets.token_urlsafe(24)
salt = secrets.token_bytes(16)
derived = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=64, maxmem=64*1024*1024)
password_hash = 'scrypt$16384$8$1$' + base64.b64encode(salt).decode() + '$' + base64.b64encode(derived).decode()
# O_EXCL semantics prevent accidental overwriting of an existing credential file.
import os
descriptor = os.open(credentials_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
    json.dump({'username': 'system_admin', 'password': password, 'mustChangePassword': True}, stream)
    stream.flush()
    os.fsync(stream.fileno())

try:
    user_id = query("""BEGIN;
SELECT pg_advisory_xact_lock(724306,1);
DO $guard$ BEGIN IF EXISTS(SELECT 1 FROM charge.app_users WHERE system_role='super_admin'
AND disabled_at IS NULL AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Administrator already exists'; END IF; END $guard$;
INSERT INTO charge.app_users(username,password_hash,system_role,must_change_password)
VALUES('system_admin','""" + password_hash + """','super_admin',true) RETURNING id;
INSERT INTO charge.system_audit_events(target_user_id,action,resource_type,resource_id,reason)
SELECT id,'admin.bootstrap','user',id::text,'Initial administrator provisioned over authorized SSH'
FROM charge.app_users WHERE username='system_admin';
COMMIT;""")
except BaseException:
    # The protected credential file is kept on unknown outcomes for recovery.
    raise
print('Created system_admin; first login requires password change.')
print('Initial credentials are stored only in /etc/charge/bootstrap-admin.credentials (0600).')
