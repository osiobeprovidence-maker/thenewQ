-- The live slots schema also requires a title. For managed groups, use the
-- validated group name as the slot title.

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
  owner_uid      text := nullif(auth.jwt() ->> 'sub', '');
  v_product      public.subscription_products%ROWTYPE;
  v_group_code   text;
  v_invite_link  text;
  v_slot         public.slots%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can create groups.';
  END IF;

  IF owner_uid IS NULL THEN
    RAISE EXCEPTION 'A valid Firebase user identity is required to create a group.';
  END IF;

  SELECT * INTO v_product
  FROM public.subscription_products
  WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected plan is not available or does not exist.';
  END IF;

  p_group_name := btrim(coalesce(p_group_name, ''));
  IF length(p_group_name) < 3 OR length(p_group_name) > 80 THEN
    RAISE EXCEPTION 'Group name must be between 3 and 80 characters.';
  END IF;

  IF p_capacity IS NULL OR p_capacity < 2 OR p_capacity > 200 THEN
    RAISE EXCEPTION 'Capacity must be between 2 and 200.';
  END IF;

  v_group_code := public.generate_group_code();

  IF p_invite_link IS NOT NULL AND btrim(p_invite_link) <> '' THEN
    v_invite_link := btrim(p_invite_link);
  ELSE
    v_invite_link := rtrim(coalesce(p_invite_base_url, 'https://jointhenewq.vercel.app'), '/')
                     || '/?join=' || v_group_code;
  END IF;

  INSERT INTO public.slots (
    owner_user_id, title, product_id, capacity, status,
    group_name, group_code, home_address, invite_link
  ) VALUES (
    owner_uid,
    p_group_name,
    p_product_id,
    p_capacity,
    'open',
    p_group_name,
    v_group_code,
    nullif(btrim(coalesce(p_home_address, '')), ''),
    v_invite_link
  )
  RETURNING * INTO v_slot;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES (
    'group_created', actor,
    jsonb_build_object(
      'group_name', v_slot.group_name,
      'group_code', v_slot.group_code,
      'product_id', v_slot.product_id,
      'capacity', v_slot.capacity
    )
  );

  RETURN to_jsonb(v_slot);
END;
$$;
