-- New invite-code joins wait for admin approval. Existing memberships remain
-- approved so this change does not alter the state of current members.
ALTER TABLE public.slot_memberships
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_payment_due_date date;

ALTER TABLE public.slot_memberships
  DROP CONSTRAINT IF EXISTS slot_memberships_approval_status_check;
ALTER TABLE public.slot_memberships
  ADD CONSTRAINT slot_memberships_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE OR REPLACE FUNCTION public.join_group_by_code(p_group_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uemail         text := public.jwt_email();
  uid            text := nullif(auth.jwt() ->> 'sub', '');
  v_slot         public.slots%ROWTYPE;
  v_product_name text;
  v_occupied     integer;
  v_membership   public.slot_memberships%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
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
    RAISE EXCEPTION 'No group found with code %.', p_group_code;
  END IF;
  IF v_slot.status <> 'open' THEN
    RAISE EXCEPTION 'This group is not open for joining.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slot_memberships
    WHERE slot_id = v_slot.id
      AND status <> 'cancelled'
      AND approval_status <> 'rejected'
      AND (payer_user_id = uid OR beneficiary_user_id = uid)
  ) THEN
    RAISE EXCEPTION 'You are already a member of this group.';
  END IF;

  SELECT count(*) INTO v_occupied
  FROM public.slot_memberships
  WHERE slot_id = v_slot.id
    AND status <> 'cancelled'
    AND approval_status <> 'rejected';
  IF v_occupied >= v_slot.capacity THEN
    RAISE EXCEPTION 'This group is full.';
  END IF;

  SELECT name INTO v_product_name
  FROM public.subscription_products
  WHERE id = v_slot.product_id;

  INSERT INTO public.slot_memberships (
    slot_id, beneficiary_user_id, payer_user_id, status, is_leader,
    payment_status, reference_id, amount_paid, joined_at, approval_status
  ) VALUES (
    v_slot.id, uid, uid, 'active', false, 'Unpaid',
    'SELF-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
    0, now(), 'pending'
  )
  RETURNING * INTO v_membership;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'member_joined', coalesce(uemail, 'unknown'),
    jsonb_build_object(
      'group_code', v_slot.group_code,
      'group_name', v_slot.group_name,
      'slot_id', v_slot.id,
      'membership_id', v_membership.id,
      'approval_status', 'pending'
    )
  );

  RETURN jsonb_build_object(
    'joined', true,
    'membership_id', v_membership.id,
    'slot_id', v_slot.id,
    'group_name', v_slot.group_name,
    'group_code', v_slot.group_code,
    'product_name', v_product_name,
    'payment_status', v_membership.payment_status,
    'approval_status', v_membership.approval_status,
    'home_address', v_slot.home_address
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_group_member(p_membership_id uuid)
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
    RAISE EXCEPTION 'Only staff admins can approve group members.';
  END IF;

  UPDATE public.slot_memberships
  SET approval_status = 'approved',
      approved_at = coalesce(approved_at, now()),
      first_payment_due_date = coalesce(
        first_payment_due_date,
        timezone('Africa/Lagos', now())::date + 1
      )
  WHERE id = p_membership_id
    AND status <> 'cancelled'
    AND approval_status = 'pending'
  RETURNING * INTO v_membership;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending membership not found or already processed.';
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'member_approved', actor,
    jsonb_build_object(
      'membership_id', v_membership.id,
      'slot_id', v_membership.slot_id,
      'approved_at', v_membership.approved_at,
      'first_payment_due_date', v_membership.first_payment_due_date
    )
  );

  RETURN jsonb_build_object(
    'approved', true,
    'approved_at', v_membership.approved_at,
    'first_payment_due_date', v_membership.first_payment_due_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_group_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_group_member(uuid) TO anon, authenticated;
