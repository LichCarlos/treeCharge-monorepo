SET search_path=charge,pg_catalog;

-- History remains append-only for the runtime role. Only the constrained owner
-- function below can remove history owned by an already deleted savings ledger.
CREATE OR REPLACE FUNCTION immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[]:=string_to_array(nullif(current_setting('charge.purge_ids',true),''),',')::uuid[];
BEGIN
  IF current_user='charge_owner' AND TG_OP='DELETE' AND ids IS NOT NULL THEN
    IF TG_TABLE_NAME IN ('budget_transfers','budget_transfer_operations','budget_revisions')
      AND (to_jsonb(OLD)->>'plan_id')::uuid=ANY(ids) THEN RETURN OLD; END IF;
    IF TG_TABLE_NAME='audit_events' AND (to_jsonb(OLD)->>'entity_id')::uuid=ANY(ids) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'append-only history' USING ERRCODE='23514';
END $$;

CREATE FUNCTION purge_deleted_savings(p_workspace uuid,p_root uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
DECLARE root entities; owner_id uuid; ids uuid[]; old_context text;
BEGIN
  PERFORM 1 FROM workspaces WHERE id=p_workspace FOR UPDATE;
  SELECT * INTO root FROM entities WHERE id=p_root AND workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND OR root.deleted_at IS NULL THEN RAISE EXCEPTION 'deleted plan required' USING ERRCODE='23514'; END IF;
  IF root.kind='goal' THEN SELECT ledger_id INTO owner_id FROM savings_goals WHERE id=p_root AND workspace_id=p_workspace;
  ELSIF root.kind='ledger' THEN owner_id:=root.id;
  END IF;
  IF owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM ledgers WHERE id=owner_id AND workspace_id=p_workspace AND ledger_type='savings') THEN
    RAISE EXCEPTION 'savings plan required' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(id) INTO ids FROM owned_entity_ids(p_workspace,owner_id);
  IF EXISTS(SELECT 1 FROM entities WHERE id=ANY(ids) AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'delete complete plan first' USING ERRCODE='23514';
  END IF;
  old_context:=current_setting('charge.purge_ids',true);
  PERFORM set_config('charge.purge_ids',array_to_string(ids,','),true);

  DELETE FROM savings_source_links WHERE workspace_id=p_workspace AND (savings_transaction_id=ANY(ids) OR source_transaction_id=ANY(ids));
  DELETE FROM transaction_refund_links WHERE workspace_id=p_workspace AND (refund_id=ANY(ids) OR original_id=ANY(ids));
  DELETE FROM budget_usage_links WHERE workspace_id=p_workspace AND (transaction_id=ANY(ids) OR plan_id=ANY(ids));
  DELETE FROM budget_transfers WHERE workspace_id=p_workspace AND plan_id=ANY(ids);
  DELETE FROM budget_transfer_operations WHERE workspace_id=p_workspace AND plan_id=ANY(ids);
  DELETE FROM budget_revisions WHERE plan_id=ANY(ids);
  DELETE FROM budget_category_mappings WHERE workspace_id=p_workspace AND (plan_id=ANY(ids) OR category_id=ANY(ids));
  DELETE FROM budget_buckets WHERE workspace_id=p_workspace AND plan_id=ANY(ids);
  DELETE FROM budget_items WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM budget_plans WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM template_entity_mappings WHERE workspace_id=p_workspace AND (entity_id=ANY(ids) OR instance_id IN (SELECT id FROM template_instances WHERE ledger_id=owner_id));
  DELETE FROM template_instances WHERE workspace_id=p_workspace AND ledger_id=owner_id;
  DELETE FROM relation_edges WHERE workspace_id=p_workspace AND (definition_id=ANY(ids) OR source_id=ANY(ids) OR target_id=ANY(ids));
  DELETE FROM entity_tag_bindings WHERE workspace_id=p_workspace AND (entity_id=ANY(ids) OR tag_id=ANY(ids));
  DELETE FROM entity_field_option_values WHERE workspace_id=p_workspace AND (entity_id=ANY(ids) OR field_id=ANY(ids));
  DELETE FROM entity_field_values WHERE workspace_id=p_workspace AND (entity_id=ANY(ids) OR field_id=ANY(ids) OR value_entity=ANY(ids));
  DELETE FROM field_options WHERE workspace_id=p_workspace AND field_id=ANY(ids);
  DELETE FROM field_definitions WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM auxiliary_tags WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM relation_definitions WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM planned_transactions WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM savings_goals WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM transaction_remarks WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM transactions WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM category_tags WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM ledgers WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM ledger_groups WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM deletion_batch_members WHERE workspace_id=p_workspace AND (entity_id=ANY(ids) OR batch_id IN (SELECT id FROM deletion_batches WHERE root_id=ANY(ids)));
  DELETE FROM deletion_batches WHERE workspace_id=p_workspace AND root_id=ANY(ids);
  DELETE FROM audit_events WHERE workspace_id=p_workspace AND entity_id=ANY(ids);
  DELETE FROM tree_nodes WHERE workspace_id=p_workspace AND id=ANY(ids);
  DELETE FROM entities WHERE workspace_id=p_workspace AND id=ANY(ids);
  PERFORM set_config('charge.purge_ids',coalesce(old_context,''),true);
  RETURN jsonb_build_object('id',p_root,'ledgerId',owner_id,'purgedCount',cardinality(ids),'permanent',true);
END $$;
REVOKE ALL ON FUNCTION purge_deleted_savings(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_deleted_savings(uuid,uuid) TO charge_app;
