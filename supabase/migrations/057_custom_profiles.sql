-- Perfiles personalizados con control granular de acceso por página
-- (requerimiento 2026-08-18). Capa ENCIMA del rol base existente
-- (account_role_enum) -- no lo reemplaza ni toca RLS. El rol base
-- sigue siendo el techo real de permisos de datos (RLS); un perfil
-- personalizado solo puede RESTRINGIR qué páginas ve un usuario
-- dentro de lo que su rol base ya permitiría, nunca ampliar.
--
-- allowed_pages guarda los mismos valores de `href` que usa el
-- sidebar (ej. '/contacts', '/pipelines') -- simple de consultar
-- tanto en el menú (cliente) como en el middleware (bloqueo de URL
-- directa), sin necesitar un catálogo de páginas separado.
CREATE TABLE custom_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_role account_role_enum NOT NULL CHECK (base_role IN ('admin', 'agent')),
  allowed_pages text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

COMMENT ON TABLE custom_profiles IS
  'Perfiles personalizados (ej. "Recepción", "Supervisor") que restringen qué páginas del menú ve un usuario, dentro del techo de su base_role. allowed_pages usa los mismos valores de href que src/components/layout/sidebar.tsx.';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON custom_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE custom_profiles ENABLE ROW LEVEL SECURITY;

-- Cualquier miembro de la cuenta puede leer (necesario para que el
-- propio usuario resuelva su menú); solo admins pueden gestionar.
CREATE POLICY "custom_profiles_select" ON custom_profiles
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY "custom_profiles_insert" ON custom_profiles
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "custom_profiles_update" ON custom_profiles
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY "custom_profiles_delete" ON custom_profiles
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Asignación opcional en profiles. NULL = comportamiento actual sin
-- cambios (ve todo lo que su account_role permite). ON DELETE SET
-- NULL: si se borra el perfil, los usuarios vuelven a ver todo en
-- vez de quedar bloqueados por una referencia rota.
ALTER TABLE profiles
  ADD COLUMN custom_profile_id uuid REFERENCES custom_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.custom_profile_id IS
  'Perfil personalizado asignado (opcional). NULL = ve todo lo que account_role permite, sin restricción adicional.';
