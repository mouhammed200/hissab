-- 006: Idempotent periodic depreciation runner.
-- The cron route calls this function with the service role. All rows for one
-- organization are generated, posted, and marked in one database transaction.

CREATE UNIQUE INDEX IF NOT EXISTS depreciation_schedule_asset_period_uidx
  ON depreciation_schedules (org_id, asset_id, period_date);

CREATE OR REPLACE FUNCTION public.run_periodic_depreciation(
  p_org_id UUID,
  p_as_of DATE DEFAULT CURRENT_DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset RECORD;
  v_schedule RECORD;
  v_first_month DATE;
  v_last_month DATE;
  v_period DATE;
  v_monthly NUMERIC;
  v_remaining NUMERIC;
  v_amount NUMERIC;
  v_accumulated NUMERIC;
  v_entry_id UUID;
  v_account_id UUID;
  v_accumulated_account_id UUID;
  v_actor_id UUID;
  v_processed INT := 0;
  v_generated INT := 0;
  v_skipped INT := 0;
  v_reference TEXT;
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'org_id is required'; END IF;
  IF p_as_of IS NULL THEN p_as_of := CURRENT_DATE; END IF;

  v_actor_id := p_actor_id;
  IF v_actor_id IS NULL THEN
    SELECT om.user_id INTO v_actor_id
    FROM org_members om
    WHERE om.org_id = p_org_id AND om.role IN ('owner', 'admin', 'accountant')
    ORDER BY CASE om.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END
    LIMIT 1;
  END IF;
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'No posting user exists for organization'; END IF;

  -- Generate one row per asset/month, starting in the acquisition month and
  -- stopping at the current month or the end of useful life, whichever comes first.
  FOR v_asset IN
    SELECT id, org_id, name, purchase_date, purchase_cost, salvage_value, useful_life_years
    FROM fixed_assets
    WHERE org_id = p_org_id AND status = 'active'
  LOOP
    IF v_asset.purchase_cost <= COALESCE(v_asset.salvage_value, 0)
       OR v_asset.useful_life_years <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_first_month := date_trunc('month', v_asset.purchase_date)::DATE;
    v_last_month := LEAST(
      (date_trunc('month', p_as_of) + INTERVAL '0 month')::DATE,
      (v_first_month + (v_asset.useful_life_years * 12 - 1) * INTERVAL '1 month')::DATE
    );
    v_monthly := ROUND((v_asset.purchase_cost - COALESCE(v_asset.salvage_value, 0)) / (v_asset.useful_life_years * 12), 2);

    FOR v_period IN
      SELECT generate_series(v_first_month, v_last_month, INTERVAL '1 month')::DATE
    LOOP
      -- The final period absorbs rounding residue so accumulated depreciation
      -- lands exactly on cost minus salvage.
      v_accumulated := LEAST(
        v_asset.purchase_cost - COALESCE(v_asset.salvage_value, 0),
        COALESCE((SELECT SUM(depreciation_amount) FROM depreciation_schedules
                  WHERE org_id = p_org_id AND asset_id = v_asset.id
                    AND period_date < v_period), 0) + v_monthly
      );
      v_remaining := GREATEST(0, v_asset.purchase_cost - COALESCE(v_asset.salvage_value, 0) -
        COALESCE((SELECT SUM(depreciation_amount) FROM depreciation_schedules
                  WHERE org_id = p_org_id AND asset_id = v_asset.id
                    AND period_date < v_period), 0));
      v_amount := LEAST(v_monthly, v_remaining);

      INSERT INTO depreciation_schedules(
        org_id, asset_id, period_date, depreciation_amount,
        accumulated_depreciation, net_book_value, is_posted
      )
      VALUES (
        p_org_id, v_asset.id, v_period, v_amount, v_accumulated,
        v_asset.purchase_cost - v_accumulated, FALSE
      )
      ON CONFLICT (org_id, asset_id, period_date) DO NOTHING;
      IF FOUND THEN v_generated := v_generated + 1; END IF;
    END LOOP;
  END LOOP;

  -- Post due rows in period order. FOR UPDATE prevents two cron invocations
  -- from claiming the same month. The reference is also unique through the
  -- posting_requests table, giving us a second idempotency guard.
  FOR v_schedule IN
    SELECT ds.*, fa.name AS asset_name
    FROM depreciation_schedules ds
    JOIN fixed_assets fa ON fa.id = ds.asset_id
    WHERE ds.org_id = p_org_id
      AND ds.period_date <= p_as_of
      AND ds.is_posted = FALSE
    ORDER BY ds.period_date, ds.asset_id
    FOR UPDATE OF ds
  LOOP
    v_reference := 'depreciation:' || v_schedule.asset_id::TEXT || ':' || v_schedule.period_date::TEXT;

    INSERT INTO posting_requests(org_id, request_key)
    VALUES (p_org_id, v_reference)
    ON CONFLICT (org_id, request_key) DO NOTHING;
    IF NOT FOUND THEN
      SELECT id INTO v_entry_id FROM journal_entries
      WHERE org_id = p_org_id AND reference = v_reference
      LIMIT 1;
      IF v_entry_id IS NOT NULL THEN
        UPDATE depreciation_schedules
        SET is_posted = TRUE, journal_entry_id = v_entry_id
        WHERE id = v_schedule.id AND is_posted = FALSE;
      END IF;
      CONTINUE;
    END IF;

    SELECT id INTO v_account_id FROM accounts
    WHERE org_id = p_org_id AND code = '6400' AND is_active = TRUE;
    IF v_account_id IS NULL THEN RAISE EXCEPTION 'Missing account code: 6400'; END IF;

    SELECT id INTO v_entry_id FROM accounts
    WHERE org_id = p_org_id AND code = '1510' AND is_active = TRUE;
    IF v_entry_id IS NULL THEN RAISE EXCEPTION 'Missing account code: 1510'; END IF;
    v_accumulated_account_id := v_entry_id;

    INSERT INTO journal_entries(
      org_id, created_by, date, reference, description, source_type, source_id,
      status, posted_at, posted_by
    )
    VALUES (
      p_org_id, v_actor_id, v_schedule.period_date, v_reference,
      'Depreciation: ' || v_schedule.asset_name || ' (' || v_schedule.period_date || ')',
      'depreciation', v_schedule.asset_id, 'posted', NOW(), v_actor_id
    )
    RETURNING id INTO v_entry_id;

    INSERT INTO journal_lines(
      org_id, journal_entry_id, account_id, debit, credit, description
    )
    VALUES
      (p_org_id, v_entry_id, v_account_id, v_schedule.depreciation_amount, 0,
       'Depreciation expense: ' || v_schedule.asset_name),
      (p_org_id, v_entry_id, v_accumulated_account_id,
       0, v_schedule.depreciation_amount,
       'Accumulated depreciation: ' || v_schedule.asset_name);

    UPDATE depreciation_schedules
    SET is_posted = TRUE, journal_entry_id = v_entry_id
    WHERE id = v_schedule.id AND is_posted = FALSE;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE, 'orgId', p_org_id, 'asOf', p_as_of,
    'generated', v_generated, 'processed', v_processed, 'skipped', v_skipped
  );
END;
$$;

-- The route uses the Supabase service role. Do not expose this write function
-- to browser sessions or anonymous callers.
REVOKE ALL ON FUNCTION public.run_periodic_depreciation(UUID, DATE, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_periodic_depreciation(UUID, DATE, UUID) TO service_role;
