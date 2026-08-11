-- Hace configurable, por número de WhatsApp, si el webhook exige la
-- validación de firma HMAC de Meta (x-hub-signature-256). Reemplaza el
-- flag hardcodeado `if (false && ...)` que existía en el código desde
-- 2026-08-07 (ver wacrm_add4.md) mientras el flujo real dependía del
-- reenvío de n8n (que no puede producir una firma válida porque
-- re-serializa el JSON).
--
-- Default TRUE (seguro) para configuraciones nuevas. La fila real en
-- uso hoy se deja explícitamente en FALSE más abajo para no cortar el
-- flujo de mensajes entrantes (vía n8n) en el próximo restart del
-- servicio. Cuando se recupere el Access Token de la app de Meta de
-- producción y se reconecte el webhook directo (ver pendiente en
-- wacrm_add4.md / wacrm_add5.md), activar este toggle desde la UI de
-- Configuración → WhatsApp.
ALTER TABLE whatsapp_config
  ADD COLUMN webhook_hmac_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN whatsapp_config.webhook_hmac_enabled IS
  'Si es false, el webhook de WhatsApp acepta payloads sin validar la firma HMAC de Meta. Riesgo de seguridad conocido y aceptado temporalmente mientras el flujo pasa por el reenvío de n8n (ver wacrm_add4.md/add5.md). Reactivar apenas se reconecte el webhook directo con Meta.';

-- Fila real en producción hoy (id fijo, confirmado 2026-08-11):
-- mantener en false hasta reconectar el webhook directo con Meta.
UPDATE whatsapp_config
SET webhook_hmac_enabled = false
WHERE id = '8bac3243-9a4b-4add-ae73-a0df01fee692';
