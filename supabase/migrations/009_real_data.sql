-- ==============================================================================
-- JOIN THE QUEUE — Migration 009: REAL-DATA CLEANUP (additive, no deletions)
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- Wrapped in one transaction. Contains NO destructive statements.
-- ==============================================================================
-- The live database was inspected before this migration: zero rows existed in
-- slots, slot_memberships, payment_transactions, membership_bills,
-- slot_reservations and profiles. The only rows present are the three
-- subscription_products (legitimate catalog entries). Nothing needed deletion.
--
-- This migration only adds the pieces required for a fully database-driven
-- admin dashboard:
--   1. Staff read access to payment_transactions (real financials).
--   2. Staff read access to all memberships (real subscription statistics).
--   3. create_subscription_product / set_subscription_product_active RPCs so
--      "Available Plans" are real database rows, not frontend state.
--   4. Re-asserts the superAdmin downgrade guard on redeem_admin_invitation
--      (protects against the redundant fix_claim_super_admin.sql variant).
-- ==============================================================================

BEGIN;

-- 1. Staff read on payment transactions -------------------------------------
DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
CREATE POLICY "Staff can view payment transactions"
  ON public.payment_transactions FOR SELECT
  USING (public.is_staff_admin());

-- 2. Staff read on memberships (subscription statistics) --------------------
DROP POLICY IF EXISTS "Staff can view all memberships" ON public.slot_memberships;
CREATE POLICY "Staff can view all memberships"
  ON public.slot_memberships FOR SELECT
  USING (public.is_staff_member());

-- 3. Create an available plan (staff admin) ---------------------------------
CREATE OR REPLACE FUNCTION public.create_subscription_product(
  p_name text,
  p_monthly_price numeric,
  p_category text DEFAULT 'Music',
  p_description text DEFAULT '',
  p_currency text DEFAULT 'NGN',
  p_icon text DEFAULT 'music-disc',
  p_eligibility_note text DEFAULT NULL,
  p_highlights jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_product public.subscription_products%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can create subscription plans.';
  END IF;

  p_name := btrim(coalesce(p_name, ''));
  IF length(p_name) < 2 OR length(p_name) > 80 THEN
    RAISE EXCEPTION 'Plan name must be 2-80 characters.';
  END IF;
  IF p_monthly_price IS NULL OR p_monthly_price <= 0 OR p_monthly_price > 10000000 THEN
    RAISE EXCEPTION 'Monthly price must be greater than zero.';
  END IF;

  INSERT INTO public.subscription_products (
    name, monthly_price, category, description, currency, icon,
    eligibility_note, highlights, is_active
  ) VALUES (
    p_name, p_monthly_price, nullif(btrim(p_category), ''), nullif(btrim(p_description), ''),
    upper(coalesce(p_currency, 'NGN')), nullif(btrim(p_icon), ''), p_eligibility_note,
    coalesce(p_highlights, '["Admin-coordinated subscription slot access", "Receive group invite link and address in your Profile Inbox", "Manage monthly or multi-month renewals anytime"]'::jsonb),
    true
  )
  RETURNING * INTO v_product;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('product_created', actor, jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'price', v_product.monthly_price));

  RETURN to_jsonb(v_product);
END;
$$;

-- 4. Toggle a plan between available / waitlist ------------------------------
CREATE OR REPLACE FUNCTION public.set_subscription_product_active(
  p_product_id uuid,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_product public.subscription_products%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can change plan availability.';
  END IF;

  UPDATE public.subscription_products
  SET is_active = p_active
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found.';
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('product_status_changed', actor, jsonb_build_object('product_id', v_product.id, 'is_active', p_active));

  RETURN to_jsonb(v_product);
END;
$$;

-- 5. Re-assert the superAdmin downgrade guard on invitation redemption -------
CREATE OR REPLACE FUNCTION public.redeem_admin_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uemail text := public.jwt_email();
  invite public.admin_invitations%ROWTYPE;
BEGIN
  IF uemail IS NULL OR uemail = '' THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO invite
  FROM public.admin_invitations
  WHERE email = uemail AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending staff invitation found for %', uemail;
  END IF;

  UPDATE public.admin_invitations
  SET status = 'redeemed', redeemed_at = now()
  WHERE id = invite.id;

  INSERT INTO public.staff_members (email, role)
  VALUES (uemail, invite.role)
  ON CONFLICT (email) DO UPDATE
    SET role = CASE WHEN public.staff_members.role = 'superAdmin' THEN 'superAdmin' ELSE invite.role END;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('invitation_redeemed', uemail, jsonb_build_object('role', invite.role, 'note', invite.note));

  RETURN jsonb_build_object('granted', true, 'role', invite.role);
END;
$$;

-- 6. Privileges --------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_subscription_product(text, numeric, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_subscription_product_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_subscription_product(text, numeric, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_subscription_product_active(uuid, boolean) TO authenticated;

COMMIT;
