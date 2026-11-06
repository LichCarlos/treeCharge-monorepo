"""Add only Charge locations to the known existing HTTPS vhost, preserving other sites."""
from pathlib import Path
from datetime import datetime
import shutil
import subprocess

config = Path('/etc/nginx/nginx.conf')
route = Path('/etc/nginx/charge-locations.conf')
include = '        include /etc/nginx/charge-locations.conf;\n'
source = config.read_text(encoding='utf-8')
if 'server_name  lichcarlos.top www.lichcarlos.top;' not in source:
    raise RuntimeError('Expected HTTPS host missing; review Nginx configuration')
if source.count('        location /api/ {') != 1:
    raise RuntimeError('Expected a unique existing API location; review Nginx configuration')
backup = config.with_name('nginx.conf.charge-' + datetime.utcnow().strftime('%Y%m%dT%H%M%SZ') + '.bak')
shutil.copy2(str(config), str(backup))
shutil.copyfile('/opt/charge/server/ops/nginx-charge-locations.conf', str(route))
route.chmod(0o644)
if include not in source:
    config.write_text(source.replace('        location /api/ {', include + '\n        location /api/ {'), encoding='utf-8')
try:
    subprocess.check_call(['nginx', '-t'])
    subprocess.check_call(['systemctl', 'reload', 'nginx'])
except Exception:
    shutil.copy2(str(backup), str(config))
    raise
print('HTTPS route enabled; prior Nginx configuration:', str(backup))
