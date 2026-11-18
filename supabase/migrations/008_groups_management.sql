-- ==============================================================================
-- JOIN THE QUEUE — Migration 008: GROUPS & MEMBERSHIP MANAGEMENT
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- Wrapped in one transaction; additive only (no existing objects dropped).
-- ==============================================================================
-- Turns the `slots` table (and slot_memberships) into the real Group Management
-- system:
--   * Unique GFT-#### group codes, generated server-side with collision checks.
--   * Staff create/edit/delete groups through security-definer RPCs (admin+).
--   * Members join via an invite link / code with capacity + duplicate guards.
--   * Cancellations are soft (payment history is preserved forever).
--   * Role model v2 (public.is_staff_* from migration 006) — no Firebase claims.
-- ==============================================================================

BEGIN;

-- 1. Unique group code constraint (case-insensitive, active groups only)
CREATE UNIQUE INDEX IF NOT EXISTS slots_group_code_unique_key
  ON public.slots (upper(group_code))
  WHERE group_code IS NOT NULL;

-- 2. Staff visibility/management for memberships (role model v2)
--    Replaces the legacy Firebase-claim policy; own-row read remains intact.
DROP POLICY IF EXISTS "Admins can manage memberships" ON public.slot_memberships;
CREATE POLICY "Staff can manage memberships"
  ON public.slot_memberships FOR ALL
  USING (public.is_staff_admin())
  WITH CHECK (public.is_staff_admin());

