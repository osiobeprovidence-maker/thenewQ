-- Ensure staff can see all join requests and memberships in the admin roster.
-- This is an additive policy repair; it does not modify or delete membership data.
DROP POLICY IF EXISTS "Staff can view all memberships" ON public.slot_memberships;
CREATE POLICY "Staff can view all memberships"
  ON public.slot_memberships
  FOR SELECT
  USING (public.is_staff_member());
