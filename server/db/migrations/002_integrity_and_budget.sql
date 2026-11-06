SET search_path = charge, pg_catalog;

-- Serialize mutations within a workspace; different workspaces do not block each other.
CREATE FUNCTION lock_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM charge.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tree_nodes','entities','transactions','budget_plans','budget_buckets',
    'budget_category_mappings','budget_usage_links','relation_edges','transaction_refund_links','savings_source_links'] LOOP
    EXECUTE format('CREATE TRIGGER serialize_workspace BEFORE INSERT OR UPDATE ON charge.%I FOR EACH ROW EXECUTE FUNCTION charge.lock_workspace()',t);
  END LOOP;
END $$;

CREATE FUNCTION validate_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n record; p_kind text; a uuid; expected uuid; cycle_found boolean;
BEGIN
  -- Validate final state, permitting atomic subtree moves with deferred constraints.
  FOR n IN SELECT t.*,e.kind FROM charge.tree_nodes t JOIN charge.entities e USING(id,workspace_id)
    WHERE t.workspace_id=NEW.workspace_id LOOP
    SELECT e.kind INTO p_kind FROM charge.entities e WHERE e.id=n.parent_id;
    IF NOT ((n.kind='root' AND n.parent_id IS NULL)
      OR (n.kind IN ('group','ledger') AND p_kind IN ('root','group'))
      OR (n.kind='category' AND p_kind IN ('ledger','category'))
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
      IF p_kind='ledger' THEN a:=n.parent_id;
      ELSE SELECT ledger_id INTO a FROM charge.category_tags WHERE id=n.parent_id; END IF;
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
CREATE CONSTRAINT TRIGGER validate_tree_at_commit AFTER INSERT OR UPDATE ON tree_nodes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_tree();

CREATE FUNCTION validate_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lt text; directions text[];
BEGIN
  SELECT ledger_type INTO lt FROM charge.ledgers WHERE id=NEW.ledger_id;
  SELECT allowed_directions INTO directions FROM charge.category_tags WHERE id=NEW.category_id;
  IF (lt='expense' AND NEW.direction NOT IN ('income','expense','refund'))
    OR (lt='savings' AND NEW.direction NOT IN ('deposit','withdrawal'))
    OR (cardinality(directions)>0 AND NOT NEW.direction=ANY(directions)) THEN
    RAISE EXCEPTION 'transaction direction mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.occurred_on>(now() AT TIME ZONE (SELECT timezone FROM charge.workspaces WHERE id=NEW.workspace_id))::date THEN
    RAISE EXCEPTION 'future actual transaction; use a plan' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_transaction BEFORE INSERT OR UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION validate_transaction();

CREATE FUNCTION validate_relation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d charge.relation_definitions; sk text; tk text;
BEGIN
  SELECT * INTO d FROM charge.relation_definitions WHERE id=NEW.definition_id FOR UPDATE;
  SELECT kind INTO sk FROM charge.entities WHERE id=NEW.source_id;
  SELECT kind INTO tk FROM charge.entities WHERE id=NEW.target_id;
  IF NOT sk=ANY(d.source_kinds) OR NOT tk=ANY(d.target_kinds) THEN RAISE EXCEPTION 'relation entity type mismatch' USING ERRCODE='23514'; END IF;
  IF d.cardinality='one_to_one' AND EXISTS(SELECT 1 FROM charge.relation_edges
    WHERE definition_id=NEW.definition_id AND source_id=NEW.source_id AND target_id<>NEW.target_id) THEN
    RAISE EXCEPTION 'one-to-one cardinality violation' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relation_cardinality BEFORE INSERT OR UPDATE ON relation_edges FOR EACH ROW EXECUTE FUNCTION validate_relation();

CREATE FUNCTION immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only history' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['budget_transfer_operations','budget_transfers','budget_revisions','audit_events'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON charge.%I FOR EACH ROW EXECUTE FUNCTION charge.immutable_history()',t);
  END LOOP;
END $$;

