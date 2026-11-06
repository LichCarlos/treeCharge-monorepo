SET search_path=charge,pg_catalog;
-- Configured categories operate independently while the plan is partially configured.
CREATE OR REPLACE FUNCTION rebuild_consumption(p_plan uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM charge.budget_usage_links WHERE plan_id=p_plan AND usage_kind='consume';
  INSERT INTO charge.budget_usage_links(workspace_id,plan_id,bucket_id,transaction_id,usage_kind,amount_minor)
  SELECT t.workspace_id,p.id,m.bucket_id,t.id,'consume',t.amount_minor FROM charge.budget_plans p
  JOIN charge.budget_category_mappings m ON m.plan_id=p.id JOIN charge.transactions t ON t.category_id=m.category_id JOIN charge.budget_buckets b ON b.id=m.bucket_id AND b.initial_minor IS NOT NULL
  WHERE p.id=p_plan AND p.status IN ('active','draft') AND t.direction='expense' AND t.ledger_id=p.ledger_id
    AND date_trunc('month',t.occurred_on)::date=p.month;
$$;

CREATE OR REPLACE FUNCTION compensate_negative(p_workspace uuid,p_plan uuid,p_operation uuid,p_target uuid,p_deductions jsonb)
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
  IF plan_status NOT IN ('active','draft') THEN RAISE EXCEPTION 'budget not active' USING ERRCODE='23514'; END IF;
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

