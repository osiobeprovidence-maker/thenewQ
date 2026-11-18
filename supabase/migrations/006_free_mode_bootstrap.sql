-- ==============================================================================
-- JOIN THE QUEUE — Migration 006: FREE-MODE STAFF ROLES + SUPPORT & SOCIALS
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- Supersedes (never-applied) migration 005. Safe to run once, wrapped in a transaction.
-- ==============================================================================
-- WHY THIS EXISTS
-- The Firebase Functions backend requires the paid Blaze plan and production
-- functions return 404 today. This migration moves the ENTIRE staff security
-- model into Supabase Postgres, which the app already uses on the free tier:
--   * Firebase Auth = identity layer (unchanged, free).
--   * Supabase reads the Firebase JWT via third-party auth (bearer token).
--   * Role truth = public.staff_members, enforced by FORCE ROW LEVEL SECURITY.
--   * The two designated initial super admins self-grant via public.claim_super_admin().
--   * Everyone else gets access only via an email-bound pending invitation +
--     public.redeem_admin_invitation().
--   * Every role change is written to public.admin_audit_log (super admin read).
-- No Firebase custom claims are consulted anywhere. Zero Blaze plan needed.
--
-- NEW OBJECTS: staff_members, bootstrap_allowlist, admin_invitations,
--              admin_audit_log, app_settings, jwt_email/is_staff_* helpers,
--              claim_super_admin / redeem_admin_invitation / create_admin_invitation /
--              revoke_admin_invitation / revoke_staff_role RPCs.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. TABLES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.staff_members (
  email text PRIMARY KEY CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('superAdmin', 'admin', 'support')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bootstrap_allowlist (
  email text PRIMARY KEY CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('admin', 'support')),
  note text,
  invited_by text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  actor_email text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE public.staff_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.bootstrap_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootstrap_allowlist FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.admin_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_invitations  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.app_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings       FORCE  ROW LEVEL SECURITY;

-- bootstrap_allowlist: never readable by anyone, not even super admins
-- (security-definer RPCs read it server-side).
REVOKE ALL ON public.bootstrap_allowlist FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- 2. JWT HELPERS  (auth.jwt() = the caller's Firebase ID token)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.jwt_email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
$$;

-- SECURITY DEFINER so policies can check role without re-entering RLS (avoids recursion).
CREATE OR REPLACE FUNCTION public.is_staff_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE email = public.jwt_email() AND role = 'superAdmin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE email = public.jwt_email() AND role IN ('admin', 'superAdmin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members WHERE email = public.jwt_email()
  );
$$;

-- ==============================================================================
-- 3. ROW LEVEL SECURITY POLICIES
-- ==============================================================================

-- staff_members: users read their own row; super admins read everything.
-- No direct write policies — role changes go through RPCs only.
DROP POLICY IF EXISTS "Users read their own staff row" ON public.staff_members;
CREATE POLICY "Users read their own staff row"
  ON public.staff_members FOR SELECT
  USING (email = public.jwt_email());

DROP POLICY IF EXISTS "Super admins read all staff rows" ON public.staff_members;
CREATE POLICY "Super admins read all staff rows"
  ON public.staff_members FOR SELECT
  USING (public.is_staff_super_admin());

-- admin_invitations: invitee reads their own invitation; super admins read/write all.
DROP POLICY IF EXISTS "Invitee reads own invitations" ON public.admin_invitations;
CREATE POLICY "Invitee reads own invitations"
  ON public.admin_invitations FOR SELECT
  USING (lower(email) = public.jwt_email());

DROP POLICY IF EXISTS "Super admins manage invitations" ON public.admin_invitations;
CREATE POLICY "Super admins manage invitations"
  ON public.admin_invitations FOR ALL
  USING (public.is_staff_super_admin())
  WITH CHECK (public.is_staff_super_admin());

-- admin_audit_log: super admins read; nobody writes directly (RPCs only).
DROP POLICY IF EXISTS "Super admins read audit log" ON public.admin_audit_log;
CREATE POLICY "Super admins read audit log"
  ON public.admin_audit_log FOR SELECT
  USING (public.is_staff_super_admin());

-- app_settings: world-readable (public footer); super admins write only.
DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Anyone can read app settings"
  ON public.app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Super admins write app settings" ON public.app_settings;
CREATE POLICY "Super admins write app settings"
  ON public.app_settings FOR ALL
  USING (public.is_staff_super_admin())
  WITH CHECK (public.is_staff_super_admin());

-- keep updated_at fresh on every app_settings write
CREATE OR REPLACE FUNCTION public.touch_app_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_touch ON public.app_settings;
CREATE TRIGGER trg_app_settings_touch
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_app_settings_updated_at();

-- ==============================================================================
-- 4. BOOTSTRAP ALLOWLIST (the same two designated emails as the codebase)
-- ==============================================================================

INSERT INTO public.bootstrap_allowlist (email) VALUES
  ('riderezzy@gmail.com'),
  ('osiobeprovidence@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- ==============================================================================
-- 5. RPCS (security definer — server-side authority for every role change)
-- ==============================================================================

-- One-time self-service claim for designated accounts only.
CREATE OR REPLACE FUNCTION public.claim_super_admin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uemail text := public.jwt_email();
BEGIN
  IF uemail IS NULL OR uemail = '' THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bootstrap_allowlist WHERE email = uemail) THEN
    RAISE EXCEPTION 'This account is not authorized for super admin access.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.staff_members WHERE email = uemail) THEN
    UPDATE public.staff_members SET role = 'superAdmin' WHERE email = uemail;
    INSERT INTO public.admin_audit_log (action, actor_email, details)
    VALUES ('bootstrap_super_admin', uemail, jsonb_build_object('alreadyGranted', true));
    RETURN jsonb_build_object('granted', true, 'alreadyGranted', true);
  END IF;

  INSERT INTO public.staff_members (email, role) VALUES (uemail, 'superAdmin');
  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('bootstrap_super_admin', uemail, jsonb_build_object('alreadyGranted', false));
  RETURN jsonb_build_object('granted', true, 'alreadyGranted', false);
END;
$$;

-- Redeem an email-bound pending invitation; grants the invited role.
CREATE OR REPLACE FUNCTION public.redeem_admin_invitation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uemail text := public.jwt_email();
  invite public.admin_invitations%ROWTYPE;
BEGIN
  IF uemail IS NULL OR uemail = '' THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT * INTO invite
  FROM public.admin_invitations
  WHERE email = uemail AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending staff invitation found for %', uemail;
  END IF;

  UPDATE public.admin_invitations
  SET status = 'redeemed', redeemed_at = now()
  WHERE id = invite.id;

  INSERT INTO public.staff_members (email, role)
  VALUES (uemail, invite.role)
  ON CONFLICT (email) DO UPDATE
    SET role = CASE WHEN public.staff_members.role = 'superAdmin' THEN 'superAdmin' ELSE invite.role END;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('invitation_redeemed', uemail, jsonb_build_object('role', invite.role, 'note', invite.note));

  RETURN jsonb_build_object('granted', true, 'role', invite.role);
END;
$$;

-- Super admins invite staff by email + role. No codes, no e-mail sent by the platform;
-- invitee redeems by signing in with the invited address.
CREATE OR REPLACE FUNCTION public.create_admin_invitation(p_email text, p_role text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  new_invite public.admin_invitations%ROWTYPE;
  existing public.admin_invitations%ROWTYPE;
BEGIN
  IF NOT public.is_staff_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can invite staff.';
  END IF;

  p_email := lower(trim(coalesce(p_email, '')));
  IF p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' THEN
    RAISE EXCEPTION 'Enter a valid email address.';
  END IF;
  IF p_role NOT IN ('admin', 'support') THEN
    RAISE EXCEPTION 'Role must be admin or support.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_members WHERE email = p_email) THEN
    RAISE EXCEPTION 'That account already has staff access.';
  END IF;

  SELECT * INTO existing
  FROM public.admin_invitations
  WHERE email = p_email AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('reused', true, 'invitation', to_jsonb(existing));
  END IF;

  INSERT INTO public.admin_invitations (email, role, note, invited_by)
  VALUES (p_email, p_role, NULLIF(left(coalesce(p_note, ''), 280), ''), actor)
  RETURNING * INTO new_invite;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('invitation_created', actor, jsonb_build_object('targetEmail', p_email, 'role', p_role));

  RETURN jsonb_build_object('reused', false, 'invitation', to_jsonb(new_invite));
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_admin_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  target public.admin_invitations%ROWTYPE;
BEGIN
  IF NOT public.is_staff_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can revoke invitations.';
  END IF;

  UPDATE public.admin_invitations
  SET status = 'revoked'
  WHERE id = p_invitation_id AND status = 'pending'
  RETURNING * INTO target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already redeemed.';
  END IF;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('invitation_revoked', actor, jsonb_build_object('targetEmail', target.email, 'role', target.role));

  RETURN jsonb_build_object('revoked', true);
END;
$$;

-- Strip an admin/support role. The superAdmin role can NEVER be revoked here.
CREATE OR REPLACE FUNCTION public.revoke_staff_role(p_target_email text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor text := public.jwt_email();
  target text := lower(trim(coalesce(p_target_email, '')));
BEGIN
  IF NOT public.is_staff_super_admin() THEN
    RAISE EXCEPTION 'Only super admins can revoke staff access.';
  END IF;
  IF p_role = 'superAdmin' THEN
    RAISE EXCEPTION 'The super admin role cannot be revoked through this function.';
  END IF;
  IF p_role NOT IN ('admin', 'support') THEN
    RAISE EXCEPTION 'Role must be admin or support.';
  END IF;

  DELETE FROM public.staff_members WHERE email = target AND role = p_role;

  INSERT INTO public.admin_audit_log (action, actor_email, details)
  VALUES ('access_revoked', actor, jsonb_build_object('targetEmail', target, 'role', p_role));

  RETURN jsonb_build_object('revoked', true);
END;
$$;

-- Lock down function privileges: authenticated may execute; anon may not.
REVOKE ALL ON FUNCTION public.jwt_email() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff_member() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_super_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_admin_invitation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_admin_invitation(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_admin_invitation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_staff_role(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.jwt_email() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_super_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_member() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_admin_invitation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_invitation(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_admin_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_staff_role(text, text) TO authenticated;

-- ==============================================================================
-- 6. SEED SUPPORT & SOCIALS (public footer reads this at runtime)
-- ==============================================================================

INSERT INTO public.app_settings (key, value)
VALUES (
  'support_socials',
  '{"whatsapp": {"enabled": true, "number": "2348000000000"}, "socials": []}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
