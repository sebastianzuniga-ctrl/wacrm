-- ============================================================
-- 043_ticket_alerts_and_daily_report.sql
--
-- 1) Alerta de ticket sin atender: cuando una conversacion entra
--    a la cola de handoff (solicito hablar con ejecutivo) y nadie
--    la reclama (claim) dentro de X minutos, se notifica por correo.
--    Parametrizable por cuenta: umbral, si repite el aviso y cada
--    cuanto, y la lista de correos de jefatura.
--
-- 2) Informe nocturno de negocio: a una hora configurable por
--    cuenta, se manda un resumen del dia (tickets entrados,
--    cerrados, por ejecutivo, etc). Misma lista de correos o una
--    separada, segun se defina en la UI.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ticket_alert_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ticket_alert_threshold_minutes integer NOT NULL DEFAULT 5
    CHECK (ticket_alert_threshold_minutes BETWEEN 1 AND 1440),
  ADD COLUMN IF NOT EXISTS ticket_alert_repeat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_alert_repeat_minutes integer NOT NULL DEFAULT 15
    CHECK (ticket_alert_repeat_minutes BETWEEN 1 AND 1440),
  ADD COLUMN IF NOT EXISTS ticket_alert_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS daily_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_report_time time NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS daily_report_emails text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS daily_report_last_sent_date date;

-- handoff_requested_at: se setea cuando la conversacion entra a la
-- cola de handoff (ai_autoreply_disabled=true, sin agente asignado).
-- Se limpia (NULL) cuando alguien hace claim o el ticket se cierra.
-- handoff_alert_last_sent_at: ultima vez que se mando aviso para
-- este ticket; permite calcular si toca repetir el aviso.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_alert_last_sent_at timestamptz;

-- Indice parcial para que el cron de alertas (corre cada 1 min)
-- solo escanee conversaciones efectivamente esperando ejecutivo.
CREATE INDEX IF NOT EXISTS idx_conversations_handoff_requested_at
  ON conversations (handoff_requested_at)
  WHERE handoff_requested_at IS NOT NULL;
