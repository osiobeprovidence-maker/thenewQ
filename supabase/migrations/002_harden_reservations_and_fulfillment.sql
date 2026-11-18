-- ==============================================================================
-- JOIN THE QUEUE — MIGRATION 002: HARDENED RESERVATIONS & WEBHOOK FULFILLMENT
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- ==============================================================================

-- 1. PENDING RESERVATIONS TABLE
-- Tracks short-lived slot reservations initiated during checkout.
-- Prevents client-driven activation and locks product pricing authoritatively.
CREATE TABLE IF NOT EXISTS public.slot_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.subscription_products(id),
  payer_user_id text NOT NULL,
  beneficiary_user_id text NOT NULL,
  expected_amount numeric NOT NULL,
  expected_currency text NOT NULL,
  reference_id text NOT NULL,
  preferred_group_code text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'fulfilled', 'expired', 'failed'
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure reference_id is unique on slot_reservations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_slot_reservations_reference_id'
  ) THEN
    -- In case of duplicate references in legacy rows, remove older duplicates first
    DELETE FROM public.slot_reservations a
    USING public.slot_reservations b
    WHERE a.id < b.id AND a.reference_id = b.reference_id;

    ALTER TABLE public.slot_reservations
      ADD CONSTRAINT uq_slot_reservations_reference_id UNIQUE (reference_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_slot_reservations_ref ON public.slot_reservations(reference_id);
CREATE INDEX IF NOT EXISTS idx_slot_reservations_status ON public.slot_reservations(status);

-- 2. SECURE WEBHOOK EVENT AUDIT TABLE IN SUPABASE
-- Ensures duplicate webhook deliveries are rejected at database level.
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  provider text NOT NULL DEFAULT 'bachs',
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

-- 3. UNIQUE CONSTRAINT ON MEMBERSHIP REFERENCE TO PREVENT DUPLICATE FULFILLMENT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_slot_memberships_reference_id'
  ) THEN
    -- Deduplicate any pre-existing duplicates gracefully before applying constraint
    DELETE FROM public.slot_memberships a
    USING public.slot_memberships b
    WHERE a.id < b.id 
      AND a.reference_id IS NOT NULL 
      AND a.reference_id = b.reference_id;

    ALTER TABLE public.slot_memberships
      ADD CONSTRAINT uq_slot_memberships_reference_id UNIQUE (reference_id);
  END IF;
END $$;

-- 4. HARDEN RPC PERMISSIONS
REVOKE EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) TO service_role;

-- 5. ATOMIC FULFILLMENT RPC (Callable ONLY by backend service_role / webhook handler)
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
SET search_path = public
AS $$
DECLARE
  v_res RECORD;
  v_result jsonb;
BEGIN
  -- Idempotency check: Reject already processed webhook event
  IF EXISTS (SELECT 1 FROM public.processed_webhook_events WHERE event_id = p_event_id) THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_processed');
  END IF;

  -- Lock reservation record
  SELECT * INTO v_res
  FROM public.slot_reservations
  WHERE reference_id = p_reference_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'reservation_not_found', 'reference_id', p_reference_id));
    RETURN jsonb_build_object('success', false, 'status', 'reservation_not_found');
  END IF;

  IF v_res.status = 'failed' THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_failed');
  END IF;

  IF v_res.status = 'fulfilled' THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_fulfilled');
  END IF;

  IF v_res.status = 'expired' OR v_res.expires_at < now() THEN
    UPDATE public.slot_reservations SET status = 'expired', updated_at = now() WHERE id = v_res.id;
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'expired_reservation', 'reference_id', p_reference_id));
    RETURN jsonb_build_object('success', false, 'status', 'expired_reservation');
  END IF;

  -- Strict validation of amount and currency against authoritative database record
  IF v_res.expected_amount <> p_verified_amount THEN
    UPDATE public.slot_reservations SET status = 'failed', updated_at = now() WHERE id = v_res.id;
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'amount_mismatch',
        'reference_id', p_reference_id,
        'expected', v_res.expected_amount, 'got', p_verified_amount));
    RETURN jsonb_build_object('success', false, 'status', 'amount_mismatch');
  END IF;

  IF upper(v_res.expected_currency) <> upper(p_verified_currency) THEN
    UPDATE public.slot_reservations SET status = 'failed', updated_at = now() WHERE id = v_res.id;
    INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
    VALUES (p_event_id, 'checkout.completed', 'bachs',
      jsonb_build_object('rejected', true, 'reason', 'currency_mismatch',
        'reference_id', p_reference_id,
        'expected', v_res.expected_currency, 'got', p_verified_currency));
    RETURN jsonb_build_object('success', false, 'status', 'currency_mismatch');
  END IF;

  -- Execute slot assignment atomically
  v_result := public.join_subscription_slot(
    v_res.product_id,
    v_res.payer_user_id,
    v_res.beneficiary_user_id,
    p_verified_amount,
    p_reference_id,
    v_res.preferred_group_code
  );

  -- Update reservation status to fulfilled
  UPDATE public.slot_reservations
  SET status = 'fulfilled', updated_at = now()
  WHERE id = v_res.id;

  -- Record event to prevent duplicate execution
  INSERT INTO public.processed_webhook_events (event_id, event_type, provider, payload)
  VALUES (
    p_event_id,
    'checkout.completed',
    'bachs',
    jsonb_build_object('checkout_id', p_provider_checkout_id, 'reference_id', p_reference_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'fulfilled',
    'membership_id', v_result->>'membership_id',
    'slot_id', v_result->>'slot_id',
    'group_code', v_result->>'group_code'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fulfill_bachs_reservation(text, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fulfill_bachs_reservation(text, text, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fulfill_bachs_reservation(text, text, numeric, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_bachs_reservation(text, text, numeric, text, text) TO service_role;

-- 6. RLS POLICIES FOR RESERVATIONS TABLE
ALTER TABLE public.slot_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reservations" ON public.slot_reservations;
CREATE POLICY "Users can view own reservations"
  ON public.slot_reservations FOR SELECT
  USING (
    auth.jwt() ->> 'sub' = payer_user_id
    OR auth.jwt() ->> 'sub' = beneficiary_user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );

DROP POLICY IF EXISTS "Admins can view all reservations" ON public.slot_reservations;
CREATE POLICY "Admins can view all reservations"
  ON public.slot_reservations FOR ALL
  USING ((auth.jwt() ->> 'admin')::boolean = true);
