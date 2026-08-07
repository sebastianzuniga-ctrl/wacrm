-- Horario distinto para fin de semana (sábado/domingo)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_hours_weekend_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_hours_weekend_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS business_hours_weekend_end time NOT NULL DEFAULT '14:00';

COMMENT ON COLUMN accounts.business_hours_weekend_enabled IS
  'Si es true, sábado(6)/domingo(7) usan business_hours_weekend_start/end en vez de business_hours_start/end. No afecta si esos días no están en business_hours_days.';
