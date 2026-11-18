-- ==============================================================================
-- JOIN THE QUEUE — Migration 005 (ADDITIVE): app_settings for Support & Socials
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- ==============================================================================
-- Creates one key/value configuration table used by the public footer.
-- Strictly additive: no existing object is altered or dropped.
-- Firebase ID tokens are passed through as the Supabase bearer token, so the
-- custom claims arrive as top-level JWT keys (see migration 003 header).
-- Self-contained: no dependency on migration 003's helper functions.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Anyone can read app settings"
  ON public.app_settings FOR SELECT
  USING (true);

-- Only Super Admins may modify Support & Socials settings.
DROP POLICY IF EXISTS "Super admins can write app settings" ON public.app_settings;
CREATE POLICY "Super admins can write app settings"
  ON public.app_settings FOR ALL
  USING (coalesce((auth.jwt() ->> 'superAdmin')::boolean, false))
  WITH CHECK (coalesce((auth.jwt() ->> 'superAdmin')::boolean, false));

-- Keep updated_at fresh on every write.
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

-- Seed the previously hardcoded support contact so the public footer stays
-- identical to its pre-feature state until the Super Admin edits it.
-- Super Admins can change or disable this at any time from the console.
INSERT INTO public.app_settings (key, value)
VALUES (
  'support_socials',
  '{"whatsapp": {"enabled": true, "number": "2348000000000"}, "socials": []}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
