-- Track onboarding completion without blocking existing profile rows.
-- New accounts set this explicitly during profile creation.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
