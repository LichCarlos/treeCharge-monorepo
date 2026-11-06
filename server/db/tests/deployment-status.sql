\set ON_ERROR_STOP on
SET search_path=charge,pg_catalog;
SELECT 'tables='||count(*) FROM information_schema.tables WHERE table_schema='charge' AND table_type='BASE TABLE';
SELECT 'migrations='||count(*) FROM schema_migrations;
SELECT 'templates='||count(*) FROM ledger_templates;
SELECT 'workspaces='||count(*) FROM workspaces;
SELECT 'actual_transactions='||count(*) FROM transactions;
SELECT 'ordinary_users='||count(*) FROM app_users WHERE system_role='user';
SELECT 'active_super_admins='||count(*) FROM app_users WHERE system_role='super_admin' AND disabled_at IS NULL AND deleted_at IS NULL;
SELECT 'admin_requires_password_change='||must_change_password FROM app_users WHERE username='system_admin';
