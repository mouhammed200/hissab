-- Migration 022: fix bootstrap_organization race condition
--
-- Bug found live-testing route 1.7: bootstrap_organization does
-- SELECT (check for existing org) then INSERT (create one) with no lock
-- between them. Two near-simultaneous calls for the same brand-new user
-- both pass the SELECT before either INSERT commits, so the same user
-- ends up owner of two separate organizations.
--
-- Fix: take a per-user advisory transaction lock as the first thing the
-- function does. A second concurrent call blocks until the first call's
-- transaction commits or rolls back, then correctly sees the existing
-- org via the idempotent SELECT and returns { created: false, ... }.

CREATE OR REPLACE FUNCTION public.bootstrap_organization(
  p_name TEXT, p_emirate TEXT DEFAULT 'Dubai'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user   UUID := auth.uid();
  v_org_id UUID;
  v_name   TEXT := NULLIF(BTRIM(COALESCE(p_name, '')), '');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  -- Serialize concurrent bootstrap attempts for the SAME user. Released
  -- automatically at transaction end (commit or rollback). hashtext() on
  -- the user's uuid text form gives a stable per-user lock key.
  PERFORM pg_advisory_xact_lock(hashtext(v_user::text));

  -- Idempotent: a user who already belongs somewhere gets that org back.
  -- With the lock above, a second concurrent caller now reliably sees the
  -- first caller's committed row here instead of racing past it.
  SELECT org_id INTO v_org_id FROM org_members
  WHERE user_id = v_user ORDER BY created_at LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN (SELECT jsonb_build_object('created', false, 'organization', to_jsonb(o))
            FROM organizations o WHERE o.id = v_org_id);
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'A workspace name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO organizations (name, default_emirate)
  VALUES (v_name, COALESCE(NULLIF(p_emirate, ''), 'Dubai')::emirate_enum)
  RETURNING id INTO v_org_id;

  INSERT INTO org_members (org_id, user_id, role)
  VALUES (v_org_id, v_user, 'owner');

  PERFORM public.seed_default_chart_of_accounts(v_org_id);

  INSERT INTO audit_logs (org_id, user_id, action, table_name, record_id, new_values)
  VALUES (v_org_id, v_user, 'created', 'organizations', v_org_id,
          jsonb_build_object('name', v_name, 'bootstrap', true));

  RETURN (SELECT jsonb_build_object('created', true, 'organization', to_jsonb(o))
          FROM organizations o WHERE o.id = v_org_id);
END; $fn$;

COMMENT ON FUNCTION public.bootstrap_organization(TEXT, TEXT) IS
  'Creates an organization, its owner membership, and its chart of accounts in one transaction. The only supported way to create an org. Race-safe as of migration 022 via per-user advisory lock.';