CREATE FUNCTION validate_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p charge.budget_plans; total numeric; nulls bigint;
BEGIN
  SELECT * INTO p FROM charge.budget_plans WHERE id=CASE WHEN TG_TABLE_NAME='budget_plans' THEN NEW.id ELSE NEW.plan_id END;
  IF p.status='active' THEN
    SELECT sum(initial_minor),count(*) FILTER(WHERE initial_minor IS NULL) INTO total,nulls FROM charge.budget_buckets WHERE plan_id=p.id;
    IF p.base_minor IS NULL OR p.base_minor<=0 OR nulls>0 OR coalesce(total,0)>p.base_minor THEN
      RAISE EXCEPTION 'invalid active budget allocation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER valid_budget AFTER INSERT OR UPDATE ON budget_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_budget();
CREATE CONSTRAINT TRIGGER valid_budget AFTER INSERT OR UPDATE ON budget_buckets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_budget();

-- Rebuildable projection: explicit per-category mappings prevent parent/child double use.
-- Savings and refund links are explicitly provided by their future application services.
CREATE FUNCTION project_expense_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    DELETE FROM charge.budget_usage_links WHERE transaction_id=OLD.id AND usage_kind='consume';
  END IF;
  IF TG_OP<>'DELETE' AND NEW.direction='expense' THEN
    INSERT INTO charge.budget_usage_links(workspace_id,plan_id,bucket_id,transaction_id,usage_kind,amount_minor)
    SELECT NEW.workspace_id,p.id,m.bucket_id,NEW.id,'consume',NEW.amount_minor
    FROM charge.budget_plans p JOIN charge.budget_category_mappings m ON m.plan_id=p.id
    WHERE p.ledger_id=NEW.ledger_id AND p.status='active' AND m.category_id=NEW.category_id
      AND p.month=date_trunc('month',NEW.occurred_on)::date;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER expense_projection AFTER INSERT OR UPDATE OR DELETE ON transactions FOR EACH ROW EXECUTE FUNCTION project_expense_usage();

CREATE FUNCTION compensate_negative(p_workspace uuid,p_plan uuid,p_operation uuid,p_target uuid,p_deductions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
DECLARE request_data jsonb; previous jsonb; target_balance bigint; source_balance bigint;
  d record; total numeric; plan_status text; snapshot_data jsonb;
BEGIN
  PERFORM 1 FROM workspaces WHERE id=p_workspace FOR UPDATE;
  SELECT status INTO plan_status FROM budget_plans WHERE id=p_plan AND workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'budget plan not found' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(p_deductions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_deductions)=0 THEN
    RAISE EXCEPTION 'deductions must be a nonempty array' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_deductions) x WHERE jsonb_typeof(x)<>'object'
    OR NOT(x ? 'bucketId' AND x ? 'amountMinor') OR jsonb_typeof(x->'amountMinor')<>'number'
    OR (x->>'amountMinor')!~'^[0-9]+$') THEN RAISE EXCEPTION 'invalid deduction shape' USING ERRCODE='23514'; END IF;
  SELECT jsonb_build_object('workspace',p_workspace,'plan',p_plan,'target',p_target,'deductions',
    jsonb_agg(jsonb_build_object('bucketId',(x->>'bucketId')::uuid,'amountMinor',(x->>'amountMinor')::bigint) ORDER BY (x->>'bucketId')::uuid))
    INTO request_data FROM jsonb_array_elements(p_deductions) x;
  SELECT request INTO previous FROM budget_transfer_operations WHERE id=p_operation;
  IF FOUND THEN
    IF previous<>request_data THEN RAISE EXCEPTION 'idempotency key reused with different request' USING ERRCODE='23514'; END IF;
    RETURN jsonb_build_object('operationId',p_operation,'replayed',true);
  END IF;
  IF plan_status<>'active' THEN RAISE EXCEPTION 'budget not active' USING ERRCODE='23514'; END IF;
  SELECT available_minor INTO target_balance FROM budget_balances WHERE id=p_target AND plan_id=p_plan;
  IF target_balance IS NULL OR target_balance>=0 THEN RAISE EXCEPTION 'target is not negative' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*)<>count(DISTINCT x->>'bucketId') FROM jsonb_array_elements(p_deductions) x) THEN
    RAISE EXCEPTION 'duplicate source' USING ERRCODE='23514'; END IF;
  SELECT sum((x->>'amountMinor')::bigint) INTO total FROM jsonb_array_elements(p_deductions) x;
  IF total<=0 OR total > -target_balance THEN RAISE EXCEPTION 'deductions exceed deficit' USING ERRCODE='23514'; END IF;
  INSERT INTO budget_transfer_operations(id,workspace_id,plan_id,request,operation_kind)
    VALUES(p_operation,p_workspace,p_plan,request_data,'compensate');
  FOR d IN SELECT (x->>'bucketId')::uuid source,(x->>'amountMinor')::bigint amount FROM jsonb_array_elements(p_deductions) x LOOP
    SELECT available_minor INTO source_balance FROM budget_balances WHERE id=d.source AND plan_id=p_plan;
    IF d.source=p_target OR source_balance IS NULL OR d.amount<=0 OR d.amount>source_balance THEN
      RAISE EXCEPTION 'source unavailable or insufficient' USING ERRCODE='23514'; END IF;
    snapshot_data:=jsonb_build_object('sourceBefore',source_balance,'sourceAfter',source_balance-d.amount,
      'targetBefore',target_balance,'targetAfter',target_balance+d.amount);
    INSERT INTO budget_transfers(workspace_id,plan_id,operation_id,from_bucket_id,to_bucket_id,amount_minor,snapshot)
      VALUES(p_workspace,p_plan,p_operation,d.source,p_target,d.amount,snapshot_data);
    target_balance:=target_balance+d.amount;
  END LOOP;
  INSERT INTO audit_events(workspace_id,operation_id,action,after_value) VALUES(p_workspace,p_operation,'budget.compensate',request_data);
  RETURN jsonb_build_object('operationId',p_operation,'replayed',false,'targetAvailableMinor',target_balance);
