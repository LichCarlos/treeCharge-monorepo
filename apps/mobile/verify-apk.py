"""Validate the release contents and generate public integrity metadata."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[2]
version = json.loads((root / 'apps/mobile/app.json').read_text(encoding='utf-8'))['expo']['version']
apk = Path(sys.argv[1]) if len(sys.argv) > 1 else root / ('outputs/charge-' + version + '.apk')
with zipfile.ZipFile(str(apk)) as package:
    assert package.testzip() is None, 'APK ZIP integrity failed'
    bundle = package.read('assets/index.android.bundle')
    endpoint = b'https://lichcarlos.top/charge-api'
    assert endpoint in bundle, 'Production API missing from embedded bundle'
    assert not any(marker in bundle for marker in [b'isolated-ledger-ux-qa', b'ledger-ux.tsx', b'grid-ui.tsx', b'grid-fixture.mjs', b'native-remark-qa', b'native-category-qa', b'isolated-savings-qa-token', b'savings-ui.tsx', b'isolated-budget-pinned-qa-token', b'budget-ui.tsx']), 'QA entry must never be distributed'
    abis = sorted(set(n.split('/')[1] for n in package.namelist() if n.startswith('lib/') and n.endswith('.so')))
    assert abis == ['arm64-v8a', 'x86_64'], abis
    forbidden = ['credentials.json', '.env', '.keystore', '.pem', 'bootstrap-admin.credentials']
    assert not any(any(n.endswith(s) for s in forbidden) for n in package.namelist()), 'Private file in APK'
    result = {'file': apk.name, 'bytes': apk.stat().st_size, 'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'abis': abis, 'api': endpoint.decode(), 'embeddedBundle': True, 'privateFilesAbsent': True}
apk.with_suffix('.release.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
Path(str(apk) + '.sha256').write_bytes((result['sha256'] + '  ' + apk.name + '\n').encode('ascii'))
print(json.dumps(result, indent=2))
