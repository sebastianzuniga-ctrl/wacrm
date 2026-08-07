-- Mensaje separado para cuando se revierte un ticket a la IA al cierre del horario
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_hours_revert_message text NOT NULL DEFAULT
    'Por motivos de horario, nuestros ejecutivos ya no están disponibles hoy. Seguimos atendiendo mañana en nuestro horario habitual. Mientras tanto puedo ayudarte con temas de agendamiento.';

COMMENT ON COLUMN accounts.business_hours_revert_message IS
  'Mensaje enviado cuando un ticket que esperaba ejecutivo se revierte a la IA porque terminó el horario de atención sin que nadie lo tomara (distinto de business_hours_closed_message, que es para cuando el cliente pide ejecutivo estando ya fuera de horario).';
