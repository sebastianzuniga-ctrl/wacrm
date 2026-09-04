-- Corrige semántica de custom_profiles.allowed_template_ids (migración
-- 064/065). El diseño original trataba SOLO el array vacío '{}' como
-- estado válido, con el significado "ninguna plantilla visible" -- pero
-- eso es también el valor DEFAULT de la columna, así que cualquier
-- perfil creado antes de que alguien configurara manualmente la
-- whitelist (p.ej. "Administrador", "Supervisor") quedó bloqueando
-- TODAS las plantillas sin que nadie lo pidiera. Confirmado en vivo:
-- perfil "Administrador" con allowed_template_ids='{}' dejaba a
-- informatica@ino.cl sin ver ninguna de las 9 plantillas sincronizadas
-- desde Meta, y por lo tanto sin poder armar campañas.
--
-- Fix: permitir NULL en la columna con el significado "sin
-- restricción -- ve todas las plantillas de la cuenta". El array
-- vacío '{}' se mantiene como una opción real y distinta ("ninguna
-- plantilla, a propósito") para perfiles que sí quieran ese extremo.
-- Los perfiles con lista no vacía (ej. "Ejecutivo") no se tocan.

ALTER TABLE custom_profiles
  ALTER COLUMN allowed_template_ids DROP NOT NULL,
  ALTER COLUMN allowed_template_ids DROP DEFAULT;

COMMENT ON COLUMN custom_profiles.allowed_template_ids IS
  'IDs de message_templates que este perfil puede ver/usar. NULL = sin restricción (ve todas). Array vacío = ninguna plantilla visible a propósito. Lista con IDs = solo esas.';

-- Backfill: los perfiles que hoy están en '{}' por ser el DEFAULT de
-- la columna (nunca configurados a mano) pasan a NULL = sin
-- restricción. Ejecutivo (con IDs reales) queda intacto.
UPDATE custom_profiles
SET allowed_template_ids = NULL
WHERE allowed_template_ids = '{}'::uuid[];

DROP POLICY "message_templates_custom_profile_restrict" ON message_templates;

CREATE POLICY "message_templates_custom_profile_restrict" ON message_templates
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.custom_profile_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN custom_profiles cp ON cp.id = p.custom_profile_id
      WHERE p.user_id = auth.uid()
        AND (
          cp.allowed_template_ids IS NULL
          OR message_templates.id = ANY(cp.allowed_template_ids)
        )
    )
  );
