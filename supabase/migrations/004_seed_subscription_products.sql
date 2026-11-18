-- ==============================================================================
-- JOIN THE QUEUE — Migration 004: SEED SUBSCRIPTION PRODUCTS (DO NOT APPLY WITHOUT GO-AHEAD)
-- ==============================================================================
-- Idempotent seed: inserts the three bundled plans from src/data/subscriptions.ts
-- using ON CONFLICT DO NOTHING, so re-running it does not overwrite production values.
-- DO NOT run until production cutover is approved.
-- ==============================================================================

INSERT INTO public.subscription_products (
  id,
  name,
  description,
  monthly_price,
  currency,
  is_active,
  category,
  icon,
  eligibility_note,
  highlights
)
VALUES
  (
    'b1f2498e-8a0b-4a3d-bf4a-4b04c9bf7a01'::uuid, -- Spotify Premium
    'Spotify Premium',
    'Enjoy your music experience with Premium.',
    800,
    'NGN',
    true,
    'Music Streaming',
    'spotify-wave',
    'Independent slot coordination for eligible accounts. JOIN THE QUEUE is not affiliated with or endorsed by Spotify.',
    '["Ad-free listening experience across mobile and desktop", "Offline downloads for playlists and podcasts", "Simple monthly slot coordination with clear confirmation steps"]'::jsonb
  ),
  (
    'b1f2498e-8a0b-4a3d-bf4a-4b04c9bf7a02'::uuid, -- YouTube Premium
    'YouTube Premium',
    'Watch videos uninterrupted and stream background audio across devices.',
    1100,
    'NGN',
    true,
    'Video & Music',
    'play-stream',
    'Waitlist registration only. You will be notified when eligible slots open for the next cycle.',
    '["Ad-free video streaming and background playback", "Includes access to YouTube Music streaming", "Priority queue notification once the next batch opens"]'::jsonb
  ),
  (
    'b1f2498e-8a0b-4a3d-bf4a-4b04c9bf7a03'::uuid, -- Apple Music
    'Apple Music',
    'Stream curated radio, spatial audio, and millions of tracks seamlessly.',
    1000,
    'NGN',
    true,
    'Lossless Audio',
    'music-disc',
    'Waitlist registration only. Slots open subject to regional account eligibility.',
    '["Lossless and spatial audio catalog support", "Curated playlists and live radio stations", "Early notification before general queue access opens"]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
