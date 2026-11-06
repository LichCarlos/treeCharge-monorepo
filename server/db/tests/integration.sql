\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path=charge,pg_catalog;
-- All fixtures are rolled back. This file must not populate personal ledgers.
CREATE FUNCTION pg_temp.make_entity(w uuid,k text,p uuid DEFAULT NULL,in_tree boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e uuid:=gen_random_uuid(); BEGIN
  INSERT INTO charge.entities(id,workspace_id,kind) VALUES(e,w,k);
  IF in_tree THEN INSERT INTO charge.tree_nodes(id,workspace_id,parent_id) VALUES(e,w,p); END IF;
  RETURN e;
END $$;
SET LOCAL ROLE charge_app;
DO $$
DECLARE w uuid; root_id uuid; ledger uuid; traffic uuid; entertainment uuid; tx uuid;
  plan uuid; item1 uuid; item2 uuid; item3 uuid; bucket1 uuid; bucket2 uuid; bucket3 uuid; op uuid:=gen_random_uuid();
  transfer_id uuid; reverse_op uuid:=gen_random_uuid(); result jsonb; e uuid; f uuid; r uuid; a uuid; b uuid;
BEGIN
  INSERT INTO workspaces(name) VALUES('ROLLBACK_ONLY_INTEGRATION') RETURNING id INTO w;
  root_id:=pg_temp.make_entity(w,'root'); ledger:=pg_temp.make_entity(w,'ledger',root_id);
  INSERT INTO ledgers(id,workspace_id,name,ledger_type) VALUES(ledger,w,'Test','expense');
  traffic:=pg_temp.make_entity(w,'category',ledger); entertainment:=pg_temp.make_entity(w,'category',ledger);
  INSERT INTO category_tags(id,workspace_id,ledger_id,name) VALUES(traffic,w,ledger,'Traffic'),(entertainment,w,ledger,'Entertainment');
  plan:=pg_temp.make_entity(w,'budget_plan',NULL,false);
  INSERT INTO budget_plans(id,workspace_id,ledger_id,month,name,base_minor)
    VALUES(plan,w,ledger,date_trunc('month',current_date)::date,'Test',130000);
  item1:=pg_temp.make_entity(w,'budget_item',NULL,false); item2:=pg_temp.make_entity(w,'budget_item',NULL,false);
  INSERT INTO budget_items(id,workspace_id,plan_id,name,purpose,mode,fixed_minor) VALUES
    (item1,w,plan,'Traffic','expense_budget','fixed',80000),(item2,w,plan,'Entertainment','expense_budget','fixed',50000);
  INSERT INTO budget_buckets(workspace_id,plan_id,item_id,name,initial_minor) VALUES(w,plan,item1,'Traffic',80000) RETURNING id INTO bucket1;
  INSERT INTO budget_buckets(workspace_id,plan_id,item_id,name,initial_minor) VALUES(w,plan,item2,'Entertainment',50000) RETURNING id INTO bucket2;
  INSERT INTO budget_category_mappings VALUES(w,plan,ledger,traffic,bucket1),(w,plan,ledger,entertainment,bucket2);
  UPDATE budget_plans SET status='active' WHERE id=plan;
  tx:=pg_temp.make_entity(w,'transaction',traffic);
  INSERT INTO transactions VALUES(tx,w,ledger,traffic,'expense',90000,current_date);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (SELECT available_minor FROM budget_balances WHERE id=bucket1)<>-10000 THEN RAISE EXCEPTION 'negative balance failed'; END IF;
  RAISE NOTICE 'PASS: full actual expense and negative budget balance';
  PERFORM compensate_negative(w,plan,op,bucket1,jsonb_build_array(jsonb_build_object('bucketId',bucket2,'amountMinor',10000)));
  IF (SELECT available_minor FROM budget_balances WHERE id=bucket1)<>0
    OR (SELECT available_minor FROM budget_balances WHERE id=bucket2)<>40000
    OR (SELECT sum(available_minor) FROM budget_balances WHERE plan_id=plan)<>40000
    OR (SELECT amount_minor FROM transactions WHERE id=tx)<>90000 THEN RAISE EXCEPTION 'conservation failed'; END IF;
  RAISE NOTICE 'PASS: source decreases, target increases, actual amount and total conserved';
  result:=compensate_negative(w,plan,op,bucket1,jsonb_build_array(jsonb_build_object('bucketId',bucket2,'amountMinor',10000)));
  IF result->>'replayed'<>'true' OR (SELECT count(*) FROM budget_transfers WHERE operation_id=op)<>1 THEN RAISE EXCEPTION 'idempotency failed'; END IF;
  RAISE NOTICE 'PASS: retry does not deduct twice';
  BEGIN
    PERFORM compensate_negative(w,plan,op,bucket1,jsonb_build_array(jsonb_build_object('bucketId',bucket2,'amountMinor',9000)));
    RAISE EXCEPTION 'conflicting key accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE transactions SET amount_minor=85000 WHERE id=tx;
  IF (SELECT available_minor FROM budget_balances WHERE id=bucket1)<>5000 OR (SELECT count(*) FROM budget_transfers WHERE operation_id=op)<>1 THEN
    RAISE EXCEPTION 'edit changed transfer history'; END IF;
  RAISE NOTICE 'PASS: edit rebuilds usage and keeps transfer history';
  SELECT id INTO transfer_id FROM budget_transfers WHERE operation_id=op;
  PERFORM reverse_budget_transfer(w,transfer_id,reverse_op);
  PERFORM reverse_budget_transfer(w,transfer_id,reverse_op);
  IF (SELECT available_minor FROM budget_balances WHERE id=bucket1)<>-5000 OR (SELECT available_minor FROM budget_balances WHERE id=bucket2)<>50000 THEN
    RAISE EXCEPTION 'reversal failed'; END IF;
  BEGIN PERFORM reverse_budget_transfer(w,transfer_id,gen_random_uuid()); RAISE EXCEPTION 'double reversal accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS: append-only reversal, replay and double-reversal protection';
  BEGIN UPDATE budget_transfers SET amount_minor=1 WHERE id=transfer_id; RAISE EXCEPTION 'history mutable';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM compensate_negative(w,plan,gen_random_uuid(),bucket1,jsonb_build_array(jsonb_build_object('bucketId',bucket2,'amountMinor',5001)));
    RAISE EXCEPTION 'overcompensation accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- A nonexistent source must roll the entire operation back, including the first valid source.
  a:=gen_random_uuid();
  BEGIN
    PERFORM compensate_negative(w,plan,a,bucket1,jsonb_build_array(
      jsonb_build_object('bucketId',bucket2,'amountMinor',1000),jsonb_build_object('bucketId',gen_random_uuid(),'amountMinor',1000)));
    RAISE EXCEPTION 'invalid multi-source accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS(SELECT 1 FROM budget_transfer_operations WHERE id=a) OR (SELECT available_minor FROM budget_balances WHERE id=bucket2)<>50000 THEN
    RAISE EXCEPTION 'partial batch survived'; END IF;
  RAISE NOTICE 'PASS: invalid sources roll back complete multi-source operation';
  PERFORM compensate_negative(w,plan,gen_random_uuid(),bucket1,jsonb_build_array(jsonb_build_object('bucketId',bucket2,'amountMinor',2000)));
  IF (SELECT available_minor FROM budget_balances WHERE id=bucket1)<>-3000 THEN RAISE EXCEPTION 'partial compensation failed'; END IF;
  RAISE NOTICE 'PASS: partial compensation preserves remaining deficit';
  -- Split the source budget into two mutually exclusive buckets, preserving total allocation.
  item3:=pg_temp.make_entity(w,'budget_item',NULL,false);
  UPDATE budget_items SET fixed_minor=25000 WHERE id=item2;
  INSERT INTO budget_items(id,workspace_id,plan_id,name,purpose,mode,fixed_minor)
    VALUES(item3,w,plan,'Other source','expense_budget','fixed',25000);
  UPDATE budget_buckets SET initial_minor=25000 WHERE id=bucket2;
  INSERT INTO budget_buckets(workspace_id,plan_id,item_id,name,initial_minor)
    VALUES(w,plan,item3,'Other source',25000) RETURNING id INTO bucket3;
  PERFORM compensate_negative(w,plan,gen_random_uuid(),bucket1,jsonb_build_array(
    jsonb_build_object('bucketId',bucket2,'amountMinor',1500),jsonb_build_object('bucketId',bucket3,'amountMinor',1500)));
  IF (SELECT available_minor FROM budget_balances WHERE id=bucket1)<>0
    OR (SELECT available_minor FROM budget_balances WHERE id=bucket2)<>21500
    OR (SELECT available_minor FROM budget_balances WHERE id=bucket3)<>23500
    OR (SELECT sum(available_minor) FROM budget_balances WHERE plan_id=plan)<>45000 THEN
    RAISE EXCEPTION 'valid multi-source transfer failed'; END IF;
  RAISE NOTICE 'PASS: valid multi-source deductions conserve total and update every source';
  UPDATE entities SET deleted_at=now() WHERE id=traffic;
  IF EXISTS(SELECT 1 FROM visible_tree_nodes WHERE id=tx) OR (SELECT used_minor FROM budget_balances WHERE id=bucket1)<>0 THEN
    RAISE EXCEPTION 'deleted ancestor still counted'; END IF;
  UPDATE entities SET deleted_at=NULL WHERE id=traffic;
  IF (SELECT used_minor FROM budget_balances WHERE id=bucket1)<>85000 THEN RAISE EXCEPTION 'restore failed'; END IF;
  RAISE NOTICE 'PASS: ancestor delete and restore affect usage without deleting history';
  BEGIN
    UPDATE tree_nodes SET parent_id=traffic WHERE id=ledger;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'invalid tree accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    e:=pg_temp.make_entity(w,'transaction',traffic);
    INSERT INTO transactions VALUES(e,w,ledger,traffic,'deposit',1,current_date);
    RAISE EXCEPTION 'direction accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS: tree and ledger direction constraints';
  r:=pg_temp.make_entity(w,'remark',tx); INSERT INTO transaction_remarks VALUES(r,w,tx,'One optional remark');
  BEGIN
    e:=pg_temp.make_entity(w,'remark',tx); INSERT INTO transaction_remarks VALUES(e,w,tx,'Duplicate');
    RAISE EXCEPTION 'second remark accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE 'PASS: optional one-to-one remark';
  f:=pg_temp.make_entity(w,'field',NULL,false);
  INSERT INTO field_definitions(id,workspace_id,name,field_type,applicable_kinds) VALUES(f,w,'Amount','integer',ARRAY['transaction']);
  INSERT INTO entity_field_values(workspace_id,entity_id,field_id,value_integer) VALUES(w,tx,f,42);
  BEGIN
    UPDATE entity_field_values SET value_integer=NULL,value_text='wrong' WHERE entity_id=tx AND field_id=f;
    RAISE EXCEPTION 'wrong field type accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS: typed custom fields';
  f:=pg_temp.make_entity(w,'relation',NULL,false);
  INSERT INTO relation_definitions(id,workspace_id,name,cardinality,source_kinds,target_kinds)
    VALUES(f,w,'One category','one_to_one',ARRAY['transaction'],ARRAY['category']);
  INSERT INTO relation_edges VALUES(w,f,tx,traffic);
  BEGIN INSERT INTO relation_edges VALUES(w,f,tx,entertainment); RAISE EXCEPTION 'one-to-one violated';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE NOTICE 'PASS: relationship cardinality';
  IF (SELECT count(*) FROM ledger_templates WHERE workspace_id IS NULL)<>5 THEN RAISE EXCEPTION 'template seed missing'; END IF;
  IF EXISTS(SELECT 1 FROM ledger_templates,jsonb_array_elements(config->'rows') row
    WHERE id='salary-allocation' AND row->>'fixedMinor' IS NOT NULL) THEN RAISE EXCEPTION 'salary example amounts imported'; END IF;
  RAISE NOTICE 'PASS: five templates; salary reference amounts absent';
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'ALL DATABASE TESTS PASSED; FIXTURES ROLLED BACK' AS result;
