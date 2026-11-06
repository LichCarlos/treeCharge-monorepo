SET search_path=charge,pg_catalog;

CREATE FUNCTION preserve_entity_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.workspace_id,NEW.kind) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.kind) THEN
    RAISE EXCEPTION 'entity identity and type are immutable' USING ERRCODE='23514'; END IF;
  NEW.revision:=OLD.revision+1; NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER entity_identity BEFORE UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION preserve_entity_identity();
CREATE FUNCTION check_entity_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM charge.entities WHERE id=NEW.id AND workspace_id=NEW.workspace_id AND kind=TG_ARGV[0]) THEN
    RAISE EXCEPTION 'entity subtype mismatch for %',TG_TABLE_NAME USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE pair text[]; BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['ledger_groups','group'],['ledgers','ledger'],['category_tags','category'],['transactions','transaction'],
    ['transaction_remarks','remark'],['savings_goals','goal'],['planned_transactions','plan'],['auxiliary_tags','tag'],
    ['field_definitions','field'],['relation_definitions','relation'],['budget_plans','budget_plan'],['budget_items','budget_item']
  ] LOOP
    EXECUTE format('CREATE TRIGGER entity_kind BEFORE INSERT OR UPDATE ON charge.%I FOR EACH ROW EXECUTE FUNCTION charge.check_entity_kind(%L)',pair[1],pair[2]);
  END LOOP;
END $$;

CREATE FUNCTION check_field_value() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d charge.field_definitions; ek text;
BEGIN
  SELECT * INTO d FROM charge.field_definitions WHERE id=NEW.field_id FOR SHARE;
  SELECT kind INTO ek FROM charge.entities WHERE id=NEW.entity_id;
  IF NOT ek=ANY(d.applicable_kinds) THEN RAISE EXCEPTION 'field not applicable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='entity_field_option_values' THEN
    IF d.field_type NOT IN ('single_select','multi_select') THEN RAISE EXCEPTION 'not an option field' USING ERRCODE='23514'; END IF;
    -- Workspace lock prevents two concurrent single-select inserts.
    PERFORM 1 FROM charge.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
    IF d.field_type='single_select' AND EXISTS(SELECT 1 FROM charge.entity_field_option_values
      WHERE entity_id=NEW.entity_id AND field_id=NEW.field_id AND option_id<>NEW.option_id) THEN
      RAISE EXCEPTION 'single select has multiple values' USING ERRCODE='23514'; END IF;
  ELSE
    IF (CASE d.field_type
      WHEN 'text' THEN NEW.value_text IS NOT NULL
      WHEN 'integer' THEN NEW.value_integer IS NOT NULL
      WHEN 'money' THEN NEW.value_integer BETWEEN 0 AND 99999999999
      WHEN 'decimal' THEN NEW.value_decimal IS NOT NULL
      WHEN 'date' THEN NEW.value_date IS NOT NULL
      WHEN 'boolean' THEN NEW.value_boolean IS NOT NULL
      WHEN 'entity' THEN NEW.value_entity IS NOT NULL ELSE false END) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'field value type mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER typed_value BEFORE INSERT OR UPDATE ON entity_field_values FOR EACH ROW EXECUTE FUNCTION check_field_value();
CREATE TRIGGER typed_option BEFORE INSERT OR UPDATE ON entity_field_option_values FOR EACH ROW EXECUTE FUNCTION check_field_value();

