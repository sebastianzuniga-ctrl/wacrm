-- Corrige un bug de la migración 064: la policy usaba
-- p.id = auth.uid() pero profiles.id es un PK propio
-- (uuid_generate_v4); la columna que referencia auth.uid() es
-- profiles.user_id. Por eso ningún usuario -- ni siquiera con
-- perfil sin restricción -- podía ver plantillas tras 064: la
-- subconsulta interna nunca resolvía la fila del propio usuario.
-- Se corrige a user_id en las dos subconsultas.
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
        AND message_templates.id = ANY(cp.allowed_template_ids)
    )
  );
