SET search_path=charge,pg_catalog;
ALTER TABLE auth_sessions ADD COLUMN access_token_hash text UNIQUE;
ALTER TABLE auth_sessions ADD COLUMN access_expires_at timestamptz;
CREATE TABLE system_settings(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO system_settings VALUES('registration_enabled','true',now());
GRANT SELECT,INSERT,UPDATE,DELETE ON system_settings TO charge_app;
-- Versioned template definitions are created by an authorized application service.
GRANT INSERT,UPDATE,DELETE ON ledger_templates TO charge_app;
CREATE FUNCTION update_username(p_user uuid,p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=charge,pg_catalog AS $$
BEGIN
  IF char_length(btrim(p_name)) NOT BETWEEN 3 AND 32 OR btrim(p_name) ~ '[[:cntrl:]]'
    OR lower(btrim(p_name))='system_admin' THEN RAISE EXCEPTION 'invalid username' USING ERRCODE='23514'; END IF;
  UPDATE app_users SET username=btrim(p_name) WHERE id=p_user AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION update_username(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_username(uuid,text) TO charge_app;
