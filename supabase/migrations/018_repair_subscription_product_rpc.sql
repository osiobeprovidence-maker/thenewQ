-- Restore the exact subscription product RPC signature expected by the app,
-- grant it to signed-in users (the function performs the staff check itself),
-- and refresh PostgREST's schema cache.
BEGIN;

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

REVOKE ALL ON FUNCTION public.create_subscription_product(text, numeric, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_subscription_product(text, numeric, text, text, text, text, text, jsonb) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
COMMIT;
