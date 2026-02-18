-- Add subscription and credits columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_credits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
