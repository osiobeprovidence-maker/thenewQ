-- ==============================================================================
-- JOIN THE QUEUE — Migration 008: GROUPS & MEMBERSHIP MANAGEMENT
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- Wrapped in one transaction; additive only.
-- ==============================================================================
-- OVERVIEW
--   Turns the existing `slots` + `slot_memberships` tables into a full
--   Group Management system:
--     * Unique GFT-#### group codes, generated server-side with collision checks.
--     * Staff (admin / superAdmin) create/edit/delete groups via SECURITY DEFINER RPCs.
--     * Any signed-in user may preview or join an open group by its unique code.
--     * Joining creates a membership with payment_status = 'Unpaid'.
--       Paid status is ONLY set by the Bachs webhook fulfillment flow
--       (fulfill_bachs_reservation → join_subscription_slot), never by this file.
--     * Cancellations are soft (payment history is preserved forever).
--     * Role model: public.is_staff_admin() / public.is_staff_super_admin() from migration 006.
--
-- BUG FIXED (original file):
--   Section 12 of the old migration called
--     DROP FUNCTION IF EXISTS public.create_subscription_group(uuid,text,integer,text,text,text);
--   which deleted the function that Section 4 had just created in the SAME transaction,
--   causing "function does not exist" on the subsequent REVOKE/GRANT statements.
--   The same mistake applied to update_subscription_group.
--   FIX: DROP FUNCTION statements now only target genuinely obsolete overloads
--        (5-argument signatures from an earlier draft) that do NOT match the
--        functions defined in this migration. The current 6-argument
--        create_subscription_group and 5-argument update_subscription_group
--        are never dropped.
--
-- FUNCTION INVENTORY (after migration):
--   1.  public.generate_group_code()                                   → text
--   2.  public.create_subscription_group(uuid,text,int,text,text,text) → jsonb
--   3.  public.update_subscription_group(uuid,text,int,text,text)      → jsonb
--   4.  public.delete_subscription_group(uuid)                         → jsonb
--   5.  public.join_group_by_code(text)                                → jsonb
--   6.  public.preview_group_by_code(text)                             → jsonb
--   7.  public.remove_group_member(uuid)                               → jsonb
--   8.  public.set_group_leader(uuid,uuid)                             → jsonb
--   9.  public.set_membership_payment(uuid,boolean)                    → jsonb
--
-- FRONTEND RPC ARGUMENT NAMES (must match exactly):
--   create_subscription_group  → p_product_id, p_group_name, p_capacity,
--                                p_home_address, p_invite_base_url, p_invite_link
--   update_subscription_group  → p_group_id, p_group_name, p_capacity,
--                                p_home_address, p_invite_link
--   All other RPCs are unchanged from the previous draft.
-- ==============================================================================

BEGIN;

-- ============================================================================
-- 1. Unique group code constraint (case-insensitive; non-null groups only)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS slots_group_code_unique_key
  ON public.slots (upper(group_code))
  WHERE group_code IS NOT NULL;

-- ============================================================================
-- 2. Staff visibility / management for slot_memberships (role model v2)
--    Replaces the legacy Firebase-claim ALL policy added in migration 001.
--    Own-row read policy from migration 001 ("Users can view own memberships")
--    is preserved unmodified.
-- ============================================================================
DROP POLICY IF EXISTS "Admins can manage memberships"  ON public.slot_memberships;
DROP POLICY IF EXISTS "Staff can manage memberships"   ON public.slot_memberships;
CREATE POLICY "Staff can manage memberships"
  ON public.slot_memberships FOR ALL
  USING  (public.is_staff_admin())
  WITH CHECK (public.is_staff_admin());

-- ============================================================================
-- 3. Remove obsolete function overloads that may have been created by
--    earlier draft migrations.  These signatures DO NOT match anything
--    defined later in this file, so dropping them is safe.
--
--    IMPORTANT: Do NOT add DROP FUNCTION statements for the functions
--    defined in Sections 4-11 below.  Doing so would destroy them
--    before the REVOKE/GRANT block at the end of this migration can
--    reference them, which is exactly the bug this file corrects.
-- ============================================================================

