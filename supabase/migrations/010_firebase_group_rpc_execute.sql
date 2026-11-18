-- Firebase ID tokens are sent to Supabase through the client accessToken
-- callback, but they do not carry Supabase's `role: authenticated` claim.
-- PostgREST therefore executes these RPCs as `anon` even when the request
-- includes a valid Firebase identity. Keep the internal JWT and staff checks
-- in each SECURITY DEFINER function as the authorization boundary.

GRANT EXECUTE ON FUNCTION public.create_subscription_group(uuid, text, integer, text, text, text)
  TO anon;
GRANT EXECUTE ON FUNCTION public.update_subscription_group(uuid, text, integer, text, text)
  TO anon;
GRANT EXECUTE ON FUNCTION public.delete_subscription_group(uuid)
  TO anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(text)
  TO anon;
GRANT EXECUTE ON FUNCTION public.preview_group_by_code(text)
  TO anon;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid)
  TO anon;
GRANT EXECUTE ON FUNCTION public.set_group_leader(uuid, uuid)
  TO anon;
GRANT EXECUTE ON FUNCTION public.set_membership_payment(uuid, boolean)
  TO anon;
