// ============================================================
// Lectura de la "ficha activa" del bot de n8n (BotINO Principal).
//
// n8n mantiene su propia base Postgres (botino_analytics, ajena a la de
// wacrm) con:
//   - sesiones: estado EN VIVO de la conversacion por wa_id (telefono
//     sin '+'). pac_codigo aqui puede ser un codigo de ficha real, o
//     uno de los sentinels 'SELECCIONANDO' / 'ESPERANDO_RUT' que usa
//     el Switch "Estado Sesión" del workflow.
//   - contacts (de ESA base, no confundir con la de wacrm): registro
//     mas duradero por telefono, con RUT y es_paciente_ino.
//
// wacrm se conecta de SOLO LECTURA (rol wacrm_readonly, creado con
// GRANT SELECT unicamente sobre estas dos tablas) -- nunca escribe aca,
// n8n sigue siendo el unico dueño de esta data.
// ============================================================
import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool | null {
  if (!process.env.INO_SESSIONS_DB_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.INO_SESSIONS_DB_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export type FichaEstado = 'activa' | 'seleccionando' | 'esperando_rut' | 'sin_sesion';

export interface FichaActiva {
  wa_id: string;
  estado: FichaEstado;
  pac_codigo: string | null;
  pac_nombre: string | null;
  pac_apellido: string | null;
  rut: string | null;
  es_paciente_ino: boolean | null;
  /** Candidatos cuando estado === 'seleccionando'. */
  pacientes_lista: { PAC_CODIGO: string; PAC_NOMBRES: string; PAC_APELLIDO_PATERNO: string }[] | null;
}

/**
 * Limpia valores "sucios" que puede dejar el workflow de n8n: strings
 * vacios, o el literal 'undefined' (bug conocido, ver addendum del
 * proyecto -- pac_codigo/pac_nombre a veces quedan como el string
 * "undefined" en vez de NULL cuando una interpolacion JS falla).
 */
function cleanField(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

/**
 * Busca la ficha/paciente activo para un telefono (formato wa_id: solo
 * digitos, sin '+'). Devuelve null si no hay nada (numero no visto por
 * el bot aun) o si la conexion a botino_analytics no esta configurada
 * o falla -- esto es informativo/best-effort, nunca debe romper el
 * inbox de wacrm.
 */
/**
 * Busca telefono(s) asociados a un numero de ficha (pac_codigo) exacto,
 * en la tabla contacts de botino_analytics. Usado por la busqueda de
 * /historial para aceptar "buscar por numero de ficha" ademas de
 * nombre/telefono de WhatsApp.
 */
export async function getPhonesByFichaCodigo(pacCodigo: string): Promise<string[]> {
  const db = getPool();
  if (!db || !pacCodigo) return [];
  try {
    const res = await db.query<{ phone_number: string }>(
      'SELECT DISTINCT phone_number FROM contacts WHERE pac_codigo = $1',
      [pacCodigo]
    );
    return res.rows.map((r) => r.phone_number).filter(Boolean);
  } catch (err) {
    console.error('[ino/sesion] getPhonesByFichaCodigo failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getFichaActivaByPhone(waId: string): Promise<FichaActiva | null> {
  const db = getPool();
  if (!db || !waId) return null;

  try {
    const [sesionRes, contactRes] = await Promise.all([
      db.query<{
        pac_codigo: string | null;
        pac_nombre: string | null;
        pac_apellido: string | null;
        pacientes_lista: string | null;
      }>(
        'SELECT pac_codigo, pac_nombre, pac_apellido, pacientes_lista FROM sesiones WHERE wa_id = $1',
        [waId]
      ),
      db.query<{
        pac_codigo: string | null;
        pac_nombre: string | null;
        pac_apellido: string | null;
        rut: string | null;
        es_paciente_ino: boolean | null;
      }>(
        'SELECT pac_codigo, pac_nombre, pac_apellido, rut, es_paciente_ino FROM contacts WHERE phone_number = $1',
        [waId]
      ),
    ]);

    const sesion = sesionRes.rows[0] ?? null;
    const contactRow = contactRes.rows[0] ?? null;
    if (!sesion && !contactRow) return null;

    const rawCodigo = sesion?.pac_codigo ?? contactRow?.pac_codigo ?? null;

    let estado: FichaEstado = 'sin_sesion';
    let pacCodigo: string | null = null;
    if (rawCodigo === 'SELECCIONANDO') {
      estado = 'seleccionando';
    } else if (rawCodigo === 'ESPERANDO_RUT') {
      estado = 'esperando_rut';
    } else if (cleanField(rawCodigo)) {
      estado = 'activa';
      pacCodigo = cleanField(rawCodigo);
    }

    let pacientesLista: FichaActiva['pacientes_lista'] = null;
    if (sesion?.pacientes_lista) {
      try {
        const parsed = JSON.parse(sesion.pacientes_lista);
        if (Array.isArray(parsed) && parsed.length > 0) pacientesLista = parsed;
      } catch {
        // pacientes_lista vacio ('') o JSON invalido en esta fila -- ignorar.
      }
    }

    return {
      wa_id: waId,
      estado,
      pac_codigo: pacCodigo,
      pac_nombre: cleanField(sesion?.pac_nombre ?? contactRow?.pac_nombre),
      pac_apellido: cleanField(sesion?.pac_apellido ?? contactRow?.pac_apellido),
      rut: cleanField(contactRow?.rut),
      es_paciente_ino: contactRow?.es_paciente_ino ?? null,
      pacientes_lista: pacientesLista,
    };
  } catch (err) {
    console.error('[ino/sesion] query failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