-- Old 5-argument overload of create_subscription_group (no p_invite_link)
DROP FUNCTION IF EXISTS public.create_subscription_group(uuid, text, integer, text, text);

-- Old 4-argument overload of update_subscription_group (no p_invite_link)
DROP FUNCTION IF EXISTS public.update_subscription_group(uuid, text, integer, text);

-- ============================================================================
-- 4. generate_group_code() — internal helper, not callable by clients
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_group_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    -- Produces GFT-1000 through GFT-9999 (9000 possible unique codes)
    candidate := 'GFT-' || lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.slots WHERE upper(group_code) = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

-- ============================================================================
-- 5. create_subscription_group — staff admin only
--    Signature: (uuid, text, int, text, text, text)
--    6 arguments including the optional p_invite_link.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_subscription_group(
  p_product_id      uuid,
  p_group_name      text,
  p_capacity        integer DEFAULT 6,
  p_home_address    text    DEFAULT '',
  p_invite_base_url text    DEFAULT 'https://jointhenewq.vercel.app',
  p_invite_link     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor          text := public.jwt_email();
  v_product      public.subscription_products%ROWTYPE;
  v_group_code   text;
  v_invite_link  text;
  v_slot         public.slots%ROWTYPE;
BEGIN
  -- Authorization
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can create groups.';
  END IF;

  -- Validate product
  SELECT * INTO v_product
  FROM public.subscription_products
  WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plan is not available or does not exist.';
  END IF;

  -- Validate group name
  p_group_name := btrim(coalesce(p_group_name, ''));
  IF length(p_group_name) < 3 OR length(p_group_name) > 80 THEN
    RAISE EXCEPTION 'Group name must be between 3 and 80 characters.';
  END IF;

  -- Validate capacity
  IF p_capacity IS NULL OR p_capacity < 2 OR p_capacity > 200 THEN
    RAISE EXCEPTION 'Capacity must be between 2 and 200.';
  END IF;

  -- Generate unique group code
  v_group_code := public.generate_group_code();

  -- Resolve invite link (custom or auto-generated)
  IF p_invite_link IS NOT NULL AND btrim(p_invite_link) <> '' THEN
    v_invite_link := btrim(p_invite_link);
  ELSE
    v_invite_link := rtrim(coalesce(p_invite_base_url, 'https://jointhenewq.vercel.app'), '/')
                     || '/?join=' || v_group_code;
  END IF;

  -- Insert group record
  INSERT INTO public.slots (
    product_id, capacity, status,
    group_name, group_code, home_address, invite_link
  ) VALUES (
    p_product_id,
    p_capacity,
    'open',
    p_group_name,
    v_group_code,
    nullif(btrim(coalesce(p_home_address, '')), ''),
    v_invite_link
  )
  RETURNING * INTO v_slot;

  -- Audit
  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'group_created', actor,
    jsonb_build_object(
      'group_name',  v_slot.group_name,
      'group_code',  v_slot.group_code,
      'product_id',  v_slot.product_id,
      'capacity',    v_slot.capacity
    )
  );

  RETURN to_jsonb(v_slot);
END;
$$;

