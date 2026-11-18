-- Firebase-backed Supabase requests can arrive with the anon database role.
-- The RPC is SECURITY DEFINER and checks is_staff_admin() before any write.
GRANT EXECUTE ON FUNCTION public.create_subscription_product(text, numeric, text, text, text, text, text, jsonb)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
