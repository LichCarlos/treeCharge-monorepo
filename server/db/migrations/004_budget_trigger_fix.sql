SET search_path=charge,pg_catalog;
-- Use table-specific branches: NEW does not have the same shape for both triggers.
CREATE OR REPLACE FUNCTION validate_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p charge.budget_plans; plan_key uuid; total numeric; nulls bigint;
BEGIN
  IF TG_TABLE_NAME='budget_plans' THEN plan_key:=NEW.id; ELSE plan_key:=NEW.plan_id; END IF;
  SELECT * INTO p FROM charge.budget_plans WHERE id=plan_key;
  IF p.status='active' THEN
    SELECT sum(initial_minor),count(*) FILTER(WHERE initial_minor IS NULL) INTO total,nulls FROM charge.budget_buckets WHERE plan_id=p.id;
    IF p.base_minor IS NULL OR p.base_minor<=0 OR nulls>0 OR coalesce(total,0)>p.base_minor THEN
      RAISE EXCEPTION 'invalid active budget allocation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
