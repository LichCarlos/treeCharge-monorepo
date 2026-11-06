SET search_path=charge,pg_catalog;
-- SELECT FOR SHARE requires UPDATE on at least one column. Role/password/status
-- columns remain writable only through controlled functions.
GRANT UPDATE(updated_at) ON app_users TO charge_app;
