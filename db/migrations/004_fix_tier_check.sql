-- Migration: Add 'abyssal_active' to subscription_tier CHECK constraint
ALTER TABLE public.subscribers DROP CONSTRAINT IF EXISTS subscribers_subscription_tier_check;
ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_subscription_tier_check
  CHECK (subscription_tier IN ('none', 'pro', 'unlimited', 'abyssal_active'));
