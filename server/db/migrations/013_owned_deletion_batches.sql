SET search_path=charge,pg_catalog;

-- Tree descendants and entities owned through explicit business foreign keys.
-- Shared tags/fields/relations are not owners of the entities that use them.
CREATE FUNCTION owned_entity_ids(p_workspace uuid,p_root uuid) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE edges AS (
    SELECT parent_id AS owner_id,id FROM charge.tree_nodes WHERE workspace_id=p_workspace
    UNION SELECT ledger_id,id FROM charge.savings_goals WHERE workspace_id=p_workspace
    UNION SELECT category_id,id FROM charge.planned_transactions WHERE workspace_id=p_workspace
    UNION SELECT ledger_id,id FROM charge.budget_plans WHERE workspace_id=p_workspace
    UNION SELECT plan_id,id FROM charge.budget_items WHERE workspace_id=p_workspace
    UNION SELECT scope_entity_id,id FROM charge.auxiliary_tags WHERE workspace_id=p_workspace
    UNION SELECT scope_entity_id,id FROM charge.field_definitions WHERE workspace_id=p_workspace
    UNION SELECT scope_entity_id,id FROM charge.relation_definitions WHERE workspace_id=p_workspace
  ), owned AS (
    SELECT e.id FROM charge.entities e WHERE e.id=p_root AND e.workspace_id=p_workspace
    UNION SELECT edges.id FROM edges JOIN owned ON edges.owner_id=owned.id
  ) SELECT id FROM owned;
$$;
GRANT EXECUTE ON FUNCTION owned_entity_ids(uuid,uuid) TO charge_app;

CREATE TABLE deletion_batch_members (
  batch_id uuid NOT NULL REFERENCES deletion_batches(id),
  workspace_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  deleted_revision bigint NOT NULL,
  PRIMARY KEY(batch_id,entity_id),
  FOREIGN KEY(entity_id,workspace_id) REFERENCES entities(id,workspace_id)
);
CREATE INDEX deletion_members_entity ON deletion_batch_members(entity_id);
GRANT SELECT,INSERT ON deletion_batch_members TO charge_app;

-- Repair legacy deletions: deleting a savings goal now includes its ledger;
-- deleting any tree owner includes dependent goals, budgets, plans and remarks.
DO $$
DECLARE r record; owner_id uuid; batch uuid;
BEGIN
  FOR r IN SELECT * FROM entities WHERE deleted_at IS NOT NULL
    AND kind IN ('group','ledger','category','transaction','goal') ORDER BY deleted_at,id LOOP
    owner_id:=r.id;
    IF r.kind='goal' THEN SELECT ledger_id INTO owner_id FROM savings_goals WHERE id=r.id; END IF;
    IF owner_id IS NULL THEN CONTINUE; END IF;
    SELECT id INTO batch FROM deletion_batches WHERE root_id=r.id AND restored_at IS NULL ORDER BY created_at DESC LIMIT 1;
    IF batch IS NULL THEN
      INSERT INTO deletion_batches(workspace_id,root_id,snapshot) VALUES(r.workspace_id,r.id,to_jsonb(r)) RETURNING id INTO batch;
    END IF;
    WITH changed AS (
      UPDATE entities SET deleted_at=r.deleted_at
      WHERE workspace_id=r.workspace_id AND id IN (SELECT id FROM owned_entity_ids(r.workspace_id,owner_id))
        AND deleted_at IS NULL RETURNING id,workspace_id,revision
    ) INSERT INTO deletion_batch_members(batch_id,workspace_id,entity_id,deleted_revision)
      SELECT batch,workspace_id,id,revision FROM changed ON CONFLICT DO NOTHING;
    INSERT INTO deletion_batch_members(batch_id,workspace_id,entity_id,deleted_revision)
      SELECT batch,r.workspace_id,r.id,r.revision ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
