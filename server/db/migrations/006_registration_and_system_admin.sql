SET search_path=charge,pg_catalog;

ALTER TABLE app_users ADD COLUMN system_role text NOT NULL DEFAULT 'user'
  CHECK(system_role IN ('user','super_admin'));
ALTER TABLE app_users ADD COLUMN deleted_at timestamptz;
ALTER TABLE app_users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN auth_version bigint NOT NULL DEFAULT 1 CHECK(auth_version>0);
ALTER TABLE app_users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX app_users_normalized_username ON app_users(lower(btrim(username)));
CREATE INDEX app_users_system_role ON app_users(system_role) WHERE deleted_at IS NULL;

CREATE TABLE system_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES app_users(id), target_user_id uuid REFERENCES app_users(id),
  workspace_id uuid REFERENCES workspaces(id), action text NOT NULL,
  resource_type text NOT NULL, resource_id text, reason text,
  before_value jsonb, after_value jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_audit_actor ON system_audit_events(actor_id,created_at DESC);
CREATE INDEX system_audit_target ON system_audit_events(target_user_id,created_at DESC);
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON system_audit_events
  FOR EACH ROW EXECUTE FUNCTION immutable_history();

-- Use an application-specific transaction lock before account lifecycle changes.
-- This also makes concurrent demotion/disable of the last admins deterministic.
CREATE FUNCTION guard_account_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(724306,1);
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'use audited account soft deletion' USING ERRCODE='23514';
  END IF;
  IF OLD.system_role='super_admin' AND OLD.disabled_at IS NULL AND OLD.deleted_at IS NULL
    AND (NEW.system_role<>'super_admin' OR NEW.disabled_at IS NOT NULL OR NEW.deleted_at IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM charge.app_users WHERE id<>OLD.id AND system_role='super_admin'
      AND disabled_at IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'last active system administrator must be retained' USING ERRCODE='23514';
  END IF;
  IF (NEW.system_role,NEW.disabled_at,NEW.deleted_at,NEW.password_hash) IS DISTINCT FROM
      (OLD.system_role,OLD.disabled_at,OLD.deleted_at,OLD.password_hash) THEN
    NEW.auth_version:=OLD.auth_version+1;
    UPDATE charge.auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=OLD.id;
  END IF;
  NEW.updated_at:=now();
  RETURN NEW;
END $$;
CREATE TRIGGER account_lifecycle BEFORE UPDATE OR DELETE ON app_users
  FOR EACH ROW EXECUTE FUNCTION guard_account_lifecycle();

CREATE FUNCTION valid_password_hash(p_hash text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_hash IS NULL OR cardinality(string_to_array(p_hash,'$'))<>6
    OR split_part(p_hash,'$',1)<>'scrypt' OR split_part(p_hash,'$',2)<>'16384'
    OR split_part(p_hash,'$',3)<>'8' OR split_part(p_hash,'$',4)<>'1' THEN RETURN false; END IF;
  RETURN octet_length(decode(split_part(p_hash,'$',5),'base64'))=16
    AND octet_length(decode(split_part(p_hash,'$',6),'base64'))=64;
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation THEN RETURN false;
END $$;

-- Only the API hashes the submitted password. Neither roles nor workspace IDs are
-- accepted from the registration client. All creation is one transaction.
CREATE FUNCTION register_account(p_username text,p_password_hash text)
RETURNS TABLE(user_id uuid,workspace_id uuid,root_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
DECLARE u uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); n text:=btrim(p_username);
BEGIN
  IF n IS NULL OR char_length(n) NOT BETWEEN 3 AND 32 OR n ~ '[[:cntrl:]]'
    OR lower(n)='system_admin' THEN RAISE EXCEPTION 'invalid or reserved username' USING ERRCODE='23514'; END IF;
  IF NOT valid_password_hash(p_password_hash) THEN RAISE EXCEPTION 'invalid password hash format' USING ERRCODE='23514'; END IF;
  INSERT INTO app_users(id,username,password_hash,system_role) VALUES(u,n,p_password_hash,'user');
  INSERT INTO workspaces(id,name) VALUES(w,n||'的工作区');
  INSERT INTO workspace_members(workspace_id,user_id,access_role) VALUES(w,u,'owner');
  INSERT INTO entities(id,workspace_id,kind) VALUES(r,w,'root');
  INSERT INTO tree_nodes(id,workspace_id,parent_id) VALUES(r,w,NULL);
  INSERT INTO app_settings(workspace_id,key,value) VALUES(w,'bookkeeping',
    '{"mode":"manual","defaultTemplateId":null}'::jsonb);
  INSERT INTO system_audit_events(actor_id,target_user_id,workspace_id,action,resource_type,resource_id,after_value)
    VALUES(u,u,w,'account.register','user',u::text,jsonb_build_object('username',n,'role','user'));
  RETURN QUERY SELECT u,w,r;
END $$;

CREATE FUNCTION has_workspace_access(p_actor uuid,p_workspace uuid,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM app_users u WHERE u.id=p_actor AND u.disabled_at IS NULL
    AND u.deleted_at IS NULL AND NOT u.must_change_password AND EXISTS(SELECT 1 FROM workspaces WHERE id=p_workspace)
    AND (u.system_role='super_admin' OR EXISTS(SELECT 1 FROM workspace_members m
      WHERE m.user_id=u.id AND m.workspace_id=p_workspace AND (NOT p_write OR m.access_role='owner'))));
$$;

CREATE FUNCTION require_system_admin(p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_users WHERE id=p_actor AND system_role='super_admin'
    AND disabled_at IS NULL AND deleted_at IS NULL AND NOT must_change_password) THEN
    RAISE EXCEPTION 'system administrator required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION admin_update_account(p_actor uuid,p_target uuid,p_role text,p_disabled boolean,p_deleted boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
DECLARE previous app_users; changed app_users;
BEGIN
  PERFORM pg_advisory_xact_lock(724306,1);
  PERFORM require_system_admin(p_actor);
  IF p_reason IS NULL OR btrim(p_reason)='' OR p_role IS NULL OR p_role NOT IN ('user','super_admin')
    OR p_disabled IS NULL OR p_deleted IS NULL THEN RAISE EXCEPTION 'role, flags and reason required' USING ERRCODE='23514'; END IF;
  SELECT * INTO previous FROM app_users WHERE id=p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='23514'; END IF;
  UPDATE app_users SET system_role=p_role,disabled_at=CASE WHEN p_disabled THEN coalesce(disabled_at,now()) END,
    deleted_at=CASE WHEN p_deleted THEN coalesce(deleted_at,now()) END
    WHERE id=p_target RETURNING * INTO changed;
  INSERT INTO system_audit_events(actor_id,target_user_id,action,resource_type,resource_id,reason,before_value,after_value)
    VALUES(p_actor,p_target,'admin.account.update','user',p_target::text,p_reason,
      jsonb_build_object('role',previous.system_role,'disabledAt',previous.disabled_at,'deletedAt',previous.deleted_at),
      jsonb_build_object('role',changed.system_role,'disabledAt',changed.disabled_at,'deletedAt',changed.deleted_at));
  RETURN jsonb_build_object('id',changed.id,'username',changed.username,'role',changed.system_role,
    'disabledAt',changed.disabled_at,'deletedAt',changed.deleted_at,'authVersion',changed.auth_version);
END $$;

CREATE FUNCTION change_account_password(p_actor uuid,p_expected_version bigint,p_password_hash text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
DECLARE v bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(724306,1);
  IF NOT valid_password_hash(p_password_hash) THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE='23514'; END IF;
  UPDATE app_users SET password_hash=p_password_hash,must_change_password=false
    WHERE id=p_actor AND auth_version=p_expected_version AND disabled_at IS NULL AND deleted_at IS NULL RETURNING auth_version INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'account unavailable or stale auth version' USING ERRCODE='23514'; END IF;
  INSERT INTO system_audit_events(actor_id,target_user_id,action,resource_type,resource_id)
    VALUES(p_actor,p_actor,'account.password.change','user',p_actor::text);
  RETURN v;
END $$;

CREATE FUNCTION admin_reset_password(p_actor uuid,p_target uuid,p_password_hash text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(724306,1);
  PERFORM require_system_admin(p_actor);
  IF p_reason IS NULL OR btrim(p_reason)='' OR NOT valid_password_hash(p_password_hash) THEN
    RAISE EXCEPTION 'valid hash and reset reason required' USING ERRCODE='23514'; END IF;
  UPDATE app_users SET password_hash=p_password_hash,must_change_password=true WHERE id=p_target AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'account unavailable' USING ERRCODE='23514'; END IF;
  INSERT INTO system_audit_events(actor_id,target_user_id,action,resource_type,resource_id,reason)
    VALUES(p_actor,p_target,'admin.account.password.reset','user',p_target::text,p_reason);
END $$;

-- Backend is trusted, but its direct user writes cannot silently elevate roles.
REVOKE INSERT,UPDATE,DELETE ON app_users FROM charge_app;
GRANT SELECT,INSERT ON system_audit_events TO charge_app;
GRANT USAGE,SELECT ON SEQUENCE system_audit_events_id_seq TO charge_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA charge FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_account(text,text),has_workspace_access(uuid,uuid,boolean),
  admin_update_account(uuid,uuid,text,boolean,boolean,text),change_account_password(uuid,bigint,text),
  admin_reset_password(uuid,uuid,text,text) TO charge_app;