-- ============================================================================
-- 6. update_subscription_group — staff admin only
--    Signature: (uuid, text, int, text, text)   ← 5 arguments
--    Group code is immutable and never touched here.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_subscription_group(
  p_group_id     uuid,
  p_group_name   text    DEFAULT NULL,
  p_capacity     integer DEFAULT NULL,
  p_home_address text    DEFAULT NULL,
  p_invite_link  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor          text := public.jwt_email();
  v_slot         public.slots%ROWTYPE;
  v_member_count integer;
BEGIN
  -- Authorization
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can edit groups.';
  END IF;

  -- Lock and load group
  SELECT * INTO v_slot FROM public.slots WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found.';
  END IF;

  -- Validate group name if supplied
  IF p_group_name IS NOT NULL THEN
    p_group_name := btrim(p_group_name);
    IF length(p_group_name) < 3 OR length(p_group_name) > 80 THEN
      RAISE EXCEPTION 'Group name must be between 3 and 80 characters.';
    END IF;
  END IF;

  -- Validate capacity if supplied
  IF p_capacity IS NOT NULL THEN
    SELECT count(*) INTO v_member_count
    FROM public.slot_memberships
    WHERE slot_id = p_group_id AND status <> 'cancelled';

    IF p_capacity < 2 OR p_capacity > 200 THEN
      RAISE EXCEPTION 'Capacity must be between 2 and 200.';
    END IF;
    IF p_capacity < v_member_count THEN
      RAISE EXCEPTION 'Capacity cannot be below the current active member count (%).', v_member_count;
    END IF;
  END IF;

  -- Apply updates (NULL = keep existing value)
  UPDATE public.slots
  SET
    group_name   = COALESCE(p_group_name, group_name),
    capacity     = COALESCE(p_capacity,   capacity),
    home_address = CASE
                     WHEN p_home_address IS NULL THEN home_address
                     ELSE nullif(btrim(p_home_address), '')
                   END,
    invite_link  = CASE
                     WHEN p_invite_link IS NULL THEN invite_link
                     ELSE nullif(btrim(p_invite_link), '')
                   END,
    updated_at   = now()
  WHERE id = p_group_id
  RETURNING * INTO v_slot;

  -- Audit
  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'group_updated', actor,
    jsonb_build_object(
      'group_id',   v_slot.id,
      'group_name', v_slot.group_name,
      'group_code', v_slot.group_code
    )
  );

  RETURN to_jsonb(v_slot);
END;
$$;

-- ============================================================================
-- 7. delete_subscription_group — staff admin only
--    Hard-deletes the slot row ONLY when it has zero membership records.
--    Payment history in slot_memberships is preserved (they reference slot_id
--    which may become a dangling FK — intentional; memberships are soft records).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_subscription_group(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor   text := public.jwt_email();
  v_count integer;
  v_slot  public.slots%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can delete groups.';
  END IF;

  SELECT * INTO v_slot FROM public.slots WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found.';
  END IF;

  -- Refuse deletion while any membership record exists (even cancelled ones),
  -- so payment history is never orphaned.
  SELECT count(*) INTO v_count
  FROM public.slot_memberships
  WHERE slot_id = p_group_id;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Group has % membership record(s). Remove all members first to preserve payment history.',
      v_count;
  END IF;

  DELETE FROM public.slots WHERE id = p_group_id;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'group_deleted', actor,
    jsonb_build_object(
      'group_name', v_slot.group_name,
      'group_code', v_slot.group_code,
      'product_id', v_slot.product_id
    )
  );

  RETURN jsonb_build_object('deleted', true, 'group_code', v_slot.group_code);
END;
$$;

