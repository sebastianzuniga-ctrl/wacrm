-- Encuesta de satisfacción post-atención (1-5), configurable y apagada por defecto
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS satisfaction_survey_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS satisfaction_survey_message text NOT NULL DEFAULT
    '¿Cómo calificarías la atención que recibiste? Responde tocando una opción.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS satisfaction_survey_sent_at timestamptz;

CREATE TABLE IF NOT EXISTS satisfaction_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  whatsapp_message_id text,
  rating int CHECK (rating BETWEEN 1 AND 5),
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_account ON satisfaction_surveys(account_id);
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_conversation ON satisfaction_surveys(conversation_id);
-- Para resolver rápido "¿este contacto tiene una encuesta pendiente de responder?"
-- al llegar la respuesta por webhook.
CREATE INDEX IF NOT EXISTS idx_satisfaction_surveys_pending
  ON satisfaction_surveys(contact_id) WHERE responded_at IS NULL;

ALTER TABLE satisfaction_surveys ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro de la cuenta puede ver las encuestas (informativo,
-- igual que conversation_events) - mismo patrón que el resto del proyecto.
CREATE POLICY satisfaction_surveys_select ON satisfaction_surveys
  FOR SELECT
  USING (is_account_member(account_id));

-- Solo el service_role (webhook, endpoints server-side) escribe aquí -
-- no hay INSERT/UPDATE policy para authenticated, mismo patrón que
-- conversation_events (solo lectura desde el cliente).
