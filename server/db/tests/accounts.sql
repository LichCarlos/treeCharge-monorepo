\set ON_ERROR_STOP on
-- This test may only run against an isolated verification database.
DO $$ BEGIN
  IF current_database() !~ '^charge_(auth|restore)_verify_[0-9]+$' THEN
    RAISE EXCEPTION 'Account tests require an isolated verification database'; END IF;
END $$;
BEGIN;
SET LOCAL search_path=charge,pg_catalog;
CREATE FUNCTION pg_temp.account_tests() RETURNS void LANGUAGE plpgsql AS $$
DECLARE a record; b record; admin_id uuid; admin2 uuid; audit_count bigint; version_before bigint;
  test_hash text:='scrypt$16384$8$1$'||encode(decode(repeat('ab',16),'hex'),'base64')||'$'||replace(encode(decode(repeat('cd',64),'hex'),'base64'),E'\n','');
BEGIN
  SELECT * INTO a FROM register_account('Rollback_Account_A',test_hash);
  SELECT * INTO b FROM register_account('Rollback_Account_B',test_hash);
  IF a.workspace_id=b.workspace_id OR a.root_id=b.root_id OR (SELECT system_role FROM app_users WHERE id=a.user_id)<>'user'
    OR (SELECT count(*) FROM tree_nodes WHERE workspace_id=a.workspace_id)<>1
    OR EXISTS(SELECT 1 FROM ledgers WHERE workspace_id=a.workspace_id)
    OR EXISTS(SELECT 1 FROM transactions WHERE workspace_id=a.workspace_id) THEN RAISE EXCEPTION 'registration not blank or isolated'; END IF;
  RAISE NOTICE 'PASS: registration atomically creates normal user, own workspace and empty tree';
  BEGIN PERFORM register_account(' rollback_account_a ',test_hash); RAISE EXCEPTION 'duplicate normalized username accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT count(*) FROM workspaces WHERE name='rollback_account_a的工作区')<>0 THEN RAISE EXCEPTION 'failed registration left workspace'; END IF;
  RAISE NOTICE 'PASS: duplicate names rejected without partial registration';
  BEGIN PERFORM register_account('system_admin',test_hash); RAISE EXCEPTION 'reserved admin name accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM register_account('BadHash','plain-password'); RAISE EXCEPTION 'unhashed password accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS: reserved administrator username and invalid password hash rejected';
  IF NOT has_workspace_access(a.user_id,a.workspace_id,true) OR has_workspace_access(a.user_id,b.workspace_id,false)
    OR has_workspace_access(a.user_id,b.workspace_id,true) OR has_workspace_access(gen_random_uuid(),a.workspace_id,false) THEN
    RAISE EXCEPTION 'workspace ownership authorization failed'; END IF;
  RAISE NOTICE 'PASS: ordinary users cannot read or write other workspaces';
  BEGIN PERFORM admin_update_account(a.user_id,b.user_id,'super_admin',false,false,'unauthorized promotion');
    RAISE EXCEPTION 'ordinary user promoted account'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE app_users SET system_role='super_admin' WHERE id=a.user_id;
    RAISE EXCEPTION 'direct runtime role update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS: ordinary actor and runtime table writes cannot promote accounts';
  SELECT id INTO admin_id FROM app_users WHERE username='Rollback_Test_Admin';
  IF admin_id IS NULL THEN RAISE EXCEPTION 'test admin fixture missing'; END IF;
  IF NOT has_workspace_access(admin_id,a.workspace_id,true) OR NOT has_workspace_access(admin_id,b.workspace_id,false) THEN
    RAISE EXCEPTION 'super admin cross-user access failed'; END IF;
  RAISE NOTICE 'PASS: system administrator authorization spans user workspaces';
  INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES(b.user_id,'rollback-only-refresh',now()+interval '1 day');
  SELECT auth_version INTO version_before FROM app_users WHERE id=b.user_id;
  PERFORM admin_update_account(admin_id,b.user_id,'user',true,false,'test suspension');
  IF has_workspace_access(b.user_id,b.workspace_id,true) OR EXISTS(SELECT 1 FROM auth_sessions WHERE user_id=b.user_id AND revoked_at IS NULL)
    OR (SELECT auth_version FROM app_users WHERE id=b.user_id)<>version_before+1 THEN RAISE EXCEPTION 'suspension did not invalidate credentials'; END IF;
  PERFORM admin_update_account(admin_id,b.user_id,'user',false,false,'test reactivation');
  IF NOT has_workspace_access(b.user_id,b.workspace_id,true) THEN RAISE EXCEPTION 'reactivation failed'; END IF;
  RAISE NOTICE 'PASS: disabling revokes sessions and access; reactivation restores ownership';
  PERFORM admin_update_account(admin_id,b.user_id,'user',false,true,'test deletion');
  IF has_workspace_access(b.user_id,b.workspace_id,false) THEN RAISE EXCEPTION 'deleted user still authorized'; END IF;
  PERFORM admin_update_account(admin_id,b.user_id,'user',false,false,'test restoration');
  IF NOT EXISTS(SELECT 1 FROM tree_nodes WHERE id=b.root_id) THEN RAISE EXCEPTION 'account restore lost data'; END IF;
  RAISE NOTICE 'PASS: account soft deletion and restoration preserve business records';
  PERFORM admin_reset_password(admin_id,b.user_id,test_hash,'test password reset');
  IF has_workspace_access(b.user_id,b.workspace_id,false) OR NOT (SELECT must_change_password FROM app_users WHERE id=b.user_id) THEN
    RAISE EXCEPTION 'password reset did not enforce first-change'; END IF;
  SELECT auth_version INTO version_before FROM app_users WHERE id=b.user_id;
  PERFORM change_account_password(b.user_id,version_before,test_hash);
  IF NOT has_workspace_access(b.user_id,b.workspace_id,true) THEN RAISE EXCEPTION 'password change did not release restriction'; END IF;
  RAISE NOTICE 'PASS: reset requires password change before business access';
  BEGIN PERFORM admin_update_account(admin_id,admin_id,'user',false,false,'last admin demotion');
    RAISE EXCEPTION 'last admin demoted'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM admin_update_account(admin_id,admin_id,'super_admin',true,false,'last admin disable');
    RAISE EXCEPTION 'last admin disabled'; EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN PERFORM admin_update_account(admin_id,admin_id,'super_admin',false,true,'last admin deletion');
    RAISE EXCEPTION 'last admin deleted'; EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'PASS: last active system administrator cannot be demoted, disabled or deleted';
  BEGIN UPDATE system_audit_events SET reason='altered' WHERE actor_id=admin_id;
    RAISE EXCEPTION 'audit mutable'; EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO audit_count FROM system_audit_events WHERE actor_id=admin_id;
  IF audit_count<5 OR EXISTS(SELECT 1 FROM system_audit_events WHERE actor_id IN(a.user_id,b.user_id,admin_id)
    AND (coalesce(before_value,'{}')::text||coalesce(after_value,'{}')::text) LIKE '%scrypt$%') THEN
    RAISE EXCEPTION 'audit missing or leaked password hash'; END IF;
  RAISE NOTICE 'PASS: administrator events audited and immutable without password hash';
END $$;

-- All potentially existing accounts here are CLONES in the isolated database.
-- Make the fixture the only active admin, to test last-admin protection reliably.
INSERT INTO app_users(username,password_hash,system_role)
VALUES('Rollback_Test_Admin','TEST_ONLY_NOT_A_LOGIN_HASH','super_admin');
UPDATE app_users SET system_role='user' WHERE username<>'Rollback_Test_Admin' AND system_role='super_admin';
SET LOCAL ROLE charge_app;
SELECT pg_temp.account_tests();
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'ACCOUNT AUTHORIZATION TESTS PASSED; FIXTURES ROLLED BACK' result;
