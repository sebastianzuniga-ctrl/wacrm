-- ============================================================
-- 053_contacts_pac_lookup.sql
--
-- Agrega columnas a contacts para que wacrm resuelva el paciente
-- desde INO al llegar el PRIMER mensaje de un número, antes de
-- mandarlo a n8n -- así el nombre real aparece de inmediato en el
-- inbox en vez de esperar a que n8n complete su propio flujo.
--
-- pac_lookup_checked_at es la clave: NULL significa "todavía no se
-- intentó resolver". Una vez seteado (con éxito o sin encontrar
-- nada), NO se vuelve a consultar en cada mensaje siguiente -- evita
-- pegarle a INO en cada mensaje de la conversación.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS pac_codigo text,
  ADD COLUMN IF NOT EXISTS es_paciente_ino boolean,
  ADD COLUMN IF NOT EXISTS pac_lookup_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contacts_pac_codigo ON contacts(pac_codigo) WHERE pac_codigo IS NOT NULL;

COMMENT ON COLUMN contacts.pac_lookup_checked_at IS
  'Cuándo se intentó resolver este contacto contra INO por última vez. NULL = nunca se intentó. Evita repetir la consulta en cada mensaje.';
COMMENT ON COLUMN contacts.es_paciente_ino IS
  'NULL = no resuelto todavía. true = encontrado como paciente en INO. false = no encontrado (paciente nuevo o número equivocado).';