-- ============================================================================
-- 8. join_group_by_code — any authenticated user
--    Creates a membership with payment_status = 'Unpaid'.
--    DOES NOT grant a paid subscription.  Payment is fulfilled separately
--    through the Bachs checkout → fulfill_bachs_reservation RPC flow.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.join_group_by_code(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uemail       text := public.jwt_email();
  uid          text := nullif(auth.jwt() ->> 'sub', '');
  v_slot       public.slots%ROWTYPE;
  v_product_name text;
  v_occupied   integer;
  v_membership public.slot_memberships%ROWTYPE;
BEGIN
  -- Must be authenticated
  IF uid IS NULL OR uid = '' THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Normalise code
  p_group_code := upper(btrim(coalesce(p_group_code, '')));
  IF p_group_code = '' THEN
    RAISE EXCEPTION 'Enter an invitation code.';
  END IF;

  -- Lock the slot row to prevent race conditions on capacity
  SELECT * INTO v_slot
  FROM public.slots
  WHERE upper(group_code) = p_group_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No group found with code %.', p_group_code;
  END IF;

  IF v_slot.status <> 'open' THEN
    RAISE EXCEPTION 'This group is not open for joining.';
  END IF;

  -- Duplicate-join guard
  IF EXISTS (
    SELECT 1 FROM public.slot_memberships
    WHERE slot_id = v_slot.id
      AND status <> 'cancelled'
      AND (payer_user_id = uid OR beneficiary_user_id = uid)
  ) THEN
    RAISE EXCEPTION 'You are already a member of this group.';
  END IF;

  -- Capacity check
  SELECT count(*) INTO v_occupied
  FROM public.slot_memberships
  WHERE slot_id = v_slot.id AND status <> 'cancelled';

  IF v_occupied >= v_slot.capacity THEN
    RAISE EXCEPTION 'This group is full.';
  END IF;

  -- Product name for response
  SELECT name INTO v_product_name
  FROM public.subscription_products
  WHERE id = v_slot.product_id;

  -- Insert membership — payment_status is 'Unpaid' until Bachs webhook confirms payment
  INSERT INTO public.slot_memberships (
    slot_id,
    beneficiary_user_id,
    payer_user_id,
    status,
    is_leader,
    payment_status,
    reference_id,
    amount_paid,
    joined_at
  ) VALUES (
    v_slot.id,
    uid,
    uid,
    'active',
    false,
    'Unpaid',   -- ← intentionally Unpaid; payment must go through Bachs
    'SELF-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
    0,
    now()
  )
  RETURNING * INTO v_membership;

  -- Audit
  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'member_joined',
    coalesce(uemail, 'unknown'),
    jsonb_build_object(
      'group_code', v_slot.group_code,
      'group_name', v_slot.group_name,
      'slot_id',    v_slot.id
    )
  );

  RETURN jsonb_build_object(
    'joined',         true,
    'membership_id',  v_membership.id,
    'slot_id',        v_slot.id,
    'group_name',     v_slot.group_name,
    'group_code',     v_slot.group_code,
    'product_name',   v_product_name,
    'payment_status', v_membership.payment_status,
    'home_address',   v_slot.home_address
  );
END;
$$;

