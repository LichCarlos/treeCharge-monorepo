SET search_path=charge,pg_catalog;
-- Automatic total for independent category caps; allocated templates keep their fixed base.
ALTER TABLE budget_plans ADD COLUMN management_mode text NOT NULL DEFAULT 'allocated'
  CHECK(management_mode IN ('allocated','category_caps'));
