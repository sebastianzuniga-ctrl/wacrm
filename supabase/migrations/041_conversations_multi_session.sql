-- Migration 041: permitir multiples conversaciones (tickets) por contacto,
-- una por "sesion" de 24h de inactividad -- para trazabilidad/estadisticas.
--
-- ANTES: UNIQUE (account_id, contact_id) -- un contacto = una conversacion
-- para siempre, sin importar cuanto tiempo pase o si un agente la cerro
-- manualmente. Un contacto que escribe de nuevo despues de un mes cae en
-- el mismo hilo de hace un mes.
--
-- AHORA: UNIQUE parcial, solo sobre conversaciones NO cerradas. Permite
-- guardar historicamente todas las conversaciones cerradas de un contacto
-- (una fila por ticket), pero sigue garantizando que nunca haya dos
-- conversaciones abiertas/pendientes a la vez para el mismo contacto. La
-- logica de cuando cerrar la vieja y abrir una nueva vive en
-- src/app/api/whatsapp/webhook/route.ts (reactivo, al llegar un mensaje)
-- y en src/app/api/conversations/cron/route.ts (barrido periodico).

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX idx_conversations_account_contact_active
  ON conversations (account_id, contact_id)
  WHERE status <> 'closed';
