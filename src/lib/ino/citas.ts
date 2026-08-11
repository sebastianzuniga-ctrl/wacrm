// ============================================================
// Lectura de citas agendadas (agenda DENT) para un paciente, vía el
// mismo endpoint SQL genérico que usa el nodo "Query INO Agenda" del
// workflow BotINO Principal en n8n (queryGptJson.jsp).
//
// La query SQL en sí se lee desde la tabla ino_queries (editable en
// Configuración -> Querys) en vez de estar hardcodeada acá, por si el
// schema DENT cambia o se necesita ajustar un filtro sin deploy.
// ============================================================
import { supabaseAdmin } from '@/lib/flows/admin-client';

const INO_QUERY_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/queryGptJson.jsp';
const QUERY_KEY = 'citas_agenda';

export interface CitaAgenda {
  id_agenda: number;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
}

interface RawAgendaRow {
  FEC_CITA: string;
  HOR_CITA: string;
  ID_AGENDA: number;
  COD_PACIENTE: number;
  IND_ESTADO: string;
}

/**
 * Trae las citas reservadas (actuales/futuras) de un paciente. Best
 * effort: cualquier error de red/parseo/config devuelve un array
 * vacío en vez de romper el panel del contacto -- es informativo, no
 * crítico.
 *
 * pac_codigo se valida como numérico antes de sustituirlo en el SQL
 * crudo que espera el endpoint (no hay forma de parametrizar la query
 * en queryGptJson.jsp -- es un endpoint de texto libre del lado de
 * INO), así que nunca se le pasa un valor no confiable directamente.
 */
export async function getCitasByPacCodigo(pacCodigo: string): Promise<CitaAgenda[]> {
  if (!/^\d+$/.test(pacCodigo)) return [];

  const token = process.env.INO_NOTIFY_TOKEN;
  if (!token) return [];

  const { data: queryRow, error: queryError } = await supabaseAdmin()
    .from('ino_queries')
    .select('sql_template')
    .eq('key', QUERY_KEY)
    .maybeSingle();

  if (queryError || !queryRow?.sql_template) {
    console.error('[ino/citas] no se pudo cargar la query desde ino_queries:', queryError);
    return [];
  }

  const query = queryRow.sql_template.replaceAll('{pac_codigo}', pacCodigo);

  const params = new URLSearchParams({
    query,
    token,
    fromModulo: 'wacrm',
    usuario: 'informatica@ino.cl',
  });

  try {
    const res = await fetch(`${INO_QUERY_URL}?${params.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const rows: RawAgendaRow[] = await res.json();
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => ({
      id_agenda: row.ID_AGENDA,
      // FEC_CITA llega como "YYYY-MM-DD 00:00:00" (la hora real va
      // en HOR_CITA aparte) -- nos quedamos solo con la fecha.
      fecha: row.FEC_CITA.split(' ')[0],
      // HOR_CITA llega como "HH:MM:SS" -- recortamos los segundos.
      hora: row.HOR_CITA.slice(0, 5),
    }));
  } catch (err) {
    console.error('[ino/citas] getCitasByPacCodigo failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
