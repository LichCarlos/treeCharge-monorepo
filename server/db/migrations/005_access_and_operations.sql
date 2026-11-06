SET search_path=charge,pg_catalog;
CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL UNIQUE CHECK(btrim(username)<>''),
  password_hash text NOT NULL, disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES app_users(id),
  access_role text NOT NULL DEFAULT 'owner' CHECK(access_role IN ('owner','viewer')), PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_users(id),
  refresh_token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_by_user ON auth_sessions(user_id,expires_at);
CREATE TABLE api_operations (
  workspace_id uuid NOT NULL REFERENCES workspaces(id), operation_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users(id), request_hash text NOT NULL,
  operation_type text NOT NULL, response jsonb, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,operation_id)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON app_users,workspace_members,auth_sessions,api_operations TO charge_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA charge FROM PUBLIC;
