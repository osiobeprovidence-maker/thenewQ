-- Secure restart and recipient account handoff support.
-- Apply this migration before deploying bachs-create-checkout.

ALTER TABLE public.slot_reservations
  ADD COLUMN IF NOT EXISTS duration_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS recipient_phone text,
  ADD COLUMN IF NOT EXISTS gift_note text;

ALTER TABLE public.slot_memberships
  ADD COLUMN IF NOT EXISTS duration_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_email text,
  ADD COLUMN IF NOT EXISTS recipient_phone text,
  ADD COLUMN IF NOT EXISTS gift_note text;

CREATE INDEX IF NOT EXISTS idx_slot_memberships_recipient_email
  ON public.slot_memberships (lower(recipient_email))
  WHERE recipient_email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attach_reservation_gift_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duration integer;
  v_name text;
  v_email text;
  v_phone text;
  v_note text;
BEGIN
  SELECT r.duration_months, r.recipient_name, r.recipient_email,
         r.recipient_phone, r.gift_note
    INTO v_duration, v_name, v_email, v_phone, v_note
  FROM public.slot_reservations r
  WHERE r.reference_id = NEW.reference_id;
  IF FOUND THEN
    NEW.duration_months := v_duration;
    NEW.recipient_name := v_name;
    NEW.recipient_email := v_email;
    NEW.recipient_phone := v_phone;
    NEW.gift_note := v_note;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS slot_memberships_attach_reservation_gift ON public.slot_memberships;
CREATE TRIGGER slot_memberships_attach_reservation_gift
  BEFORE INSERT ON public.slot_memberships
  FOR EACH ROW EXECUTE FUNCTION public.attach_reservation_gift_details();

