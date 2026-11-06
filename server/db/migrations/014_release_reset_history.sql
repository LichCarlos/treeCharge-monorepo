SET search_path=charge,pg_catalog;
-- Operations-only: this survives business resets and prevents a retry from
-- deleting records created after a release, even if its filesystem marker is lost.
CREATE TABLE release_data_resets (
  release_id text PRIMARY KEY,
  reset_at timestamptz NOT NULL DEFAULT now(),
  accounts_retained bigint NOT NULL,
  policy text NOT NULL DEFAULT 'all-business-data-accounts-retained'
);
