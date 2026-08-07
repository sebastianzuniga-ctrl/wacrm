-- Horario de atención para derivación a ejecutiva (handoff)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_hours_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_hours_days int[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 1=lunes ... 7=domingo (ISO)
  ADD COLUMN IF NOT EXISTS business_hours_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS business_hours_end time NOT NULL DEFAULT '19:00',
  ADD COLUMN IF NOT EXISTS business_hours_closed_message text NOT NULL DEFAULT
    'En este momento no tenemos ejecutivos disponibles. Nuestro horario de atención es de lunes a viernes de 9:00 a 19:00 hrs. Puedo seguir ayudándote con temas de agendamiento mientras tanto.';

COMMENT ON COLUMN accounts.business_hours_days IS 'Días ISO en que hay ejecutivos disponibles para handoff: 1=lunes...7=domingo';
