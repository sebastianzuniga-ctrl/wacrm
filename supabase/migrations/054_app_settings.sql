-- Tabla de configuración global key/value, reutilizable para parámetros
-- del sistema que no pertenecen a una cuenta específica (a diferencia
-- de whatsapp_config o accounts.business_hours_*, que son por cuenta).
-- Primer uso: duración de inactividad antes de auto-logout (ver
-- src/middleware.ts, wacrm_add: requerimiento 2026-08-17).
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE app_settings IS
  'Configuración global (no por cuenta) del sistema, key/value. Editable solo por admins vía /api/settings/app-settings.';

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado puede leer (el middleware lee esto
-- usando el cliente del propio usuario logeado, no service role).
CREATE POLICY "Authenticated users can read app_settings"
  ON app_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Solo admins pueden escribir.
CREATE POLICY "Admins can upsert app_settings"
  ON app_settings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_role = 'admin'
    )
  );

CREATE POLICY "Admins can update app_settings"
  ON app_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.account_role = 'admin'
    )
  );

INSERT INTO app_settings (key, value)
VALUES ('session_inactivity_hours', '12'::jsonb);