-- Preserve payment history when cancelling: only the membership is cancelled;
-- this function does not refund or rewrite the original transaction.
CREATE OR REPLACE FUNCTION public.cancel_my_membership(
  p_reference_id text DEFAULT NULL,
  p_membership_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_uid text := nullif(auth.jwt() ->> 'sub', '');
  actor_email text := public.jwt_email();
  v_membership public.slot_memberships%ROWTYPE;
BEGIN
  IF actor_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_membership_id IS NULL AND coalesce(btrim(p_reference_id), '') = '' THEN
    RAISE EXCEPTION 'Provide either membershipId or referenceId.';
  END IF;

  IF p_membership_id IS NOT NULL THEN
    SELECT * INTO v_membership FROM public.slot_memberships
    WHERE id = p_membership_id FOR UPDATE;
  ELSE
    SELECT * INTO v_membership FROM public.slot_memberships
    WHERE reference_id = btrim(p_reference_id)
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found.'; END IF;
  IF v_membership.payer_user_id <> actor_uid AND v_membership.beneficiary_user_id <> actor_uid THEN
    RAISE EXCEPTION 'This membership does not belong to your account.';
  END IF;
  IF v_membership.status = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', true, 'persisted', true, 'alreadyCancelled', true);
  END IF;

  UPDATE public.slot_memberships
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_membership.id;
  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('membership_cancelled', actor_email,
    jsonb_build_object('membership_id', v_membership.id, 'reference_id', v_membership.reference_id,
                       'payment_status_preserved', v_membership.payment_status));
  RETURN jsonb_build_object('cancelled', true, 'persisted', true, 'alreadyCancelled', false);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_my_membership(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_membership(text, uuid) TO authenticated;

-- Firebase email ownership must be verified before a recipient can claim gifts.
-- Resolve memberships by verified email so recipients do not need an internal ID.
DROP FUNCTION IF EXISTS public.claim_gifted_membership(uuid);
CREATE OR REPLACE FUNCTION public.claim_my_gifted_memberships()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_uid text := nullif(auth.jwt() ->> 'sub', '');
  actor_email text := lower(btrim(coalesce(public.jwt_email(), '')));
  v_claimed_ids uuid[];
BEGIN
  IF actor_uid IS NULL OR actor_email = '' THEN
    RAISE EXCEPTION 'Sign in with the recipient email address first.';
  END IF;
  IF coalesce(auth.jwt() ->> 'email_verified', 'false') <> 'true' THEN
    RAISE EXCEPTION 'Verify your email address before claiming this subscription.';
  END IF;

  WITH eligible AS MATERIALIZED (
    SELECT id
    FROM public.slot_memberships
    WHERE lower(btrim(coalesce(recipient_email, ''))) = actor_email
      AND beneficiary_user_id = payer_user_id
      AND payer_user_id <> actor_uid
    FOR UPDATE
  ), claimed AS (
    UPDATE public.slot_memberships
    SET beneficiary_user_id = actor_uid, payer_user_id = actor_uid, updated_at = now()
    FROM eligible
    WHERE public.slot_memberships.id = eligible.id
    RETURNING public.slot_memberships.id
  ), audit AS (
    INSERT INTO public.admin_audit_log (action, actor_email, details)
    SELECT 'gift_membership_claimed', actor_email,
           jsonb_build_object('membership_id', id)
    FROM claimed
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_claimed_ids FROM claimed;
  RETURN jsonb_build_object('claimed_count', coalesce(cardinality(v_claimed_ids), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_gifted_memberships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_gifted_memberships() TO authenticated;

-- Keep the provider-verified fulfillment path authoritative. It checks the
-- reservation amount/currency, creates exactly one membership/transaction,
-- applies the reserved duration to its bill, and leaves auditability intact.
CREATE OR REPLACE FUNCTION public.fulfill_bachs_reservation(
  p_event_id text,
  p_reference_id text,
  p_verified_amount numeric,
  p_verified_currency text,
  p_provider_checkout_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res public.slot_reservations%ROWTYPE;
  v_result jsonb;
  v_membership_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.processed_webhook_events WHERE event_id = p_event_id) THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_processed');
  END IF;
  SELECT * INTO v_res FROM public.slot_reservations
  WHERE reference_id = p_reference_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'reservation_not_found', 'reference_id', p_reference_id));
    RETURN jsonb_build_object('success', false, 'status', 'reservation_not_found');
  END IF;
  IF v_res.status = 'failed' THEN RETURN jsonb_build_object('success', false, 'status', 'already_failed'); END IF;
  IF v_res.status = 'fulfilled' THEN RETURN jsonb_build_object('success', true, 'status', 'already_fulfilled'); END IF;
  IF v_res.status = 'expired' OR v_res.expires_at < now() THEN
    UPDATE public.slot_reservations SET status = 'expired', updated_at = now() WHERE id = v_res.id;
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'expired_reservation', 'reference_id', p_reference_id));
    RETURN jsonb_build_object('success', false, 'status', 'expired_reservation');
  END IF;
  IF v_res.expected_amount <> p_verified_amount OR
     upper(v_res.expected_currency) <> upper(p_verified_currency) THEN
    UPDATE public.slot_reservations SET status = 'failed', updated_at = now() WHERE id = v_res.id;
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'amount_or_currency_mismatch',
        'reference_id', p_reference_id, 'expected', v_res.expected_amount,
        'received', p_verified_amount, 'expected_currency', v_res.expected_currency,
        'received_currency', p_verified_currency));
    RETURN jsonb_build_object('success', false, 'status', 'amount_or_currency_mismatch');
  END IF;

  v_result := public.join_subscription_slot(
    v_res.product_id, v_res.payer_user_id, v_res.beneficiary_user_id,
    p_verified_amount, p_reference_id, v_res.preferred_group_code
  );
  v_membership_id := (v_result->>'membership_id')::uuid;
  UPDATE public.slot_memberships
  SET duration_months = v_res.duration_months
  WHERE id = v_membership_id;
  UPDATE public.membership_bills
  SET due_date = (now() + make_interval(months => v_res.duration_months))::date
  WHERE membership_id = v_membership_id;
  UPDATE public.payment_transactions
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'duration_months', v_res.duration_months,
    'recipient_name', v_res.recipient_name,
    'recipient_email', v_res.recipient_email
  )
  WHERE provider_reference = p_reference_id;
  UPDATE public.slot_reservations SET status = 'fulfilled', updated_at = now() WHERE id = v_res.id;
  INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
  VALUES (p_event_id, 'checkout.completed', 'bachs',
    jsonb_build_object('checkout_id', p_provider_checkout_id, 'reference_id', p_reference_id));
  RETURN jsonb_build_object('success', true, 'status', 'fulfilled',
    'membership_id', v_membership_id, 'slot_id', v_result->>'slot_id',
    'group_code', v_result->>'group_code');
END;
$$;

REVOKE ALL ON FUNCTION public.fulfill_bachs_reservation(text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_bachs_reservation(text, text, numeric, text, text) TO service_role;
