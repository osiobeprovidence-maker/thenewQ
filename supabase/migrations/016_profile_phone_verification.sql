-- Add support for optional phone verification on user profiles.
-- Safe to apply when phone_verified already exists.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false;

-- Refresh PostgREST's schema cache so the API recognizes the new column.
NOTIFY pgrst, 'reload schema';
