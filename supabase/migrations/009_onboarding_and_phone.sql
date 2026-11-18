-- ==============================================================================
-- JOIN THE QUEUE — Migration 009: USER ONBOARDING & PHONE UNIQUENESS
-- Target Supabase Project: tmdrwlmsmxatnvxqwgmn
-- ==============================================================================
-- 1. Ensure onboarding_completed column exists on profiles table.
--    Default is false for new users.
--    Existing users who already have a phone number are grandfathered as true.
-- ==============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false;

-- Grandfather existing accounts that already have phone numbers recorded
UPDATE public.profiles
SET onboarding_completed = true,
    phone_verified = true
WHERE phone IS NOT NULL AND trim(phone) <> '' AND onboarding_completed IS NOT true;

-- Ensure uniqueness on verified phone numbers to prevent multiple accounts using the same number
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles (trim(phone))
  WHERE phone IS NOT NULL AND trim(phone) <> '';

-- Allow users to update their own onboarding_completed status and phone
-- Existing RLS UPDATE policy:
--   auth.jwt() ->> 'sub' = user_id OR (auth.jwt() ->> 'admin')::boolean = true
-- This already permits users to update their own row.
