SET search_path=charge,pg_catalog;
CREATE TABLE salary_income_links (
  workspace_id uuid NOT NULL, ledger_id uuid NOT NULL, month date NOT NULL,
  plan_id uuid NOT NULL UNIQUE, transaction_id uuid NOT NULL UNIQUE,
  PRIMARY KEY(workspace_id,ledger_id,month),
  FOREIGN KEY(plan_id,workspace_id,ledger_id) REFERENCES budget_plans(id,workspace_id,ledger_id) ON DELETE CASCADE,
  FOREIGN KEY(transaction_id,workspace_id) REFERENCES transactions(id,workspace_id) ON DELETE CASCADE,
  CHECK(extract(day FROM month)=1)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON salary_income_links TO charge_app;

CREATE FUNCTION validate_salary_income() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction_key uuid;
BEGIN
  IF TG_TABLE_NAME='transactions' THEN transaction_key:=NEW.id; ELSE transaction_key:=NEW.transaction_id; END IF;
  IF EXISTS(SELECT 1 FROM charge.salary_income_links s JOIN charge.transactions t ON t.id=s.transaction_id
    JOIN charge.budget_plans p ON p.id=s.plan_id
    WHERE t.id=transaction_key
    AND (t.direction<>'income' OR t.ledger_id<>s.ledger_id OR date_trunc('month',t.occurred_on)::date<>s.month OR p.month<>s.month)) THEN
    RAISE EXCEPTION 'salary income ownership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER salary_link_consistent AFTER INSERT OR UPDATE ON salary_income_links
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_salary_income();
CREATE CONSTRAINT TRIGGER salary_transaction_consistent AFTER UPDATE ON transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_salary_income();

-- A real income edit must not be blocked by planned spending. When salary drops
-- below reserved amounts, residual configuration is retained but yields no money.
CREATE OR REPLACE FUNCTION validate_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p charge.budget_plans; plan_key uuid; nulls bigint; reserved numeric; residual_bps bigint; positive_residual boolean;
BEGIN
  IF TG_TABLE_NAME='budget_plans' THEN plan_key:=NEW.id; ELSE plan_key:=NEW.plan_id; END IF;
  SELECT * INTO p FROM charge.budget_plans WHERE id=plan_key;
  IF p.status='active' THEN
    SELECT count(*) FILTER(WHERE b.initial_minor IS NULL),
      coalesce(sum(b.initial_minor) FILTER(WHERE i.mode<>'remainder'),0),
      coalesce(sum(coalesce(i.remainder_bps,0)) FILTER(WHERE i.mode='remainder'),0),
      coalesce(bool_or(i.mode='remainder' AND b.initial_minor>0),false)
      INTO nulls,reserved,residual_bps,positive_residual
      FROM charge.budget_buckets b JOIN charge.budget_items i ON i.id=b.item_id WHERE b.plan_id=p.id;
    IF p.base_minor IS NULL OR p.base_minor<=0 OR nulls>0 OR residual_bps>10000 OR (reserved>p.base_minor AND positive_residual) THEN
      RAISE EXCEPTION 'invalid active budget allocation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
