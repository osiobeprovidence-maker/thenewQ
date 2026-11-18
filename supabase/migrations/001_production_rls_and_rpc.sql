-- ==============================================================================
-- JOIN THE QUEUE — PRODUCTION DATABASE MIGRATION 001 (HARDENED)
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- ==============================================================================

-- 1. ENHANCE profiles TABLE (ensure all profile fields match Firebase user info)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- 2. ENHANCE subscription_products TABLE (ensure category, icon, highlights, eligibility)
ALTER TABLE public.subscription_products
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'Music',
  ADD COLUMN IF NOT EXISTS icon text DEFAULT 'music-disc',
  ADD COLUMN IF NOT EXISTS eligibility_note text DEFAULT 'Independent slot coordination listed by Admin. Verify eligibility before joining.',
  ADD COLUMN IF NOT EXISTS highlights jsonb DEFAULT '["Admin-coordinated subscription slot access", "Receive group invite link and address in your Profile Inbox", "Manage monthly or multi-month renewals anytime"]'::jsonb;

-- 3. ENHANCE slots TABLE (group naming, address, invite link coordination)
ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS group_name text,
  ADD COLUMN IF NOT EXISTS group_code text,
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS invite_link text;

-- 4. ENHANCE slot_memberships TABLE
ALTER TABLE public.slot_memberships
  ADD COLUMN IF NOT EXISTS is_leader boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'Paid',
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_note text;

-- 5. ENHANCE slot_invitations TABLE
ALTER TABLE public.slot_invitations
  ADD COLUMN IF NOT EXISTS invite_code text,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_contact text;

