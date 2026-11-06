-- Operations-only. Run with the API stopped and a verified full backup.
-- Deliberately list every table; never use TRUNCATE CASCADE near account tables.
BEGIN;
SET LOCAL search_path=charge,pg_catalog;
SET LOCAL lock_timeout='10s';
SELECT pg_advisory_xact_lock(724306,2);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM release_data_resets WHERE release_id=current_setting('charge.release_id',true)) THEN
    RAISE EXCEPTION 'This release has already reset business data' USING ERRCODE='23505';
  END IF;
END $$;
CREATE TEMP TABLE reset_accounts ON COMMIT DROP AS SELECT * FROM app_users;
CREATE TEMP TABLE reset_members ON COMMIT DROP AS SELECT * FROM workspace_members;
CREATE TEMP TABLE reset_roots ON COMMIT DROP AS SELECT * FROM entities WHERE kind='root';
CREATE TEMP TABLE reset_root_nodes ON COMMIT DROP AS SELECT n.* FROM tree_nodes n JOIN reset_roots r USING(id);

TRUNCATE TABLE deletion_batch_members,deletion_batches,audit_events,api_operations,
  salary_income_links,
  budget_transfers,budget_transfer_operations,budget_usage_links,budget_revisions,
  budget_category_mappings,budget_buckets,budget_items,budget_plans,
  template_entity_mappings,template_instances,relation_edges,relation_definitions,
  entity_field_option_values,entity_field_values,field_options,field_definitions,
  entity_tag_bindings,auxiliary_tags,savings_source_links,transaction_refund_links,
  planned_transactions,transaction_remarks,transactions,savings_goals,category_tags,
  ledgers,ledger_groups,tree_nodes,entities,app_settings,export_jobs;

INSERT INTO entities SELECT * FROM reset_roots;
INSERT INTO tree_nodes SELECT * FROM reset_root_nodes;
INSERT INTO app_settings(workspace_id,key,value)
  SELECT id,'bookkeeping','{"mode":"manual","defaultTemplateId":null}'::jsonb FROM workspaces;
DELETE FROM ledger_templates WHERE workspace_id IS NOT NULL;
-- Retain system presets, all accounts/passwords/roles, sessions, workspaces,
-- memberships, registration settings, and the system operations audit.
DO $$ BEGIN
  IF EXISTS((SELECT * FROM app_users EXCEPT SELECT * FROM reset_accounts)
    UNION ALL (SELECT * FROM reset_accounts EXCEPT SELECT * FROM app_users))
    OR EXISTS((SELECT * FROM workspace_members EXCEPT SELECT * FROM reset_members)
    UNION ALL (SELECT * FROM reset_members EXCEPT SELECT * FROM workspace_members)) THEN
    RAISE EXCEPTION 'Account or workspace access changed during business reset';
  END IF;
  IF EXISTS(SELECT 1 FROM entities WHERE kind<>'root') OR EXISTS(SELECT 1 FROM ledgers)
    OR EXISTS(SELECT 1 FROM transactions) OR EXISTS(SELECT 1 FROM savings_goals) THEN
    RAISE EXCEPTION 'Business reset incomplete';
  END IF;
END $$;
INSERT INTO release_data_resets(release_id,accounts_retained)
  SELECT current_setting('charge.release_id',true),count(*) FROM app_users
  HAVING nullif(current_setting('charge.release_id',true),'') IS NOT NULL;
SELECT 'business_reset_complete' AS result,(SELECT count(*) FROM charge.app_users) AS accounts_retained,
  (SELECT count(*) FROM charge.ledgers) AS ledgers,(SELECT count(*) FROM charge.savings_goals) AS goals,
  (SELECT count(*) FROM charge.transactions) AS transactions;
COMMIT;
