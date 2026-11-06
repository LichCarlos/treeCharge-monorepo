-- PostgreSQL 13+. Applied by the deployment runner in a single transaction.
CREATE SCHEMA IF NOT EXISTS charge AUTHORIZATION charge_owner;
SET search_path = charge, pg_catalog;

CREATE DOMAIN money_minor AS bigint CHECK (VALUE BETWEEN 0 AND 99999999999);
CREATE TABLE schema_migrations (
  version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (btrim(name) <> ''),
  timezone text NOT NULL DEFAULT 'Asia/Shanghai', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL CHECK (kind IN ('root','group','ledger','category','transaction','remark',
    'tag','field','relation','plan','goal','budget_plan','budget_item','template')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (id, workspace_id)
);
CREATE TABLE tree_nodes (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, parent_id uuid, position bigint NOT NULL DEFAULT 0,
  FOREIGN KEY (id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY (parent_id,workspace_id) REFERENCES tree_nodes(id,workspace_id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (id,workspace_id), CHECK (id IS DISTINCT FROM parent_id)
);
CREATE UNIQUE INDEX one_root_per_workspace ON tree_nodes(workspace_id) WHERE parent_id IS NULL;
CREATE INDEX tree_parent_position ON tree_nodes(workspace_id,parent_id,position,id);
CREATE TABLE ledger_groups (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, name text NOT NULL CHECK (btrim(name) <> ''), description text,
  FOREIGN KEY (id,workspace_id) REFERENCES tree_nodes(id,workspace_id)
);
CREATE TABLE ledgers (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, name text NOT NULL CHECK (btrim(name) <> ''),
  ledger_type text NOT NULL CHECK (ledger_type IN ('expense','savings')), currency text NOT NULL DEFAULT 'CNY' CHECK (currency='CNY'),
  archived_at timestamptz, UNIQUE (id,workspace_id),
  FOREIGN KEY (id,workspace_id) REFERENCES tree_nodes(id,workspace_id)
);
CREATE TABLE category_tags (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, ledger_id uuid NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''), allowed_directions text[] NOT NULL DEFAULT '{}', archived_at timestamptz,
  UNIQUE (id,workspace_id,ledger_id),
  FOREIGN KEY (id,workspace_id) REFERENCES tree_nodes(id,workspace_id),
  FOREIGN KEY (ledger_id,workspace_id) REFERENCES ledgers(id,workspace_id),
  CHECK (allowed_directions <@ ARRAY['income','expense','deposit','withdrawal','refund']::text[])
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, ledger_id uuid NOT NULL, category_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income','expense','deposit','withdrawal','refund')),
  amount_minor money_minor NOT NULL CHECK (amount_minor > 0), occurred_on date NOT NULL,
  UNIQUE (id,workspace_id), UNIQUE (id,workspace_id,ledger_id),
  FOREIGN KEY (id,workspace_id) REFERENCES tree_nodes(id,workspace_id),
  FOREIGN KEY (ledger_id,workspace_id) REFERENCES ledgers(id,workspace_id),
  FOREIGN KEY (category_id,workspace_id,ledger_id) REFERENCES category_tags(id,workspace_id,ledger_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX transactions_ledger_date ON transactions(workspace_id,ledger_id,occurred_on DESC,id);
CREATE INDEX transactions_category_date ON transactions(category_id,occurred_on DESC,id);
CREATE TABLE transaction_remarks (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, transaction_id uuid NOT NULL UNIQUE, body text NOT NULL,
  FOREIGN KEY (id,workspace_id) REFERENCES tree_nodes(id,workspace_id),
  FOREIGN KEY (transaction_id,workspace_id) REFERENCES transactions(id,workspace_id)
);
CREATE TABLE savings_goals (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, ledger_id uuid NOT NULL UNIQUE,
  name text NOT NULL, target_minor money_minor NOT NULL CHECK (target_minor > 0), deadline date,
  FOREIGN KEY (id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY (ledger_id,workspace_id) REFERENCES ledgers(id,workspace_id)
);
CREATE TABLE savings_source_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  savings_transaction_id uuid NOT NULL, source_transaction_id uuid NOT NULL, amount_minor money_minor NOT NULL CHECK (amount_minor>0),
  FOREIGN KEY (savings_transaction_id,workspace_id) REFERENCES transactions(id,workspace_id),
  FOREIGN KEY (source_transaction_id,workspace_id) REFERENCES transactions(id,workspace_id),
  UNIQUE (savings_transaction_id,source_transaction_id), CHECK (savings_transaction_id<>source_transaction_id)
);
CREATE TABLE planned_transactions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, ledger_id uuid NOT NULL, category_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income','expense','deposit','withdrawal')),
  amount_minor money_minor NOT NULL CHECK (amount_minor>0), planned_on date NOT NULL, remark text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  actual_transaction_id uuid UNIQUE,
  FOREIGN KEY (id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY (category_id,workspace_id,ledger_id) REFERENCES category_tags(id,workspace_id,ledger_id),
  FOREIGN KEY (actual_transaction_id,workspace_id,ledger_id) REFERENCES transactions(id,workspace_id,ledger_id),
  CHECK ((status='confirmed')=(actual_transaction_id IS NOT NULL))
);
CREATE TABLE auxiliary_tags (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, name text NOT NULL CHECK (btrim(name)<>''),
  scope_entity_id uuid, applicable_kinds text[] NOT NULL, archived_at timestamptz,
  UNIQUE (id,workspace_id), FOREIGN KEY (id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY (scope_entity_id,workspace_id) REFERENCES entities(id,workspace_id)
);
CREATE TABLE entity_tag_bindings (
  workspace_id uuid NOT NULL, entity_id uuid NOT NULL, tag_id uuid NOT NULL, PRIMARY KEY(entity_id,tag_id),
  FOREIGN KEY (entity_id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY (tag_id,workspace_id) REFERENCES auxiliary_tags(id,workspace_id)
);
CREATE INDEX tag_reverse ON entity_tag_bindings(tag_id,entity_id);
CREATE TABLE field_definitions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, name text NOT NULL, scope_entity_id uuid,
  field_type text NOT NULL CHECK (field_type IN ('text','integer','decimal','money','date','boolean','single_select','multi_select','entity')),
  applicable_kinds text[] NOT NULL, required boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}', position integer NOT NULL DEFAULT 0, archived_at timestamptz,
  UNIQUE(id,workspace_id), FOREIGN KEY (id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY (scope_entity_id,workspace_id) REFERENCES entities(id,workspace_id), CHECK(jsonb_typeof(config)='object')
);
CREATE TABLE field_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, field_id uuid NOT NULL,
  name text NOT NULL, position integer NOT NULL DEFAULT 0, archived_at timestamptz,
  UNIQUE(id,field_id,workspace_id), FOREIGN KEY(field_id,workspace_id) REFERENCES field_definitions(id,workspace_id)
);
CREATE TABLE entity_field_values (
  workspace_id uuid NOT NULL, entity_id uuid NOT NULL, field_id uuid NOT NULL,
  value_text text, value_integer bigint, value_decimal numeric(28,8), value_date date, value_boolean boolean, value_entity uuid,
  PRIMARY KEY(entity_id,field_id),
  FOREIGN KEY(entity_id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY(field_id,workspace_id) REFERENCES field_definitions(id,workspace_id),
  FOREIGN KEY(value_entity,workspace_id) REFERENCES entities(id,workspace_id),
  CHECK(num_nonnulls(value_text,value_integer,value_decimal,value_date,value_boolean,value_entity)=1)
);
CREATE INDEX field_text_lookup ON entity_field_values(field_id,value_text);
CREATE INDEX field_number_lookup ON entity_field_values(field_id,value_decimal);
CREATE TABLE entity_field_option_values (
  workspace_id uuid NOT NULL, entity_id uuid NOT NULL, field_id uuid NOT NULL, option_id uuid NOT NULL,
  PRIMARY KEY(entity_id,field_id,option_id),
  FOREIGN KEY(entity_id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY(option_id,field_id,workspace_id) REFERENCES field_options(id,field_id,workspace_id)
);
CREATE TABLE relation_definitions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, name text NOT NULL, scope_entity_id uuid,
  cardinality text NOT NULL CHECK(cardinality IN ('one_to_one','one_to_many')),
  source_kinds text[] NOT NULL, target_kinds text[] NOT NULL, required boolean NOT NULL DEFAULT false,
  delete_policy text NOT NULL DEFAULT 'restrict' CHECK(delete_policy IN ('restrict','unlink')),
  UNIQUE(id,workspace_id), FOREIGN KEY(id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY(scope_entity_id,workspace_id) REFERENCES entities(id,workspace_id)
);
CREATE TABLE relation_edges (
  workspace_id uuid NOT NULL, definition_id uuid NOT NULL, source_id uuid NOT NULL, target_id uuid NOT NULL,
  PRIMARY KEY(definition_id,source_id,target_id), UNIQUE(definition_id,target_id),
  FOREIGN KEY(definition_id,workspace_id) REFERENCES relation_definitions(id,workspace_id),
  FOREIGN KEY(source_id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY(target_id,workspace_id) REFERENCES entities(id,workspace_id), CHECK(source_id<>target_id)
);
CREATE INDEX relation_source ON relation_edges(source_id,definition_id);
CREATE INDEX relation_target ON relation_edges(target_id,definition_id);
CREATE TABLE ledger_templates (
  id text NOT NULL, version integer NOT NULL CHECK(version>0), workspace_id uuid REFERENCES workspaces(id),
  name text NOT NULL, ledger_type text NOT NULL CHECK(ledger_type IN ('expense','savings')),
  config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id,version)
);
CREATE TABLE template_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, ledger_id uuid NOT NULL,
  template_id text NOT NULL, template_version integer NOT NULL, name text NOT NULL, snapshot jsonb NOT NULL,
  operation_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,workspace_id),
  FOREIGN KEY(ledger_id,workspace_id) REFERENCES ledgers(id,workspace_id),
  FOREIGN KEY(template_id,template_version) REFERENCES ledger_templates(id,version)
);
CREATE TABLE template_entity_mappings (
  workspace_id uuid NOT NULL, instance_id uuid NOT NULL, template_key text NOT NULL, entity_id uuid NOT NULL,
  PRIMARY KEY(instance_id,template_key), FOREIGN KEY(instance_id,workspace_id) REFERENCES template_instances(id,workspace_id),
  FOREIGN KEY(entity_id,workspace_id) REFERENCES entities(id,workspace_id)
);
CREATE TABLE budget_plans (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, ledger_id uuid NOT NULL, month date NOT NULL,
  name text NOT NULL, base_minor money_minor, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(id,workspace_id), UNIQUE(id,workspace_id,ledger_id),
  FOREIGN KEY(id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY(ledger_id,workspace_id) REFERENCES ledgers(id,workspace_id),
  CHECK(extract(day FROM month)=1), CHECK(status<>'active' OR base_minor>0)
);
CREATE UNIQUE INDEX active_budget_per_month ON budget_plans(ledger_id,month) WHERE status='active';
CREATE TABLE budget_items (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, plan_id uuid NOT NULL, parent_id uuid, name text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('expense_budget','savings_budget')),
  mode text NOT NULL CHECK(mode IN ('fixed','ratio','remainder')), fixed_minor money_minor,
  ratio_bps integer CHECK(ratio_bps BETWEEN 0 AND 10000), remainder_weight integer CHECK(remainder_weight>0),
  UNIQUE(id,workspace_id,plan_id), FOREIGN KEY(id,workspace_id) REFERENCES entities(id,workspace_id),
  FOREIGN KEY(plan_id,workspace_id) REFERENCES budget_plans(id,workspace_id),
  FOREIGN KEY(parent_id,workspace_id,plan_id) REFERENCES budget_items(id,workspace_id,plan_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK(parent_id IS DISTINCT FROM id)
);
-- Buckets are mutually exclusive posting units; parent items are display aggregates.
CREATE TABLE budget_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, plan_id uuid NOT NULL, item_id uuid NOT NULL,
  name text NOT NULL, initial_minor money_minor, UNIQUE(id,workspace_id,plan_id), UNIQUE(item_id),
  FOREIGN KEY(item_id,workspace_id,plan_id) REFERENCES budget_items(id,workspace_id,plan_id)
);
CREATE TABLE budget_category_mappings (
  workspace_id uuid NOT NULL, plan_id uuid NOT NULL, ledger_id uuid NOT NULL, category_id uuid NOT NULL, bucket_id uuid NOT NULL,
  PRIMARY KEY(plan_id,category_id),
  FOREIGN KEY(plan_id,workspace_id,ledger_id) REFERENCES budget_plans(id,workspace_id,ledger_id),
  FOREIGN KEY(category_id,workspace_id,ledger_id) REFERENCES category_tags(id,workspace_id,ledger_id),
  FOREIGN KEY(bucket_id,workspace_id,plan_id) REFERENCES budget_buckets(id,workspace_id,plan_id)
);
CREATE TABLE budget_revisions (
  plan_id uuid NOT NULL REFERENCES budget_plans(id), revision bigint NOT NULL, snapshot jsonb NOT NULL,
  reason text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(plan_id,revision)
);
CREATE TABLE budget_usage_links (
  workspace_id uuid NOT NULL, plan_id uuid NOT NULL, bucket_id uuid NOT NULL, transaction_id uuid NOT NULL,
  usage_kind text NOT NULL CHECK(usage_kind IN ('consume','savings','refund')), amount_minor money_minor NOT NULL CHECK(amount_minor>0),
  PRIMARY KEY(plan_id,transaction_id), FOREIGN KEY(bucket_id,workspace_id,plan_id) REFERENCES budget_buckets(id,workspace_id,plan_id),
  FOREIGN KEY(transaction_id,workspace_id) REFERENCES transactions(id,workspace_id)
);
CREATE TABLE budget_transfer_operations (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, plan_id uuid NOT NULL, request jsonb NOT NULL,
  operation_kind text NOT NULL CHECK(operation_kind IN ('compensate','reverse')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,workspace_id,plan_id), FOREIGN KEY(plan_id,workspace_id) REFERENCES budget_plans(id,workspace_id)
);
CREATE TABLE budget_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, plan_id uuid NOT NULL, operation_id uuid NOT NULL,
  from_bucket_id uuid NOT NULL, to_bucket_id uuid NOT NULL, amount_minor money_minor NOT NULL CHECK(amount_minor>0),
  reversal_of uuid UNIQUE REFERENCES budget_transfers(id), snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(operation_id,workspace_id,plan_id) REFERENCES budget_transfer_operations(id,workspace_id,plan_id),
  FOREIGN KEY(from_bucket_id,workspace_id,plan_id) REFERENCES budget_buckets(id,workspace_id,plan_id),
  FOREIGN KEY(to_bucket_id,workspace_id,plan_id) REFERENCES budget_buckets(id,workspace_id,plan_id), CHECK(from_bucket_id<>to_bucket_id)
);
CREATE INDEX transfers_plan ON budget_transfers(plan_id,created_at);
CREATE TABLE transaction_refund_links (
  workspace_id uuid NOT NULL, refund_id uuid PRIMARY KEY, original_id uuid NOT NULL,
  FOREIGN KEY(refund_id,workspace_id) REFERENCES transactions(id,workspace_id),
  FOREIGN KEY(original_id,workspace_id) REFERENCES transactions(id,workspace_id), CHECK(refund_id<>original_id)
);
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
  entity_id uuid, operation_id uuid, action text NOT NULL, before_value jsonb, after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(entity_id,workspace_id) REFERENCES entities(id,workspace_id)
);
CREATE INDEX audit_entity ON audit_events(entity_id,created_at);
CREATE TABLE deletion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  root_id uuid NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), restored_at timestamptz,
  FOREIGN KEY(root_id,workspace_id) REFERENCES entities(id,workspace_id)
);
CREATE TABLE app_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), key text NOT NULL, value jsonb NOT NULL, PRIMARY KEY(workspace_id,key)
);
CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
  job_type text NOT NULL CHECK(job_type IN ('xlsx','backup','restore')), status text NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','running','completed','failed','cancelled')), query jsonb NOT NULL,
  result_path text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);

