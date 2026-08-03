-- Migration 042: auditoria de cambios de estado/asignacion en conversations.
--
-- Hoy nada registra quien cerro/reabrio un ticket o quien se lo asigno --
-- el UPDATE de status/assigned_agent_id se hace directo desde el cliente
-- (message-thread.tsx), sin pasar por ninguna ruta de API propia. En vez
-- de mover esa logica a rutas nuevas, se captura con un trigger: funciona
-- para el UPDATE directo del cliente, el "Tomar contacto"
-- (claim/route.ts), Y el auto-cierre de 24h (webhook + cron, migration
-- 041) sin tocar nada de esos tres lugares.
--
-- actor_id = auth.uid() -- el usuario autenticado que hizo el request.
-- Para los cambios que hace el propio backend con la service_role key
-- (auto-cierre por inactividad, barrido del cron) auth.uid() es NULL,
-- lo cual es exactamente la distincion que queremos: NULL = "sistema".

CREATE TABLE conversation_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('status_changed', 'assigned', 'unassigned')),
  from_value text,
  to_value text,
  actor_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversation_events_conversation ON conversation_events (conversation_id, created_at DESC);
CREATE INDEX idx_conversation_events_account ON conversation_events (account_id, created_at DESC);

ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;

-- Solo lectura para miembros de la cuenta. Nadie inserta/actualiza/borra
-- directo -- unicamente el trigger (SECURITY DEFINER) escribe aqui.
CREATE POLICY "conversation_events_select" ON conversation_events
  FOR SELECT USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION log_conversation_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO conversation_events (account_id, conversation_id, event_type, from_value, to_value, actor_id)
    VALUES (NEW.account_id, NEW.id, 'status_changed', OLD.status, NEW.status, auth.uid());
  END IF;

  IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
    INSERT INTO conversation_events (account_id, conversation_id, event_type, from_value, to_value, actor_id)
    VALUES (
      NEW.account_id,
      NEW.id,
      CASE WHEN NEW.assigned_agent_id IS NULL THEN 'unassigned' ELSE 'assigned' END,
      OLD.assigned_agent_id::text,
      NEW.assigned_agent_id::text,
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_conversation_changes
  AFTER UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION log_conversation_changes();
