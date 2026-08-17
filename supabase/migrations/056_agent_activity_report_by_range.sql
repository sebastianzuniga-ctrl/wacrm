-- Reemplaza agent_activity_report (migration 055) por una vista más
-- granular: una fila por (agente, conversación) con su fecha efectiva
-- de asignación, para poder filtrar por rango de fechas en el API en
-- vez de tener el conteo pre-agregado a "todo el tiempo".
--
-- Fecha efectiva = created_at del evento 'assigned' si existe; si no
-- (conversación creada ya con agente asignado, el UPDATE trigger de
-- la migración 042 nunca disparó), se usa conversations.created_at
-- como aproximación razonable.
DROP VIEW IF EXISTS agent_activity_report;

CREATE OR REPLACE VIEW agent_assignment_events
WITH (security_invoker = true) AS
WITH from_events AS (
  SELECT
    ce.account_id,
    ce.to_value::uuid AS agent_id,
    ce.conversation_id,
    ce.created_at AS assigned_at
  FROM conversation_events ce
  WHERE ce.event_type = 'assigned' AND ce.to_value IS NOT NULL
),
from_current_no_event AS (
  -- Conversaciones con agente asignado hoy que NUNCA aparecieron en
  -- conversation_events para ese agente (creadas ya con asignación).
  SELECT
    c.account_id,
    c.assigned_agent_id AS agent_id,
    c.id AS conversation_id,
    c.created_at AS assigned_at
  FROM conversations c
  WHERE c.assigned_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM from_events fe
      WHERE fe.conversation_id = c.id AND fe.agent_id = c.assigned_agent_id
    )
)
SELECT account_id, agent_id, conversation_id, assigned_at FROM from_events
UNION ALL
SELECT account_id, agent_id, conversation_id, assigned_at FROM from_current_no_event;

COMMENT ON VIEW agent_assignment_events IS
  'Una fila por (agente, conversación, fecha efectiva de asignación). Base para el reporte de actividad por agente filtrable por rango de fechas (ver /api/historial/agent-report). security_invoker=true: aplica el RLS del usuario que consulta (no del dueño de la vista), igual que agent_activity_report en la migración 055.';
