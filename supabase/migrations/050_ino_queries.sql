-- Tabla de configuración global (no por-cuenta, ver comentario más
-- abajo) para las consultas SQL crudas que wacrm envía al endpoint
-- queryGptJson.jsp de sistema.ino.cl. Permite editarlas desde la UI
-- (Configuración -> Querys) sin necesidad de un deploy de código si
-- el schema DENT cambia o se necesita ajustar un filtro.
--
-- No tiene account_id: la integración con sistema.ino.cl es
-- inherentemente de un solo tenant (URLs hardcodeadas al sistema de
-- la clínica INO en varios lugares del código), igual que
-- loginJson.jsp/insNotificacion.jsp. RLS se deja SIN policies
-- públicas a propósito -- el único camino de acceso es vía
-- supabaseAdmin() (service role) dentro de endpoints gateados con
-- requireRole('admin'), nunca directo desde el cliente.
CREATE TABLE ino_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  sql_template text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ino_queries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ino_queries IS
  'Consultas SQL crudas enviadas a queryGptJson.jsp (sistema.ino.cl), editables desde Configuración -> Querys. Acceso solo vía service role + requireRole(admin) en el API, sin RLS pública.';

COMMENT ON COLUMN ino_queries.sql_template IS
  'SQL crudo con placeholders tipo {nombre_placeholder} que el código reemplaza antes de enviar. Ver cada fila para los placeholders soportados.';

-- Semilla: la única query que usa wacrm hoy (src/lib/ino/citas.ts).
-- Placeholder {pac_codigo} se valida como numérico antes de sustituir.
INSERT INTO ino_queries (key, label, description, sql_template) VALUES (
  'citas_agenda',
  'Citas agendadas de un paciente',
  'Trae las citas reservadas (actuales/futuras) de un paciente para el panel "Ficha INO" del inbox. Placeholder: {pac_codigo} (número de ficha, se valida como numérico antes de sustituir).',
  'SELECT a.FEC_CITA, a.HOR_CITA, a.ID_AGENDA, a.COD_PACIENTE, a.IND_ESTADO FROM DENT.AGENDA a WHERE a.COD_PACIENTE = {pac_codigo} AND a.IND_ESTADO = ''RSV'' AND a.CITA_SECUENCIA = 1 ORDER BY a.FEC_CITA ASC'
);
