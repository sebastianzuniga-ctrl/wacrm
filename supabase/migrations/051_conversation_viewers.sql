-- ============================================================
-- 051_conversation_viewers.sql — "alguien más está viendo esto"
--
-- Extiende member_presence (migracion 024) para trackear en que
-- conversacion especifica esta cada persona, ademas de su estado
-- general online/away. Permite mostrar un aviso en el inbox cuando
-- dos ejecutivos abren el mismo ticket al mismo tiempo.
--
-- touch_presence() se actualiza para aceptar dos parametros nuevos
-- OPCIONALES, sin romper las llamadas existentes de
-- presence-heartbeat.tsx (que solo pasa p_status):
--
--   p_conversation_id     -- conversacion que la persona esta viendo
--                             ahora mismo (o NULL si ninguna)
--   p_update_conversation -- flag: solo si es TRUE se toca la
--                             columna viewing_conversation_id
--
-- El flag existe para que dos heartbeats independientes (el global
-- de presence-heartbeat.tsx cada 30s, y uno nuevo por-conversacion
-- en message-thread.tsx mientras un chat esta abierto) no se pisen
-- entre si -- el heartbeat global NUNCA toca viewing_conversation_id
-- (siempre llama con el flag en false/default), y el heartbeat de
-- conversacion nunca toca el status (pasa p_status NULL, que ahora
-- significa "preservar el status actual" en vez de forzar un valor).
-- ============================================================

ALTER TABLE member_presence
  ADD COLUMN IF NOT EXISTS viewing_conversation_id UUID
    REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS member_presence_viewing_idx
  ON member_presence(viewing_conversation_id)
  WHERE viewing_conversation_id IS NOT NULL;

COMMENT ON COLUMN member_presence.viewing_conversation_id IS
  'Conversacion que esta persona tiene abierta ahora mismo en el inbox, o NULL. Alimenta el aviso "alguien mas esta viendo esto".';

-- DROP explicito antes del CREATE OR REPLACE: la firma cambia de 1
-- a 3 parametros, y Postgres permite sobrecarga -- sin este DROP,
-- CREATE OR REPLACE crea una funcion NUEVA en paralelo en vez de
-- reemplazar la vieja, dejando dos versiones ambiguas.
DROP FUNCTION IF EXISTS public.touch_presence(text);

CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_update_conversation BOOLEAN DEFAULT false
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;
  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;
  INSERT INTO member_presence (user_id, account_id, status, last_seen_at, viewing_conversation_id)
  VALUES (
    auth.uid(),
    v_account_id,
    COALESCE(p_status, 'online'),
    now(),
    CASE WHEN p_update_conversation THEN p_conversation_id ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE
    SET status       = COALESCE(p_status, member_presence.status),
        last_seen_at = now(),
        account_id   = excluded.account_id,
        viewing_conversation_id = CASE
          WHEN p_update_conversation THEN p_conversation_id
          ELSE member_presence.viewing_conversation_id
        END;
END;
$$;
