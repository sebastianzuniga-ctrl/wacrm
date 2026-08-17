-- Reporte de acceso y actividad por agente (requerimiento 2026-08-17).
-- Combina:
--   - member_presence.last_seen_at -> último acceso del usuario
--   - Historial completo de agentes que alguna vez atendieron una
--     conversación: unión de conversation_events (event_type='assigned',
--     capturado desde la migración 042) con el assigned_agent_id actual
--     de conversations (para las conversaciones creadas directamente
--     con un agente asignado, cuyo primer UPDATE nunca disparó el
--     trigger que llena conversation_events -- solo dispara en UPDATE).
--
-- "Atendidas" = conversaciones distintas donde el usuario aparece como
-- agente asignado en algún momento (historial completo, no solo
-- asignación vigente). "Abiertas/pendientes/cerradas" reflejan el
-- ESTADO ACTUAL de esas conversaciones, no el estado al momento de la
-- asignación.
CREATE OR REPLACE VIEW agent_activity_report
WITH (security_invoker = true) AS
WITH agent_conversation_pairs AS (
  -- Todas las asignaciones históricas registradas por el trigger.
  SELECT DISTINCT
    ce.account_id,
    ce.to_value::uuid AS agent_id,
    ce.conversation_id
  FROM conversation_events ce
  WHERE ce.event_type = 'assigned' AND ce.to_value IS NOT NULL
  UNION
  -- Asignación vigente, por si la conversación nunca pasó por un UPDATE
  -- que disparara el trigger (creada ya con agente asignado).
  SELECT DISTINCT
    c.account_id,
    c.assigned_agent_id AS agent_id,
    c.id AS conversation_id
  FROM conversations c
  WHERE c.assigned_agent_id IS NOT NULL
),
agent_stats AS (
  SELECT
    acp.account_id,
    acp.agent_id,
    COUNT(DISTINCT acp.conversation_id) AS total_attended,
    COUNT(DISTINCT acp.conversation_id) FILTER (WHERE c.status = 'open') AS open_count,
    COUNT(DISTINCT acp.conversation_id) FILTER (WHERE c.status = 'pending') AS pending_count,
    COUNT(DISTINCT acp.conversation_id) FILTER (WHERE c.status = 'closed') AS closed_count
  FROM agent_conversation_pairs acp
  JOIN conversations c ON c.id = acp.conversation_id
  GROUP BY acp.account_id, acp.agent_id
)
SELECT
  p.account_id,
  p.user_id,
  p.full_name,
  p.account_role,
  mp.last_seen_at,
  mp.status AS presence_status,
  COALESCE(ags.total_attended, 0) AS total_attended,
  COALESCE(ags.open_count, 0) AS open_count,
  COALESCE(ags.pending_count, 0) AS pending_count,
  COALESCE(ags.closed_count, 0) AS closed_count
FROM profiles p
LEFT JOIN member_presence mp ON mp.user_id = p.user_id
LEFT JOIN agent_stats ags ON ags.agent_id = p.user_id AND ags.account_id = p.account_id;

COMMENT ON VIEW agent_activity_report IS
  'Reporte de acceso y actividad por agente: último acceso (member_presence) y conteo de conversaciones atendidas históricamente (abiertas/pendientes/cerradas por estado actual). security_invoker=true, respeta RLS del usuario que consulta. Ver requerimiento 2026-08-17.';
