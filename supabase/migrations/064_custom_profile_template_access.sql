-- Control granular de qué plantillas de WhatsApp puede ver/usar un
-- perfil personalizado (requerimiento 2026-09-03). Mismo patrón que
-- allowed_pages (migración 057): capa que solo RESTRINGE, nunca
-- amplía, y es por usuario vía profiles.custom_profile_id, no por
-- rol base.
ALTER TABLE custom_profiles
  ADD COLUMN allowed_template_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN custom_profiles.allowed_template_ids IS
  'IDs de message_templates que este perfil puede ver/usar. Array vacío = ninguna plantilla visible para usuarios con este perfil asignado (deben marcarse explícitamente).';

-- RESTRICTIVE: se combina con AND sobre las policies PERMISSIVE
-- existentes (message_templates_select de account sharing), nunca
-- las reemplaza ni amplía el acceso -- solo puede acotar.
CREATE POLICY "message_templates_custom_profile_restrict" ON message_templates
  AS RESTRICTIVE
  FOR SELECT
  USING (
    NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.custom_profile_id IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN custom_profiles cp ON cp.id = p.custom_profile_id
      WHERE p.id = auth.uid()
        AND message_templates.id = ANY(cp.allowed_template_ids)
    )
  );
