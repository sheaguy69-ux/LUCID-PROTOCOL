-- Migration: Add ON DELETE CASCADE to commission_transactions FK
ALTER TABLE public.commission_transactions
  DROP CONSTRAINT IF EXISTS commission_transactions_telegram_user_id_fkey,
  ADD CONSTRAINT commission_transactions_telegram_user_id_fkey
    FOREIGN KEY (telegram_user_id) REFERENCES public.subscribers(telegram_user_id)
    ON DELETE CASCADE;
