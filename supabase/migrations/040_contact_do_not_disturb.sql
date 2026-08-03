-- Migration 040: Do Not Disturb (No Molestar) — cumplimiento SERNAC.
--
-- Un contacto NO queda en no-molestar solo por presionar "NO" en el boton
-- de una campaña. Queda en no-molestar UNICAMENTE cuando responde con la
-- frase explicita que el bot le pide escribir (ej., tras despedirse:
-- "Si no desea recibir mas mensajes de campaña, escriba: NO RECIBIR MENSAJES").
-- Esa frase se detecta en el webhook sobre mensajes de texto libre, nunca
-- sobre el tap del boton en si.
--
-- Una vez marcado, el contacto se excluye de TODO envio de campaña futuro.
-- No afecta el chat normal, la IA, ni los flujos de agenda.

ALTER TABLE contacts
  ADD COLUMN do_not_disturb boolean NOT NULL DEFAULT false,
  ADD COLUMN do_not_disturb_at timestamptz,
  ADD COLUMN do_not_disturb_source text
    CHECK (do_not_disturb_source IS NULL OR do_not_disturb_source IN ('keyword_reply', 'manual'));

CREATE INDEX idx_contacts_do_not_disturb
  ON contacts (account_id, do_not_disturb) WHERE do_not_disturb = true;

-- Auditoria: evidencia de cada opt-out/opt-in (fecha, origen, texto exacto
-- que escribio el contacto). Esto es lo que sirve como respaldo ante SERNAC.
CREATE TABLE contact_dnd_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('opt_out', 'opt_in')),
  source text NOT NULL CHECK (source IN ('keyword_reply', 'manual')),
  reply_text text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_dnd_events_contact ON contact_dnd_events (contact_id, created_at DESC);
CREATE INDEX idx_contact_dnd_events_account ON contact_dnd_events (account_id, created_at DESC);

ALTER TABLE contact_dnd_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_dnd_events_select" ON contact_dnd_events
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY "contact_dnd_events_insert" ON contact_dnd_events
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum));