-- Authoritative visible tree; deleting any ancestor hides all descendants.
CREATE VIEW visible_tree_nodes AS
WITH RECURSIVE visible AS (
  SELECT n.* FROM tree_nodes n JOIN entities e USING(id,workspace_id) WHERE n.parent_id IS NULL AND e.deleted_at IS NULL
  UNION ALL
  SELECT n.* FROM tree_nodes n JOIN visible p ON n.parent_id=p.id AND n.workspace_id=p.workspace_id
  JOIN entities e ON e.id=n.id WHERE e.deleted_at IS NULL
) SELECT * FROM visible;
CREATE VIEW budget_balances AS
WITH usage AS (
  SELECT u.bucket_id, sum(CASE WHEN u.usage_kind='refund' THEN -u.amount_minor ELSE u.amount_minor END) used_minor
  FROM budget_usage_links u JOIN visible_tree_nodes v ON v.id=u.transaction_id GROUP BY u.bucket_id
), incoming AS (
  SELECT to_bucket_id id,sum(amount_minor) amount FROM budget_transfers GROUP BY to_bucket_id
), outgoing AS (
  SELECT from_bucket_id id,sum(amount_minor) amount FROM budget_transfers GROUP BY from_bucket_id
)
SELECT b.*,coalesce(u.used_minor,0)::bigint used_minor,coalesce(i.amount,0)::bigint transferred_in_minor,
  coalesce(o.amount,0)::bigint transferred_out_minor,
  (b.initial_minor+coalesce(i.amount,0)-coalesce(o.amount,0)-coalesce(u.used_minor,0))::bigint available_minor
FROM budget_buckets b LEFT JOIN usage u ON u.bucket_id=b.id LEFT JOIN incoming i ON i.id=b.id LEFT JOIN outgoing o ON o.id=b.id;
