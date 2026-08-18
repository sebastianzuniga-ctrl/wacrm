-- RPC para asignar/quitar el perfil personalizado de un miembro
-- (Configuración > Perfiles, migración 057). Mismo patrón que
-- set_member_role (migración 018): profiles_update solo permite
-- auth.uid() = user_id, así que un admin no puede tocar el
-- custom_profile_id de OTRO usuario sin este SECURITY DEFINER.
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

  -- p_custom_profile_id NULL = quitar el perfil (vuelve a ver todo lo
  -- que su account_role permite). Si no es NULL, debe pertenecer a la
  -- misma cuenta -- de lo contrario un admin podría asignar por error
  -- (o intencionalmente) un perfil de otra cuenta que nunca debería
  -- ver.
  IF p_custom_profile_id IS NOT NULL THEN
    SELECT account_id INTO v_profile_account_id
    FROM custom_profiles
    WHERE id = p_custom_profile_id;

    IF v_profile_account_id IS NULL THEN
      RAISE EXCEPTION 'Custom profile not found' USING ERRCODE = '22023';
    END IF;

    IF v_profile_account_id <> v_caller_account_id THEN
      RAISE EXCEPTION 'Custom profile does not belong to your account'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE profiles
  SET custom_profile_id = p_custom_profile_id
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_custom_profile(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_custom_profile(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_custom_profile(UUID, UUID) TO authenticated;
