-- ==============================================================================
-- JOIN THE QUEUE — Migration 007: PAYMENT LAUNCH (SUPERSEDES 004)
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- Wrapped in one transaction; idempotent (re-runnable).
-- ==============================================================================
-- 1. Seeds the three subscription products (supersedes 004). Without these
--    the storefront stays in demo mode forever.
-- 2. Aligns staff visibility on slot_reservations with the new role model.
-- 3. Adds public.cancel_my_membership() — ownership-checked self-cancel with
--    an audit trail. Used by the storefront after the live checkout deploy.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. SEED SUBSCRIPTION PRODUCTS (from bundled catalog; ON CONFLICT DO NOTHING)
-- ==============================================================================

INSERT INTO public.subscription_products (
  id,
  name,
  description,
  monthly_price,
  currency,
  is_active,
  category,
  icon,
  eligibility_note,
  highlights
)
VALUES
  (
    'b1f2498e-8a0b-4a3d-bf4a-4b04c9bf7a01'::uuid,
    'Spotify Premium',
    'Enjoy your music experience with Premium.',
    800,
    'NGN',
    true,
    'Music Streaming',
    'spotify-wave',
    'Independent slot coordination for eligible accounts. JOIN THE QUEUE is not affiliated with or endorsed by Spotify.',
    '["Ad-free listening experience across mobile and desktop", "Offline downloads for playlists and podcasts", "Simple monthly slot coordination with clear confirmation steps"]'::jsonb
  ),
  (
    'b1f2498e-8a0b-4a3d-bf4a-4b04c9bf7a02'::uuid,
    'YouTube Premium',
    'Watch videos uninterrupted and stream background audio across devices.',
    1100,
    'NGN',
    true,
    'Video & Music',
    'play-stream',
    'Waitlist registration only. You will be notified when eligible slots open for the next cycle.',
    '["Ad-free video streaming and background playback", "Includes access to YouTube Music streaming", "Priority queue notification once the next batch opens"]'::jsonb
  ),
  (
    'b1f2498e-8a0b-4a3d-bf4a-4b04c9bf7a03'::uuid,
    'Apple Music',
    'Stream curated radio, spatial audio, and millions of tracks seamlessly.',
    1000,
    'NGN',
    true,
    'Lossless Audio',
    'music-disc',
    'Waitlist registration only. Slots open subject to regional account eligibility.',
    '["Lossless and spatial audio catalog support", "Curated playlists and live radio stations", "Early notification before general queue access opens"]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 2. STAFF VISIBILITY ON slot_reservations (role model v2)
-- ==============================================================================

DROP POLICY IF EXISTS "Admins can view all reservations" ON public.slot_reservations;
CREATE POLICY "Admins can view all reservations"
  ON public.slot_reservations FOR ALL
  USING (public.is_staff_admin())
  WITH CHECK (public.is_staff_admin());

-- ==============================================================================
-- 3. CANCEL_MY_MEMBERSHIP — self-service, ownership-checked, audit-logged
-- ==============================================================================

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
  IF actor_uid IS NULL OR actor_uid = '' THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF p_membership_id IS NULL AND (p_reference_id IS NULL OR btrim(p_reference_id) = '') THEN
    RAISE EXCEPTION 'Provide either membershipId or referenceId.';
  END IF;

  IF p_membership_id IS NOT NULL THEN
    SELECT * INTO v_membership
    FROM public.slot_memberships
    WHERE id = p_membership_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_membership
    FROM public.slot_memberships
    WHERE reference_id = btrim(p_reference_id)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found.';
  END IF;

  -- Ownership: caller must be payer or beneficiary
  IF v_membership.payer_user_id <> actor_uid AND v_membership.beneficiary_user_id <> actor_uid THEN
    RAISE EXCEPTION 'This membership does not belong to your account.';
  END IF;

  IF v_membership.status = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', true, 'persisted', true, 'alreadyCancelled', true);
  END IF;

  UPDATE public.slot_memberships
  SET status = 'cancelled', payment_status = 'Cancelled', updated_at = now()
  WHERE id = v_membership.id;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'membership_cancelled',
    actor_email,
    jsonb_build_object('membership_id', v_membership.id, 'reference_id', v_membership.reference_id)
  );

  RETURN jsonb_build_object('cancelled', true, 'persisted', true, 'alreadyCancelled', false);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_my_membership(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_membership(text, uuid) TO authenticated;

COMMIT;