-- 3. Group-code generator: GFT-####, looping until unique ------------------- 
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
    candidate := 'GFT-' || lpad(floor(random() * 9000 + 1000)::int::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.slots WHERE upper(group_code) = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

-- 4. Create a group (staff admin or super admin) ---------------------------
CREATE OR REPLACE FUNCTION public.create_subscription_group(
  p_product_id uuid,
  p_group_name text,
  p_capacity integer DEFAULT 6,
  p_home_address text DEFAULT '',
  p_invite_base_url text DEFAULT 'https://jointhenewq.vercel.app'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_product public.subscription_products%ROWTYPE;
  v_group_code text;
  v_invite_link text;
  v_slot public.slots%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can create groups.';
  END IF;

  SELECT * INTO v_product
  FROM public.subscription_products
  WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plan is not available.';
  END IF;

  p_group_name := btrim(coalesce(p_group_name, ''));
  IF length(p_group_name) < 3 OR length(p_group_name) > 80 THEN
    RAISE EXCEPTION 'Group name must be 3-80 characters.';
  END IF;

  IF p_capacity IS NULL OR p_capacity < 2 OR p_capacity > 200 THEN
    RAISE EXCEPTION 'Capacity must be between 2 and 200.';
  END IF;

  v_group_code := public.generate_group_code();
  v_invite_link := rtrim(p_invite_base_url, '/') || '/?join=' || v_group_code;

  INSERT INTO public.slots (
    product_id, capacity, status, group_name, group_code, home_address, invite_link
  ) VALUES (
    p_product_id, p_capacity, 'open', p_group_name, v_group_code,
    nullif(btrim(coalesce(p_home_address, '')), ''), v_invite_link
  )
  RETURNING * INTO v_slot;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('group_created', actor,
    jsonb_build_object('group_name', v_slot.group_name, 'group_code', v_slot.group_code, 'product_id', v_slot.product_id, 'capacity', v_slot.capacity));

  RETURN to_jsonb(v_slot);
END;
$$;

-- 5. Update a group (name / capacity / address). Code is immutable. ---------
CREATE OR REPLACE FUNCTION public.update_subscription_group(
  p_group_id uuid,
  p_group_name text DEFAULT NULL,
  p_capacity integer DEFAULT NULL,
  p_home_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_slot public.slots%ROWTYPE;
  v_member_count integer;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can edit groups.';
  END IF;

  SELECT * INTO v_slot FROM public.slots WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found.';
  END IF;

  IF p_group_name IS NOT NULL THEN
    p_group_name := btrim(p_group_name);
    IF length(p_group_name) < 3 OR length(p_group_name) > 80 THEN
      RAISE EXCEPTION 'Group name must be 3-80 characters.';
    END IF;
  END IF;

  IF p_capacity IS NOT NULL THEN
    SELECT count(*) INTO v_member_count
    FROM public.slot_memberships
    WHERE slot_id = p_group_id AND status <> 'cancelled';
    IF p_capacity < 2 OR p_capacity > 200 THEN
      RAISE EXCEPTION 'Capacity must be between 2 and 200.';
    END IF;
    IF p_capacity < v_member_count THEN
      RAISE EXCEPTION 'Capacity cannot be below current member count (%).', v_member_count;
    END IF;
  END IF;

  UPDATE public.slots
  SET group_name = COALESCE(p_group_name, group_name),
      capacity = COALESCE(p_capacity, capacity),
      home_address = CASE
        WHEN p_home_address IS NULL THEN home_address
        ELSE nullif(btrim(p_home_address), '')
      END,
      updated_at = now()
  WHERE id = p_group_id
  RETURNING * INTO v_slot;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('group_updated', actor,
    jsonb_build_object('group_id', v_slot.id, 'group_name', v_slot.group_name, 'group_code', v_slot.group_code));

  RETURN to_jsonb(v_slot);
END;
$$;

-- 6. Delete a group — only when it has ZERO membership records -------------
--    (payment history must never be destroyed).
CREATE OR REPLACE FUNCTION public.delete_subscription_group(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_count integer;
  v_slot public.slots%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can delete groups.';
  END IF;

  SELECT * INTO v_slot FROM public.slots WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Group not found.';
  END IF;

  SELECT count(*) INTO v_count FROM public.slot_memberships WHERE slot_id = p_group_id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Group has % member record(s). Remove all members first to preserve payment history.', v_count;
  END IF;

  DELETE FROM public.slots WHERE id = p_group_id;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('group_deleted', actor,
    jsonb_build_object('group_name', v_slot.group_name, 'group_code', v_slot.group_code, 'product_id', v_slot.product_id));

  RETURN jsonb_build_object('deleted', true, 'group_code', v_slot.group_code);
END;
$$;

-- 7. Join a group by invite code/link — any signed-in user -----------------
CREATE OR REPLACE FUNCTION public.join_group_by_code(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uemail text := public.jwt_email();
  uid text := nullif(auth.jwt() ->> 'sub', '');
  v_slot public.slots%ROWTYPE;
  v_product_name text;
  v_occupied integer;
  v_membership public.slot_memberships%ROWTYPE;
BEGIN
  IF uid IS NULL OR uid = '' THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  p_group_code := upper(btrim(coalesce(p_group_code, '')));
  IF p_group_code = '' THEN
    RAISE EXCEPTION 'Enter an invitation code.';
  END IF;

  SELECT * INTO v_slot
  FROM public.slots
  WHERE upper(group_code) = p_group_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No group found with code %', p_group_code;
  END IF;

  IF v_slot.status <> 'open' THEN
    RAISE EXCEPTION 'This group is not open for joining.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slot_memberships
    WHERE slot_id = v_slot.id AND status <> 'cancelled'
      AND (payer_user_id = uid OR beneficiary_user_id = uid)
  ) THEN
    RAISE EXCEPTION 'You are already in this group.';
  END IF;

  SELECT count(*) INTO v_occupied
  FROM public.slot_memberships
  WHERE slot_id = v_slot.id AND status <> 'cancelled';

  IF v_occupied >= v_slot.capacity THEN
    RAISE EXCEPTION 'This group is full.';
  END IF;

  SELECT name INTO v_product_name
  FROM public.subscription_products
  WHERE id = v_slot.product_id;

  INSERT INTO public.slot_memberships (
    slot_id, beneficiary_user_id, payer_user_id, status, is_leader,
    payment_status, reference_id, amount_paid, joined_at
  ) VALUES (
    v_slot.id, uid, uid, 'active', false,
    'Unpaid',
    'SELF-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
    0, now()
  )
  RETURNING * INTO v_membership;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('member_joined', coalesce(uemail, 'unknown'),
    jsonb_build_object('group_code', v_slot.group_code, 'group_name', v_slot.group_name, 'slot_id', v_slot.id));

  RETURN jsonb_build_object(
    'joined', true,
    'membership_id', v_membership.id,
    'slot_id', v_slot.id,
    'group_name', v_slot.group_name,
    'group_code', v_slot.group_code,
    'product_name', v_product_name,
    'payment_status', v_membership.payment_status,
    'home_address', v_slot.home_address
  );
END;
$$;

-- 8. Preview a group before joining (any signed-in user)
CREATE OR REPLACE FUNCTION public.preview_group_by_code(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot public.slots%ROWTYPE;
  v_product_name text;
  v_currency text;
  v_occupied integer;
  v_remaining integer;
BEGIN
  IF auth.jwt() ->> 'sub' IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  p_group_code := upper(btrim(coalesce(p_group_code, '')));

  SELECT * INTO v_slot
  FROM public.slots
  WHERE upper(group_code) = p_group_code AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open group found with code %', p_group_code;
  END IF;

  SELECT name, currency INTO v_product_name, v_currency
  FROM public.subscription_products
  WHERE id = v_slot.product_id;

  SELECT count(*) INTO v_occupied
  FROM public.slot_memberships
  WHERE slot_id = v_slot.id AND status <> 'cancelled';

  v_remaining := GREATEST(v_slot.capacity - v_occupied, 0);

  RETURN jsonb_build_object(
    'group_id', v_slot.id,
    'group_name', v_slot.group_name,
    'group_code', v_slot.group_code,
    'product_name', v_product_name,
    'capacity', v_slot.capacity,
    'occupied', v_occupied,
    'remaining', v_remaining,
    'full', v_remaining = 0,
    'home_address', v_slot.home_address
  );
END;
$$;

-- 9. Remove a member (staff admin) — soft-cancel, history preserved --------
CREATE OR REPLACE FUNCTION public.remove_group_member(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_membership public.slot_memberships%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can remove members.';
  END IF;

  SELECT * INTO v_membership FROM public.slot_memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found.';
  END IF;

  UPDATE public.slot_memberships
  SET status = 'cancelled', is_leader = false
  WHERE id = p_membership_id;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('member_removed', actor,
    jsonb_build_object('membership_id', v_membership.id, 'slot_id', v_membership.slot_id));

  RETURN jsonb_build_object('removed', true);
END;
$$;

-- 10. Set / clear group leader (staff admin)
CREATE OR REPLACE FUNCTION public.set_group_leader(p_group_id uuid, p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_count integer;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can change leaders.';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.slot_memberships
  WHERE id = p_membership_id AND slot_id = p_group_id AND status <> 'cancelled';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'That member does not belong to this group.';
  END IF;

  UPDATE public.slot_memberships
  SET is_leader = (id = p_membership_id)
  WHERE slot_id = p_group_id AND status <> 'cancelled';

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('leader_set', actor,
    jsonb_build_object('group_id', p_group_id, 'membership_id', p_membership_id));

  RETURN jsonb_build_object('updated', true);
END;
$$;

-- 11. Toggle a member between Paid / Unpaid (staff admin)
CREATE OR REPLACE FUNCTION public.set_membership_payment(
  p_membership_id uuid,
  p_paid boolean
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
    RAISE EXCEPTION 'Member not found.';
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('payment_status_set', actor,
    jsonb_build_object('membership_id', p_membership_id, 'paid', p_paid));

  RETURN jsonb_build_object('updated', true);
END;
$$;

-- 12. Revoke / grant privileges --------------------------------------------
REVOKE ALL ON FUNCTION public.generate_group_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_subscription_group(uuid, text, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_subscription_group(uuid, text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_subscription_group(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_group_by_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_group_by_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_group_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_group_leader(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_membership_payment(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_subscription_group(uuid, text, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_subscription_group(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_subscription_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_group_by_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_group_leader(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_membership_payment(uuid, boolean) TO authenticated;

COMMIT;