CREATE FUNCTION validate_financial_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w uuid:=NEW.workspace_id;
BEGIN
  IF EXISTS(SELECT 1 FROM charge.transactions t JOIN charge.visible_tree_nodes v ON v.id=t.id
    WHERE t.workspace_id=w AND t.direction='refund' AND NOT EXISTS(SELECT 1 FROM charge.transaction_refund_links r WHERE r.refund_id=t.id)) THEN
    RAISE EXCEPTION 'refund requires original expense' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM charge.transaction_refund_links r
    JOIN charge.transactions f ON f.id=r.refund_id JOIN charge.transactions o ON o.id=r.original_id
    WHERE r.workspace_id=w AND (f.direction<>'refund' OR o.direction<>'expense' OR f.ledger_id<>o.ledger_id
      OR f.occurred_on<o.occurred_on OR NOT EXISTS(SELECT 1 FROM charge.visible_tree_nodes WHERE id=o.id))) THEN
    RAISE EXCEPTION 'refund original invalid' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT r.original_id FROM charge.transaction_refund_links r JOIN charge.transactions f ON f.id=r.refund_id
    JOIN charge.visible_tree_nodes v ON v.id=f.id JOIN charge.transactions o ON o.id=r.original_id
    WHERE r.workspace_id=w GROUP BY r.original_id,o.amount_minor HAVING sum(f.amount_minor)>o.amount_minor) THEN
    RAISE EXCEPTION 'refund exceeds original' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT t.ledger_id FROM charge.transactions t JOIN charge.visible_tree_nodes v ON v.id=t.id
    WHERE t.workspace_id=w AND t.direction IN ('deposit','withdrawal') GROUP BY t.ledger_id
    HAVING sum(CASE WHEN t.direction='deposit' THEN t.amount_minor ELSE -t.amount_minor END)<0) THEN
    RAISE EXCEPTION 'savings balance negative' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM charge.savings_source_links l JOIN charge.transactions s ON s.id=l.savings_transaction_id
    JOIN charge.transactions o ON o.id=l.source_transaction_id WHERE l.workspace_id=w
    AND (s.direction<>'deposit' OR o.direction<>'income')) THEN RAISE EXCEPTION 'invalid savings source direction' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT l.source_transaction_id FROM charge.savings_source_links l JOIN charge.transactions t ON t.id=l.source_transaction_id
    WHERE l.workspace_id=w GROUP BY l.source_transaction_id,t.amount_minor HAVING sum(l.amount_minor)>t.amount_minor)
    OR EXISTS(SELECT l.savings_transaction_id FROM charge.savings_source_links l JOIN charge.transactions t ON t.id=l.savings_transaction_id
    WHERE l.workspace_id=w GROUP BY l.savings_transaction_id,t.amount_minor HAVING sum(l.amount_minor)>t.amount_minor) THEN
    RAISE EXCEPTION 'savings source overallocated' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['transactions','entities','transaction_refund_links','savings_source_links'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER financial_links AFTER INSERT OR UPDATE ON charge.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION charge.validate_financial_links()',t);
  END LOOP;
END $$;

CREATE FUNCTION rebuild_consumption(p_plan uuid) RETURNS void LANGUAGE sql AS $$
  DELETE FROM charge.budget_usage_links WHERE plan_id=p_plan AND usage_kind='consume';
  INSERT INTO charge.budget_usage_links(workspace_id,plan_id,bucket_id,transaction_id,usage_kind,amount_minor)
  SELECT t.workspace_id,p.id,m.bucket_id,t.id,'consume',t.amount_minor FROM charge.budget_plans p
  JOIN charge.budget_category_mappings m ON m.plan_id=p.id JOIN charge.transactions t ON t.category_id=m.category_id
  WHERE p.id=p_plan AND p.status='active' AND t.direction='expense' AND t.ledger_id=p.ledger_id
    AND date_trunc('month',t.occurred_on)::date=p.month;
$$;
CREATE FUNCTION refresh_plan_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='budget_plans' THEN PERFORM charge.rebuild_consumption(NEW.id);
  ELSIF TG_OP='DELETE' THEN PERFORM charge.rebuild_consumption(OLD.plan_id);
  ELSE PERFORM charge.rebuild_consumption(NEW.plan_id);
    IF TG_OP='UPDATE' AND OLD.plan_id<>NEW.plan_id THEN PERFORM charge.rebuild_consumption(OLD.plan_id); END IF;
  END IF; RETURN NULL;
END $$;
CREATE TRIGGER budget_projection AFTER INSERT OR UPDATE ON budget_plans FOR EACH ROW EXECUTE FUNCTION refresh_plan_consumption();
CREATE TRIGGER mapping_projection AFTER INSERT OR UPDATE OR DELETE ON budget_category_mappings FOR EACH ROW EXECUTE FUNCTION refresh_plan_consumption();

-- Runtime API role cannot overwrite committed transfers, audits, revisions or system presets.
GRANT USAGE ON SCHEMA charge TO charge_app;
GRANT SELECT ON ALL TABLES IN SCHEMA charge TO charge_app;
GRANT INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA charge TO charge_app;
REVOKE ALL ON schema_migrations FROM charge_app;
REVOKE INSERT,UPDATE,DELETE ON ledger_templates,budget_transfer_operations,budget_transfers FROM charge_app;
REVOKE UPDATE,DELETE ON audit_events,budget_revisions FROM charge_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA charge TO charge_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA charge FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compensate_negative(uuid,uuid,uuid,uuid,jsonb),reverse_budget_transfer(uuid,uuid,uuid),
  rebuild_consumption(uuid) TO charge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA charge REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
