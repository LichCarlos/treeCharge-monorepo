SET search_path=charge,pg_catalog;

-- Preserve the hidden state of descendants of deleted categories before flattening.
-- IDs, financial rows, mappings, and template snapshots remain unchanged.
WITH RECURSIVE hidden AS (
  SELECT t.id,e.deleted_at FROM tree_nodes t JOIN entities e USING(id,workspace_id)
  WHERE e.kind='category' AND e.deleted_at IS NOT NULL
  UNION ALL
  SELECT child.id,h.deleted_at FROM tree_nodes child JOIN hidden h ON child.parent_id=h.id
), affected AS (
  SELECT h.id,min(h.deleted_at) deleted_at FROM hidden h
  JOIN entities e ON e.id=h.id AND e.kind='category' GROUP BY h.id
)
UPDATE entities e SET deleted_at=a.deleted_at FROM affected a
WHERE e.id=a.id AND e.deleted_at IS NULL;

-- The business hierarchy is ledger -> consumption content -> transaction.
WITH moved AS (
  UPDATE tree_nodes t SET parent_id=c.ledger_id FROM category_tags c
  WHERE t.id=c.id AND t.parent_id IS DISTINCT FROM c.ledger_id RETURNING t.id
)
UPDATE entities SET updated_at=now() WHERE id IN (SELECT id FROM moved);

CREATE OR REPLACE FUNCTION validate_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n record; p_kind text; a uuid; expected uuid; cycle_found boolean;
BEGIN
  -- Validate final state, permitting atomic subtree moves with deferred constraints.
  FOR n IN SELECT t.*,e.kind FROM charge.tree_nodes t JOIN charge.entities e USING(id,workspace_id)
    WHERE t.workspace_id=NEW.workspace_id LOOP
    SELECT e.kind INTO p_kind FROM charge.entities e WHERE e.id=n.parent_id;
    IF NOT ((n.kind='root' AND n.parent_id IS NULL)
      OR (n.kind IN ('group','ledger') AND p_kind IN ('root','group'))
      OR (n.kind='category' AND p_kind='ledger')
      OR (n.kind='transaction' AND p_kind='category') OR (n.kind='remark' AND p_kind='transaction')) IS TRUE THEN
      RAISE EXCEPTION 'illegal tree parent for %',n.id USING ERRCODE='23514';
    END IF;
    a:=n.id;
    WITH RECURSIVE ancestors AS (
      SELECT t.id,t.parent_id,ARRAY[t.id] path,false has_cycle FROM charge.tree_nodes t WHERE t.id=a
      UNION ALL SELECT t.id,t.parent_id,c.path||t.id,t.id=ANY(c.path)
      FROM charge.tree_nodes t JOIN ancestors c ON t.id=c.parent_id WHERE NOT c.has_cycle
    ) SELECT coalesce(bool_or(has_cycle),false) INTO cycle_found FROM ancestors;
    IF cycle_found THEN RAISE EXCEPTION 'tree cycle' USING ERRCODE='23514'; END IF;
    IF n.kind='category' THEN
      SELECT ledger_id INTO expected FROM charge.category_tags WHERE id=n.id;
      a:=n.parent_id;
      IF expected IS NULL OR expected IS DISTINCT FROM a THEN RAISE EXCEPTION 'category ledger mismatch' USING ERRCODE='23514'; END IF;
    ELSIF n.kind='transaction' THEN
      SELECT category_id INTO expected FROM charge.transactions WHERE id=n.id;
      IF expected IS NULL OR expected<>n.parent_id THEN RAISE EXCEPTION 'transaction parent mismatch' USING ERRCODE='23514'; END IF;
    ELSIF n.kind='remark' THEN
      SELECT transaction_id INTO expected FROM charge.transaction_remarks WHERE id=n.id;
      IF expected IS NULL OR expected<>n.parent_id THEN RAISE EXCEPTION 'remark parent mismatch' USING ERRCODE='23514'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
