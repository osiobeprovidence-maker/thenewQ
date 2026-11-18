-- Record staff-collected payments in an auditable ledger and expose genuine
-- pending checkout reservations to the admin financial dashboard.
BEGIN;

CREATE TABLE IF NOT EXISTS public.manual_payment_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.slot_memberships(id),
  payer_user_id text NOT NULL,
  slot_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'NGN',
  source text NOT NULL CHECK (source IN ('admin_marked_paid', 'support_collected')),
  status text NOT NULL DEFAULT 'collected' CHECK (status IN ('collected', 'voided')),
  reference_id text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_payment_entries_membership_idx
  ON public.manual_payment_entries (membership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manual_payment_entries_created_at_idx
  ON public.manual_payment_entries (created_at DESC);

ALTER TABLE public.manual_payment_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can view manual payment entries" ON public.manual_payment_entries;
CREATE POLICY "Staff can view manual payment entries"
  ON public.manual_payment_entries FOR SELECT
  USING (public.is_staff_admin());
GRANT SELECT ON public.manual_payment_entries TO anon, authenticated;

-- Preserve any older staff-recorded collection that already has an explicit
-- amount on the membership row. Rows with no recorded amount are not guessed.
INSERT INTO public.manual_payment_entries (
  membership_id, payer_user_id, slot_id, amount, currency, source,
  status, reference_id, metadata, recorded_by, created_at
)
SELECT
  sm.id,
  coalesce(sm.payer_user_id, sm.beneficiary_user_id),
  sm.slot_id,
  sm.amount_paid,
  upper(coalesce(p.currency, 'NGN')),
  'admin_marked_paid',
  'collected',
  'MAN-HIST-' || upper(substr(replace(sm.id::text, '-', ''), 1, 12)),
  jsonb_build_object('product_name', p.name, 'slot_id', s.id, 'backfilled_from_recorded_amount', true),
  NULL,
  coalesce(sm.updated_at, sm.joined_at, now())
FROM public.slot_memberships sm
JOIN public.slots s ON s.id = sm.slot_id
JOIN public.subscription_products p ON p.id = s.product_id
WHERE sm.payment_status = 'Paid'
  AND coalesce(sm.amount_paid, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_transactions tx
    WHERE tx.provider_reference = sm.reference_id
      AND lower(tx.status) IN ('success', 'succeeded', 'confirmed', 'paid')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.manual_payment_entries mpe WHERE mpe.membership_id = sm.id
  )
ON CONFLICT (reference_id) DO NOTHING;

DROP POLICY IF EXISTS "Staff can view checkout reservations" ON public.slot_reservations;
CREATE POLICY "Staff can view checkout reservations"
  ON public.slot_reservations FOR SELECT
  USING (public.is_staff_admin());
GRANT SELECT ON public.slot_reservations TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_membership_payment_with_ledger(
  p_membership_id uuid,
  p_paid boolean,
  p_source text DEFAULT 'admin_marked_paid'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_membership public.slot_memberships%ROWTYPE;
  v_slot_id uuid;
  v_product_name text;
  v_amount numeric;
  v_currency text;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can record member payments.';
  END IF;
  IF p_source NOT IN ('admin_marked_paid', 'support_collected') THEN
    RAISE EXCEPTION 'Payment source is invalid.';
  END IF;

  SELECT * INTO v_membership
  FROM public.slot_memberships
  WHERE id = p_membership_id AND status <> 'cancelled'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found or already cancelled.'; END IF;
  IF p_paid AND v_membership.approval_status = 'pending' THEN
    RAISE EXCEPTION 'Approve the member before recording payment.';
  END IF;

  IF p_paid AND coalesce(v_membership.payment_status, 'Unpaid') <> 'Paid' THEN
    SELECT s.id, p.name, p.monthly_price, p.currency
      INTO v_slot_id, v_product_name, v_amount, v_currency
    FROM public.slots s
    JOIN public.subscription_products p ON p.id = s.product_id
    WHERE s.id = v_membership.slot_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Could not find the member’s subscription plan.'; END IF;

    UPDATE public.slot_memberships
    SET payment_status = 'Paid', amount_paid = v_amount, updated_at = now()
    WHERE id = p_membership_id;

    -- Provider-confirmed checkouts already have a ledger row. Only create a
    -- manual entry when this payment was actually collected outside checkout.
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_transactions
      WHERE provider_reference = v_membership.reference_id
        AND lower(status) IN ('success', 'succeeded', 'confirmed', 'paid')
    ) AND NOT EXISTS (
      SELECT 1 FROM public.manual_payment_entries
      WHERE membership_id = p_membership_id AND status = 'collected'
    ) THEN
      INSERT INTO public.manual_payment_entries (
        membership_id, payer_user_id, slot_id, amount, currency, source,
        reference_id, metadata, recorded_by
      ) VALUES (
        p_membership_id,
        coalesce(v_membership.payer_user_id, v_membership.beneficiary_user_id),
        v_slot_id, v_amount, upper(coalesce(v_currency, 'NGN')), p_source,
        'MAN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
        jsonb_build_object('product_name', v_product_name, 'membership_id', p_membership_id, 'slot_id', v_slot_id),
        actor
      );
    END IF;
  ELSIF NOT p_paid AND coalesce(v_membership.payment_status, 'Unpaid') = 'Paid' THEN
    UPDATE public.slot_memberships
    SET payment_status = 'Unpaid', updated_at = now()
    WHERE id = p_membership_id;

    UPDATE public.manual_payment_entries
    SET status = 'voided'
    WHERE id = (
      SELECT id FROM public.manual_payment_entries
      WHERE membership_id = p_membership_id AND status = 'collected'
      ORDER BY created_at DESC LIMIT 1
    );
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('payment_status_set', actor,
    jsonb_build_object('membership_id', p_membership_id, 'paid', p_paid, 'source', p_source));
  RETURN jsonb_build_object('updated', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_membership_payment_with_ledger(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_membership_payment_with_ledger(uuid, boolean, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
