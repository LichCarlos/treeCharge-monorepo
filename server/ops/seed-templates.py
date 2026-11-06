"""Emit SQL for system template configs. No real user transactions or salary values."""
import json
import sys

def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"

with open(sys.argv[1], encoding='utf-8-sig') as stream:
    templates = json.load(stream)['templates']
print('BEGIN; SET ROLE charge_owner; SET search_path=charge,pg_catalog;')
for template in templates:
    config = json.dumps(template, ensure_ascii=False, separators=(',', ':'))
    values = [sql_literal(template['id']), str(template['version']), sql_literal(template['name']),
              sql_literal(template['ledgerType']), sql_literal(config) + '::jsonb']
    print('INSERT INTO ledger_templates(id,version,name,ledger_type,config) VALUES(' + ','.join(values)
          + ') ON CONFLICT(id,version) DO NOTHING;')
    print('DO $seed$ BEGIN IF NOT EXISTS(SELECT 1 FROM ledger_templates WHERE id='
          + values[0] + ' AND version=' + values[1] + ' AND config=' + values[4]
          + ") THEN RAISE EXCEPTION 'Template version conflict; publish a new version'; END IF; END $seed$;")
print('COMMIT;')
