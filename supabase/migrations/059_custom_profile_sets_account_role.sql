-- Al asignar un perfil personalizado, el account_role real del
-- usuario se actualiza al base_role del perfil -- de lo contrario el
-- perfil solo cambiaría la apariencia del menú, pero hasMinRole()
-- (usado tanto en el sidebar como en cada policy RLS vía
-- is_account_member) seguiría evaluando contra el rol viejo y el
-- usuario nunca tendría realmente los permisos de las páginas que el
-- perfil dice permitir.
--
-- Al QUITAR un perfil (p_custom_profile_id = NULL) el account_role
-- NO se toca -- se deja como quedó (normalmente el base_role del
-- último perfil asignado), porque no hay un "rol antes del perfil"
-- guardado para restaurar. El admin puede ajustarlo manualmente si
-- hace falta.
CREATE OR REPLACE FUNCTION public.set_member_custom_profile(
  p_user_id UUID,
  p_custom_profile_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_profile_account_id UUID;
  v_profile_base_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_target_account_id
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF p_custom_profile_id IS NOT NULL THEN
    SELECT account_id, base_role INTO v_profile_account_id, v_profile_base_role
    FROM custom_profiles
    WHERE id = p_custom_profile_id;

    IF v_profile_account_id IS NULL THEN
      RAISE EXCEPTION 'Custom profile not found' USING ERRCODE = '22023';
    END IF;

    IF v_profile_account_id <> v_caller_account_id THEN
      RAISE EXCEPTION 'Custom profile does not belong to your account'
        USING ERRCODE = '42501';
    END IF;

    UPDATE profiles
    SET custom_profile_id = p_custom_profile_id,
        account_role = v_profile_base_role
    WHERE user_id = p_user_id;
  ELSE
    UPDATE profiles
    SET custom_profile_id = NULL
    WHERE user_id = p_user_id;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_custom_profile(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_custom_profile(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_custom_profile(UUID, UUID) TO authenticated;
