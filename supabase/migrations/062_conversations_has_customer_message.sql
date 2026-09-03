-- Permite filtrar la lista del inbox para ocultar por defecto
-- conversaciones donde el paciente nunca respondio (ej. creadas por
-- una campana, sin interaccion todavia) -- pedido 2026-09-03.
--
-- true si al menos un mensaje de tipo 'customer' ya llego para esta
-- conversacion. El webhook lo marca true en cada mensaje entrante
-- (ver src/app/api/whatsapp/webhook/route.ts); backfill aqui para las
-- filas existentes segun la tabla messages.
ALTER TABLE conversations
  ADD COLUMN has_customer_message boolean NOT NULL DEFAULT false;

UPDATE conversations c
SET has_customer_message = true
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.conversation_id = c.id AND m.sender_type = 'customer'
);