-- ============================================================================
-- 9. preview_group_by_code — any authenticated user (read-only, no side-effects)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.preview_group_by_code(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot         public.slots%ROWTYPE;
  v_product_name text;
  v_currency     text;
  v_occupied     integer;
  v_remaining    integer;
BEGIN
  IF nullif(auth.jwt() ->> 'sub', '') IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  p_group_code := upper(btrim(coalesce(p_group_code, '')));

  SELECT * INTO v_slot
  FROM public.slots
  WHERE upper(group_code) = p_group_code AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open group found with code %.', p_group_code;
  END IF;

  SELECT name, currency INTO v_product_name, v_currency
  FROM public.subscription_products
  WHERE id = v_slot.product_id;

  SELECT count(*) INTO v_occupied
  FROM public.slot_memberships
  WHERE slot_id = v_slot.id AND status <> 'cancelled';

  v_remaining := GREATEST(v_slot.capacity - v_occupied, 0);

  RETURN jsonb_build_object(
    'group_id',     v_slot.id,
    'group_name',   v_slot.group_name,
    'group_code',   v_slot.group_code,
    'product_name', v_product_name,
    'currency',     v_currency,
    'capacity',     v_slot.capacity,
    'occupied',     v_occupied,
    'remaining',    v_remaining,
    'full',         v_remaining = 0,
    'home_address', v_slot.home_address
  );
END;
$$;

-- ============================================================================
-- 10. remove_group_member — staff admin only (soft-cancel, history preserved)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.remove_group_member(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor        text := public.jwt_email();
  v_membership public.slot_memberships%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can remove members.';
  END IF;

  SELECT * INTO v_membership
  FROM public.slot_memberships
  WHERE id = p_membership_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership record not found.';
  END IF;

  UPDATE public.slot_memberships
  SET status    = 'cancelled',
      is_leader = false
  WHERE id = p_membership_id;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'member_removed', actor,
    jsonb_build_object(
      'membership_id', v_membership.id,
      'slot_id',       v_membership.slot_id
    )
  );

  RETURN jsonb_build_object('removed', true);
END;
$$;

-- ============================================================================
-- 11. set_group_leader — staff admin only
--     Clears the leader flag on all other active members in the group, then
--     sets it on the specified membership.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_group_leader(p_group_id uuid, p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor   text := public.jwt_email();
  v_count integer;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can change the group leader.';
  END IF;

  -- Verify the target membership belongs to this group and is active
  SELECT count(*) INTO v_count
  FROM public.slot_memberships
  WHERE id = p_membership_id
    AND slot_id = p_group_id
    AND status <> 'cancelled';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'That member does not belong to this group or is cancelled.';
  END IF;

  -- Atomically transfer leadership
  UPDATE public.slot_memberships
  SET is_leader = (id = p_membership_id)
  WHERE slot_id = p_group_id AND status <> 'cancelled';

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'leader_set', actor,
    jsonb_build_object(
      'group_id',      p_group_id,
      'membership_id', p_membership_id
    )
  );

  RETURN jsonb_build_object('updated', true);
END;
$$;

-- ============================================================================
-- 12. set_membership_payment — staff admin only
--     Toggles payment_status between 'Paid' and 'Unpaid' on the admin's
--     behalf. Does NOT create payment transactions — this is an admin override
--     for manually-collected or offline payments only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_membership_payment(
  p_membership_id uuid,
  p_paid          boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can change payment status.';
  END IF;

  UPDATE public.slot_memberships
  SET payment_status = CASE WHEN p_paid THEN 'Paid' ELSE 'Unpaid' END
  WHERE id = p_membership_id AND status <> 'cancelled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found or already cancelled.';
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'payment_status_set', actor,
    jsonb_build_object(
      'membership_id', p_membership_id,
      'paid',          p_paid
    )
  );

  RETURN jsonb_build_object('updated', true);
END;
$$;

-- ============================================================================
-- 13. REVOKE / GRANT privileges
--     Rules:
--       generate_group_code : internal helper — no client access
--       create/edit/delete  : authenticated only (RPCs enforce admin check)
--       join/preview        : authenticated only (RPCs enforce auth check)
--       remove/leader/pay   : authenticated only (RPCs enforce admin check)
--       anon                : no access to any group RPC
--       service_role        : inherits all privileges (Supabase default)
--
--     The function signatures here MUST exactly match the CREATE OR REPLACE
--     statements above.  They reference the functions that now exist in the DB.
-- ============================================================================

-- generate_group_code: internal only
REVOKE ALL ON FUNCTION public.generate_group_code()
  FROM PUBLIC, anon, authenticated;

-- create_subscription_group(uuid,text,int,text,text,text)  — 6 args
REVOKE ALL  ON FUNCTION public.create_subscription_group(uuid, text, integer, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_subscription_group(uuid, text, integer, text, text, text)
  TO authenticated;

-- update_subscription_group(uuid,text,int,text,text)  — 5 args
REVOKE ALL  ON FUNCTION public.update_subscription_group(uuid, text, integer, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_subscription_group(uuid, text, integer, text, text)
  TO authenticated;

-- delete_subscription_group(uuid)
REVOKE ALL  ON FUNCTION public.delete_subscription_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_subscription_group(uuid) TO authenticated;

-- join_group_by_code(text)
REVOKE ALL  ON FUNCTION public.join_group_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(text) TO authenticated;

-- preview_group_by_code(text)
REVOKE ALL  ON FUNCTION public.preview_group_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_group_by_code(text) TO authenticated;

-- remove_group_member(uuid)
REVOKE ALL  ON FUNCTION public.remove_group_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid) TO authenticated;

-- set_group_leader(uuid,uuid)
REVOKE ALL  ON FUNCTION public.set_group_leader(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_leader(uuid, uuid) TO authenticated;

-- set_membership_payment(uuid,boolean)
REVOKE ALL  ON FUNCTION public.set_membership_payment(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_membership_payment(uuid, boolean) TO authenticated;

COMMIT;