-- 6. INDEXES FOR PERFORMANCE & CONCURRENCY
CREATE INDEX IF NOT EXISTS idx_slots_product_id ON public.slots(product_id);
CREATE INDEX IF NOT EXISTS idx_slot_memberships_slot_id ON public.slot_memberships(slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_memberships_beneficiary ON public.slot_memberships(beneficiary_user_id);
CREATE INDEX IF NOT EXISTS idx_slot_memberships_payer ON public.slot_memberships(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_payer ON public.payment_transactions(payer_user_id);
CREATE INDEX IF NOT EXISTS idx_slot_invitations_slot ON public.slot_invitations(slot_id);

-- 7. ATOMIC SLOT JOIN RPC (INTERNAL HELPER - CALLED ONLY BY TRUSTED BACKEND SERVICE_ROLE)
CREATE OR REPLACE FUNCTION public.join_subscription_slot(
  p_product_id uuid,
  p_payer_user_id text,
  p_beneficiary_user_id text,
  p_amount numeric,
  p_reference_id text,
  p_preferred_group_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_record RECORD;
  v_slot_found boolean := false;
  v_occupied_count integer := 0;
  v_product RECORD;
  v_membership_id uuid;
  v_bill_id uuid;
  v_tx_id uuid;
  v_group_code text;
BEGIN
  -- Verify product exists and is active
  SELECT * INTO v_product FROM public.subscription_products WHERE id = p_product_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription product not found or inactive';
  END IF;

  -- Attempt to lock and find an available slot (preferred group first)
  IF p_preferred_group_code IS NOT NULL AND trim(p_preferred_group_code) <> '' THEN
    SELECT s.* INTO v_slot_record
    FROM public.slots s
    WHERE s.product_id = p_product_id
      AND upper(s.group_code) = upper(trim(p_preferred_group_code))
      AND s.status = 'open'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    v_slot_found := FOUND;
    IF v_slot_found THEN
      SELECT count(*) INTO v_occupied_count
      FROM public.slot_memberships sm
      WHERE sm.slot_id = v_slot_record.id AND sm.status <> 'cancelled';
    END IF;
  END IF;

  -- Fall back to any open slot with capacity
  IF NOT v_slot_found THEN
    FOR v_slot_record IN
      SELECT s.*
      FROM public.slots s
      WHERE s.product_id = p_product_id
        AND s.status = 'open'
      FOR UPDATE SKIP LOCKED
    LOOP
      SELECT count(*) INTO v_occupied_count
      FROM public.slot_memberships sm
      WHERE sm.slot_id = v_slot_record.id AND sm.status <> 'cancelled';

      IF v_occupied_count < v_slot_record.capacity THEN
        v_slot_found := true;
        EXIT; -- Found open slot with room
      END IF;
    END LOOP;
  END IF;

  -- If no open slot exists or all are full, dynamically create a new slot
  IF NOT v_slot_found OR v_occupied_count >= v_slot_record.capacity THEN
    v_group_code := upper(substring(md5(random()::text) from 1 for 6));
    INSERT INTO public.slots (
      product_id,
      capacity,
      status,
      group_name,
      group_code,
      home_address,
      invite_link
    ) VALUES (
      p_product_id,
      6,
      'open',
      v_product.name || ' Group ' || v_group_code,
      v_group_code,
      'Coordinated Slot Access',
      'https://jointhequeue.app/invite/' || v_group_code
    )
    RETURNING * INTO v_slot_record;
    v_slot_found := true;
    v_occupied_count := 0;
  END IF;

  -- Create the slot membership
  INSERT INTO public.slot_memberships (
    slot_id,
    beneficiary_user_id,
    payer_user_id,
    status,
    is_leader,
    payment_status,
    reference_id,
    amount_paid,
    joined_at
  ) VALUES (
    v_slot_record.id,
    p_beneficiary_user_id,
    p_payer_user_id,
    'active',
    (SELECT count(*) = 0 FROM public.slot_memberships WHERE slot_id = v_slot_record.id AND status <> 'cancelled'),
    'Paid',
    p_reference_id,
    p_amount,
    now()
  )
  RETURNING id INTO v_membership_id;

  -- Create membership bill record
  INSERT INTO public.membership_bills (
    membership_id,
    amount_due,
    currency,
    status,
    due_date
  ) VALUES (
    v_membership_id,
    p_amount,
    v_product.currency,
    'paid',
    now() + interval '1 month'
  )
  RETURNING id INTO v_bill_id;

  -- Record payment transaction
  INSERT INTO public.payment_transactions (
    bill_id,
    payer_user_id,
    amount,
    currency,
    status,
    provider,
    provider_reference,
    metadata
  ) VALUES (
    v_bill_id,
    p_payer_user_id,
    p_amount,
    v_product.currency,
    'success',
    'verified_checkout',
    p_reference_id,
    jsonb_build_object('product_name', v_product.name, 'slot_id', v_slot_record.id)
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership_id,
    'slot_id', v_slot_record.id,
    'group_name', v_slot_record.group_name,
    'group_code', v_slot_record.group_code,
    'home_address', v_slot_record.home_address,
    'invite_link', v_slot_record.invite_link,
    'reference_id', p_reference_id
  );
END;
$$;

-- LOCK DOWN join_subscription_slot FROM PUBLIC OR AUTHENTICATED ACCESS
REVOKE EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.join_subscription_slot(uuid, text, text, numeric, text, text) TO service_role;

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- NOTE: In Firebase third-party JWT integration, custom claims are top-level in the JWT payload (e.g. auth.jwt() ->> 'admin')

-- Profiles: Users can view all active profiles, but only insert/update their own Firebase UID
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view profiles" ON public.profiles;
CREATE POLICY "Public can view profiles"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'sub' = user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (
    auth.jwt() ->> 'sub' = user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );

-- Subscription Products: Public can read active products, only admins can mutate
ALTER TABLE public.subscription_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active products" ON public.subscription_products;
CREATE POLICY "Public can read active products"
  ON public.subscription_products FOR SELECT
  USING (is_active = true OR (auth.jwt() ->> 'admin')::boolean = true);

DROP POLICY IF EXISTS "Admins can manage products" ON public.subscription_products;
CREATE POLICY "Admins can manage products"
  ON public.subscription_products FOR ALL
  USING ((auth.jwt() ->> 'admin')::boolean = true);

-- Slots: Public can view open slots, only admins can directly mutate
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view slots" ON public.slots;
CREATE POLICY "Public can view slots"
  ON public.slots FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can manage slots" ON public.slots;
CREATE POLICY "Admins can manage slots"
  ON public.slots FOR ALL
  USING ((auth.jwt() ->> 'admin')::boolean = true);

-- Slot Memberships: Members can view memberships where they are payer or beneficiary
ALTER TABLE public.slot_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own memberships" ON public.slot_memberships;
CREATE POLICY "Users can view own memberships"
  ON public.slot_memberships FOR SELECT
  USING (
    auth.jwt() ->> 'sub' = beneficiary_user_id
    OR auth.jwt() ->> 'sub' = payer_user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );

DROP POLICY IF EXISTS "Admins can manage memberships" ON public.slot_memberships;
CREATE POLICY "Admins can manage memberships"
  ON public.slot_memberships FOR ALL
  USING ((auth.jwt() ->> 'admin')::boolean = true);

-- Payment Transactions: Users can view their own transactions, admins can view all
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.payment_transactions;
CREATE POLICY "Users can view own transactions"
  ON public.payment_transactions FOR SELECT
  USING (
    auth.jwt() ->> 'sub' = payer_user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );

DROP POLICY IF EXISTS "Admins can manage transactions" ON public.payment_transactions;
CREATE POLICY "Admins can manage transactions"
  ON public.payment_transactions FOR ALL
  USING ((auth.jwt() ->> 'admin')::boolean = true);

-- Slot Invitations: Users can view invitations they sent or received
ALTER TABLE public.slot_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view related invitations" ON public.slot_invitations;
CREATE POLICY "Users can view related invitations"
  ON public.slot_invitations FOR SELECT
  USING (
    auth.jwt() ->> 'sub' = inviter_user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );

DROP POLICY IF EXISTS "Users can create invitations" ON public.slot_invitations;
CREATE POLICY "Users can create invitations"
  ON public.slot_invitations FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'sub' = inviter_user_id
    OR (auth.jwt() ->> 'admin')::boolean = true
  );
