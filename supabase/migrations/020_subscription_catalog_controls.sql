-- Admin controls for subscription ordering and explicit open/waitlist status.
BEGIN;

ALTER TABLE public.subscription_products
  ADD COLUMN IF NOT EXISTS display_order integer,
  ADD COLUMN IF NOT EXISTS availability_mode text NOT NULL DEFAULT 'auto';

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id)::integer - 1 AS position
  FROM public.subscription_products
)
UPDATE public.subscription_products AS product
SET display_order = ordered.position
FROM ordered
WHERE product.id = ordered.id AND product.display_order IS NULL;

ALTER TABLE public.subscription_products
  ALTER COLUMN display_order SET NOT NULL,
  ALTER COLUMN display_order SET DEFAULT 999999;

DO $$ BEGIN
  ALTER TABLE public.subscription_products
    ADD CONSTRAINT subscription_products_availability_mode_check
    CHECK (availability_mode IN ('auto', 'open', 'waitlist'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.assign_subscription_product_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.display_order IS NULL OR NEW.display_order = 999999 THEN
    SELECT coalesce(max(display_order) + 1, 0)
      INTO NEW.display_order
      FROM public.subscription_products;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_products_assign_order ON public.subscription_products;
CREATE TRIGGER subscription_products_assign_order
  BEFORE INSERT ON public.subscription_products
  FOR EACH ROW EXECUTE FUNCTION public.assign_subscription_product_order();

CREATE OR REPLACE FUNCTION public.set_subscription_product_availability(
  p_product_id uuid,
  p_availability text
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
    RAISE EXCEPTION 'Only staff admins can change subscription availability.';
  END IF;
  IF p_availability NOT IN ('open', 'waitlist') THEN
    RAISE EXCEPTION 'Availability must be open or waitlist.';
  END IF;

  UPDATE public.subscription_products
  SET availability_mode = p_availability, is_active = true
  WHERE id = p_product_id
  RETURNING * INTO v_product;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription plan not found.'; END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('product_availability_changed', actor,
    jsonb_build_object('product_id', v_product.id, 'availability', p_availability));
  RETURN to_jsonb(v_product);
END;
$$;

CREATE OR REPLACE FUNCTION public.move_subscription_product(
  p_product_id uuid,
  p_direction text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  v_current public.subscription_products%ROWTYPE;
  v_neighbor public.subscription_products%ROWTYPE;
BEGIN
  IF NOT public.is_staff_admin() THEN
    RAISE EXCEPTION 'Only staff admins can reorder subscription plans.';
  END IF;
  IF p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'Direction must be up or down.';
  END IF;

  LOCK TABLE public.subscription_products IN EXCLUSIVE MODE;
  SELECT * INTO v_current FROM public.subscription_products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription plan not found.'; END IF;

  IF p_direction = 'up' THEN
    SELECT * INTO v_neighbor FROM public.subscription_products
      WHERE (display_order, id) < (v_current.display_order, v_current.id)
      ORDER BY display_order DESC, id DESC LIMIT 1;
  ELSE
    SELECT * INTO v_neighbor FROM public.subscription_products
      WHERE (display_order, id) > (v_current.display_order, v_current.id)
      ORDER BY display_order, id LIMIT 1;
  END IF;

  IF v_neighbor.id IS NOT NULL THEN
    UPDATE public.subscription_products SET display_order = v_neighbor.display_order WHERE id = v_current.id;
    UPDATE public.subscription_products SET display_order = v_current.display_order WHERE id = v_neighbor.id;
    INSERT INTO public.admin_audit_log (action, actor_email, details)
    VALUES ('product_reordered', actor,
      jsonb_build_object('product_id', v_current.id, 'direction', p_direction, 'swapped_with', v_neighbor.id));
  END IF;

  RETURN jsonb_build_object('moved', v_neighbor.id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.set_subscription_product_availability(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_subscription_product(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_subscription_product_availability(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_subscription_product(uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