END $$;

CREATE FUNCTION reverse_budget_transfer(p_workspace uuid,p_transfer uuid,p_operation uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
DECLARE original budget_transfers; previous jsonb; req jsonb; new_id uuid;
BEGIN
  PERFORM 1 FROM workspaces WHERE id=p_workspace FOR UPDATE;
  SELECT * INTO original FROM budget_transfers WHERE id=p_transfer AND workspace_id=p_workspace;
  IF NOT FOUND OR original.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'invalid original transfer' USING ERRCODE='23514'; END IF;
  req:=jsonb_build_object('reverse',p_transfer,'workspace',p_workspace);
  SELECT request INTO previous FROM budget_transfer_operations WHERE id=p_operation;
  IF FOUND THEN
    IF previous<>req THEN RAISE EXCEPTION 'idempotency key conflict' USING ERRCODE='23514'; END IF;
    SELECT id INTO new_id FROM budget_transfers WHERE operation_id=p_operation; RETURN new_id;
  END IF;
  IF EXISTS(SELECT 1 FROM budget_transfers WHERE reversal_of=p_transfer) THEN RAISE EXCEPTION 'already reversed' USING ERRCODE='23514'; END IF;
  INSERT INTO budget_transfer_operations(id,workspace_id,plan_id,request,operation_kind)
    VALUES(p_operation,p_workspace,original.plan_id,req,'reverse');
  INSERT INTO budget_transfers(workspace_id,plan_id,operation_id,from_bucket_id,to_bucket_id,amount_minor,reversal_of,snapshot)
    VALUES(p_workspace,original.plan_id,p_operation,original.to_bucket_id,original.from_bucket_id,original.amount_minor,p_transfer,
      jsonb_build_object('originalSnapshot',original.snapshot)) RETURNING id INTO new_id;
  INSERT INTO audit_events(workspace_id,operation_id,action,after_value) VALUES(p_workspace,p_operation,'budget.reverse',req);
  RETURN new_id;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA charge FROM PUBLIC;
