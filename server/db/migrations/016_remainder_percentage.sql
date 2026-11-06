SET search_path=charge,pg_catalog;
ALTER TABLE budget_items ADD COLUMN remainder_bps integer CHECK(remainder_bps BETWEEN 0 AND 10000);
-- Preserve historical proportional shares when upgrading old weight-based plans.
WITH shares AS (
  SELECT id,plan_id,10000::numeric*coalesce(remainder_weight,1)/sum(coalesce(remainder_weight,1)) OVER(PARTITION BY plan_id) portion
  FROM budget_items WHERE mode='remainder'
), ranked AS (
  SELECT id,floor(portion)::integer bps,
    row_number() OVER(PARTITION BY plan_id ORDER BY portion-floor(portion) DESC,id) rank,
    10000-sum(floor(portion)) OVER(PARTITION BY plan_id) extra FROM shares
)
UPDATE budget_items i SET remainder_bps=r.bps+CASE WHEN r.rank<=r.extra THEN 1 ELSE 0 END FROM ranked r WHERE i.id=r.id;

-- The base is a plan, so fixed and base-percentage allocations may exceed it.
-- Residual allocation is prohibited above the base and capped at 100% of its pool.
CREATE OR REPLACE FUNCTION validate_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p charge.budget_plans; plan_key uuid; nulls bigint; reserved numeric; residual_bps bigint; positive_residual boolean;
BEGIN
  IF TG_TABLE_NAME='budget_plans' THEN plan_key:=NEW.id; ELSE plan_key:=NEW.plan_id; END IF;
  SELECT * INTO p FROM charge.budget_plans WHERE id=plan_key;
  IF p.status='active' THEN
    SELECT count(*) FILTER(WHERE b.initial_minor IS NULL),
      coalesce(sum(b.initial_minor) FILTER(WHERE i.mode<>'remainder'),0),
      coalesce(sum(coalesce(i.remainder_bps,0)) FILTER(WHERE i.mode='remainder'),0),
      coalesce(bool_or(i.mode='remainder' AND (b.initial_minor>0 OR i.remainder_bps>0)),false)
      INTO nulls,reserved,residual_bps,positive_residual
      FROM charge.budget_buckets b JOIN charge.budget_items i ON i.id=b.item_id WHERE b.plan_id=p.id;
    IF p.base_minor IS NULL OR p.base_minor<=0 OR nulls>0 OR residual_bps>10000 OR (reserved>p.base_minor AND positive_residual) THEN
      RAISE EXCEPTION 'invalid active budget allocation' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER valid_budget_item AFTER INSERT OR UPDATE ON budget_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_budget();
