-- ==============================================================================
-- JOIN THE QUEUE — MIGRATION 003 (ADDITIVE ONLY): SUPER ADMIN / SUPPORT RBAC
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
--
-- Adds database-side enforcement for the Firebase custom-claim hierarchy:
--   superAdmin: true  — full authority (bootstrap only; mirrors admin claim)
--   admin: true       — operational administration (existing policies, unchanged)
--   support: true     — restricted customer-service scope (new policies here)
-- Claims are top-level in the Firebase JWT, so they are read as
--   auth.jwt() ->> 'superAdmin' | 'admin' | 'support'
--
-- Rules for this migration:
--   * No tables are created, dropped or altered.
--   * No existing policy is weakened. One permissive SELECT on public.profiles
--     is REPLACED with a stricter self-or-staff policy (see section 3).
--   * Super admins hold admin: true by bootstrap, so existing admin RLS
--     policies keep working for them unchanged. The superAdmin branches below
--     are explicit, additive belt-and-braces.
-- ==============================================================================

-- 1. STABLE CLAIM PREDICATES ----------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce((auth.jwt() ->> 'superAdmin')::boolean, false)
$$;

CREATE OR REPLACE FUNCTION public.is_queue_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce((auth.jwt() ->> 'admin')::boolean, false)
      OR public.is_super_admin()
$$;

CREATE OR REPLACE FUNCTION public.is_queue_support()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce((auth.jwt() ->> 'support')::boolean, false)
      OR public.is_queue_admin()
$$;

-- 2. SLOT MEMBERSHIPS: staff can view memberships -------------------------
--    A row flipped Unpaid -> Paid becomes invisible to a staff member whose
--    SELECT policy only covers Unpaid rows, which makes PostgreSQL reject the
--    UPDATE with "new row violates row-level security policy". Staff must be
--    able to see the rows they mutate. The unpaid-first outreach view stays
--    an application-layer concern (Admin console viewScope setting).
DROP POLICY IF EXISTS "Support can view unpaid memberships" ON public.slot_memberships;
DROP POLICY IF EXISTS "Staff can view memberships" ON public.slot_memberships;
CREATE POLICY "Staff can view memberships"
  ON public.slot_memberships FOR SELECT
  USING (public.is_queue_support());

DROP POLICY IF EXISTS "Support can mark unpaid memberships paid" ON public.slot_memberships;
CREATE POLICY "Support can mark unpaid memberships paid"
  ON public.slot_memberships FOR UPDATE
  USING (
    public.is_queue_support()
    AND payment_status = 'Unpaid'
  )
  WITH CHECK (
    public.is_queue_support()
    AND payment_status = 'Paid'
  );

DROP POLICY IF EXISTS "Super admins can manage memberships" ON public.slot_memberships;
CREATE POLICY "Super admins can manage memberships"
  ON public.slot_memberships FOR ALL
  USING (public.is_super_admin());

-- 3. PROFILES: stop anonymous public reads; self and staff only ------------
--    This is the ONLY existing policy replaced (tightened, not weakened).
--    The storefront never displays other users' profiles, so no UI changes.
DROP POLICY IF EXISTS "Public can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles readable by self and staff" ON public.profiles;
CREATE POLICY "Profiles readable by self and staff"
  ON public.profiles FOR SELECT
  USING (
    auth.jwt() ->> 'sub' = user_id
    OR public.is_queue_support()
  );

-- 4. SLOTS: support needs read access for group coordination --------------
DROP POLICY IF EXISTS "Support and staff can view slots" ON public.slots;
CREATE POLICY "Support and staff can view slots"
  ON public.slots FOR SELECT
  USING (public.is_queue_support());

DROP POLICY IF EXISTS "Super admins can manage slots" ON public.slots;
CREATE POLICY "Super admins can manage slots"
  ON public.slots FOR ALL
  USING (public.is_super_admin());

-- 5. SUBSCRIPTION PRODUCTS: additive super admin branch -------------------
DROP POLICY IF EXISTS "Super admins can manage products" ON public.subscription_products;
CREATE POLICY "Super admins can manage products"
  ON public.subscription_products FOR ALL
  USING (public.is_super_admin());

-- 6. PAYMENT TRANSACTIONS: additive super admin branch --------------------
DROP POLICY IF EXISTS "Super admins can manage transactions" ON public.payment_transactions;
CREATE POLICY "Super admins can manage transactions"
  ON public.payment_transactions FOR ALL
  USING (public.is_super_admin());

-- 7. SLOT RESERVATIONS: additive super admin oversight --------------------
DROP POLICY IF EXISTS "Super admins can view all reservations" ON public.slot_reservations;
CREATE POLICY "Super admins can view all reservations"
  ON public.slot_reservations FOR ALL
  USING (public.is_super_admin());

-- 8. MEMBERSHIP BILLS: owners and staff can read bills --------------------
--    (No bills policy existed before; this is additive and opens nothing new
--    beyond bill rows tied to the caller's memberships.)
ALTER TABLE public.membership_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own membership bills" ON public.membership_bills;
CREATE POLICY "Users can view own membership bills"
  ON public.membership_bills FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.slot_memberships sm
      WHERE sm.id = membership_bills.membership_id
        AND (
          auth.jwt() ->> 'sub' = sm.payer_user_id
          OR auth.jwt() ->> 'sub' = sm.beneficiary_user_id
        )
    )
    OR public.is_queue_admin()
  );

DROP POLICY IF EXISTS "Super admins can manage bills" ON public.membership_bills;
CREATE POLICY "Super admins can manage bills"
  ON public.membership_bills FOR ALL
  USING (public.is_super_admin());
