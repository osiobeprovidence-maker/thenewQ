-- Remove an admin listing from the user marketplace while preserving any
-- groups, memberships, reservations, and payment history that refer to it.
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_subscription_product_listing(
  p_product_id uuid
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
    RAISE EXCEPTION 'Only staff admins can remove subscription listings.';
  END IF;

  UPDATE public.subscription_products
  SET is_active = false
  WHERE id = p_product_id
  RETURNING * INTO v_product;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription listing not found.';
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('product_listing_removed', actor,
    jsonb_build_object('product_id', v_product.id, 'name', v_product.name));

  RETURN jsonb_build_object('removed', true, 'product_id', v_product.id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_subscription_product_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_subscription_product_listing(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
