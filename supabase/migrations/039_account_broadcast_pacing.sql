-- ============================================================
-- 039_account_broadcast_pacing
--
-- Configurable pacing for broadcast/campaign sends, exposed in
-- Settings > WhatsApp as "messages per minute" instead of the
-- previous hardcoded BROADCAST_SEND_DELAY_MS env var.
--
-- The broadcast send loop (src/app/api/whatsapp/broadcast/route.ts)
-- converts this into a per-recipient delay: 60000 / messages_per_minute
-- ms. Default 60/min = 1 msg/sec, matching the previous default.
-- Upper bound 4800/min (80 msgs/sec * 60) mirrors Meta's documented
-- max Cloud API throughput per number.
--
-- RLS: no change needed, same reasoning as 021 (default_currency) —
-- accounts_update (017) already restricts writes to admins+.
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS broadcast_messages_per_minute INTEGER NOT NULL DEFAULT 60;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_broadcast_messages_per_minute_range;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_broadcast_messages_per_minute_range
  CHECK (broadcast_messages_per_minute BETWEEN 1 AND 4800);
