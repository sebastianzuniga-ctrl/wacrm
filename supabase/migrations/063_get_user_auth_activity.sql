-- RPC para leer login/logout de auth.audit_log_entries (schema auth,
-- no accesible directo via la API) desde el modal de actividad de un
-- usuario en Historial y Estadisticas -- pedido 2026-09-03.
--
-- SECURITY DEFINER porque auth.audit_log_entries no tiene RLS/grants
-- para el rol autenticado. Solo admin/owner de la cuenta del target
-- puede llamarla (chequeo manual adentro, ya que corre con privilegios
-- elevados).
CREATE OR REPLACE FUNCTION get_user_auth_activity(p_user_id uuid, p_limit int DEFAULT 100)
RETURNS TABLE (action text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role account_role_enum;
  v_target_account_id uuid;
  v_caller_account_id uuid;
BEGIN
  SELECT account_role, account_id INTO v_caller_role, v_caller_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_role NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_target_account_id
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL OR v_target_account_id != v_caller_account_id THEN
    RAISE EXCEPTION 'User not found in this account' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT (payload->>'action')::text, auth.audit_log_entries.created_at
  FROM auth.audit_log_entries
  WHERE payload->>'actor_id' = p_user_id::text
    AND payload->>'action' IN ('login', 'logout')
  ORDER BY auth.audit_log_entries.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_auth_activity(uuid, int) TO authenticated;
