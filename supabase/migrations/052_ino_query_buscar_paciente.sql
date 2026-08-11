-- ============================================================
-- 052_ino_query_buscar_paciente.sql
--
-- Agrega la query de "buscar paciente por teléfono" a ino_queries
-- (ver migración 050), para el botón "Buscar en INO" de la pantalla
-- Sesiones INO. Mismo SQL que usa el nodo "Query INO Paciente" del
-- workflow BotINO Principal en n8n.
-- ============================================================
INSERT INTO ino_queries (key, label, description, sql_template) VALUES (
  'buscar_paciente_telefono',
  'Buscar paciente por teléfono',
  'Busca en DENT.PACIENTES/DENT.TELEFONOS un paciente cuyo teléfono coincida con el número de WhatsApp (sin código de país). Usada por el botón "Buscar en INO" de Sesiones INO. Placeholder: {telefono_local} (los dígitos del wa_id sin los primeros 3, ya calculado antes de sustituir -- mismo criterio que el nodo "Query INO Paciente" de n8n).',
  'SELECT * FROM (SELECT p.PAC_CODIGO, p.PAC_NOMBRES, p.PAC_APELLIDO_PATERNO, p.PAC_APELLIDO_MATERNO FROM DENT.TELEFONOS t INNER JOIN DENT.PACIENTES p ON t.COD_PERSONA = p.PAC_CODIGO WHERE t.NUM_TELEFONO = ''{telefono_local}'' AND t.IND_ESTADO = ''VIG'' ORDER BY t.IND_PRIORIDAD DESC, t.FEC_ACTUALIZA DESC) WHERE ROWNUM <= 10'
);
