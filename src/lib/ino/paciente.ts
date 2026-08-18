// ============================================================
// Búsqueda de paciente por teléfono en el sistema INO (DENT), vía el
// mismo endpoint SQL genérico que usa el nodo "Query INO Paciente"
// del workflow BotINO Principal en n8n (queryGptJson.jsp).
//
// La query se lee desde ino_queries (editable en Configuración ->
// Querys, migración 052) en vez de estar hardcodeada.
// ============================================================
import { supabaseAdmin } from '@/lib/flows/admin-client';

const INO_QUERY_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/queryGptJson.jsp';
const QUERY_KEY = 'buscar_paciente_telefono';

export interface PacienteCandidato {
  pac_codigo: string;
  pac_nombre: string;
  pac_apellido: string;
  pac_apellido_materno: string | null;
}

interface RawPacienteRow {
  PAC_CODIGO: number;
  PAC_NOMBRES: string;
  PAC_APELLIDO_PATERNO: string;
  PAC_APELLIDO_MATERNO: string | null;
}

/**
 * Resultado explícito: distingue "consulté y no encontré nada"
 * (ok:true, pacientes:[]) de "la consulta falló" (ok:false) -- quien
 * llama necesita esa distinción para decidir si reintentar o no
 * (ver src/lib/ino/resolve-patient.ts).
 */
export type PacienteLookupResult =
  | { ok: true; pacientes: PacienteCandidato[] }
  | { ok: false; error: string };

/**
 * Busca en INO los pacientes cuyo teléfono coincide con este wa_id
 * (mismo criterio que "Query INO Paciente" en n8n: se compara contra
 * el número sin los primeros 3 dígitos -- código de país + prefijo
 * móvil chileno).
 */
export async function lookupPacienteByPhone(waId: string): Promise<PacienteLookupResult> {
  if (!/^\d+$/.test(waId) || waId.length < 4) {
    return { ok: false, error: 'wa_id inválido' };
  }

  const token = process.env.INO_NOTIFY_TOKEN;
  if (!token) return { ok: false, error: 'INO_NOTIFY_TOKEN no configurado' };

  const { data: queryRow, error: queryError } = await supabaseAdmin()
    .from('ino_queries')
    .select('sql_template')
    .eq('key', QUERY_KEY)
    .maybeSingle();

  if (queryError || !queryRow?.sql_template) {
    return { ok: false, error: `no se pudo cargar la query: ${queryError?.message ?? 'sin fila'}` };
  }

  const telefonoLocal = waId.slice(3);
  const query = queryRow.sql_template.replaceAll('{telefono_local}', telefonoLocal);

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
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const rows: RawPacienteRow[] = await res.json();
    if (!Array.isArray(rows)) {
      return { ok: false, error: 'respuesta no es un array' };
    }

    const pacientes = rows
      .filter((row) => row.PAC_CODIGO)
      .map((row) => ({
        pac_codigo: String(row.PAC_CODIGO),
        pac_nombre: row.PAC_NOMBRES,
        pac_apellido: row.PAC_APELLIDO_PATERNO,
        pac_apellido_materno: row.PAC_APELLIDO_MATERNO ?? null,
      }));

    return { ok: true, pacientes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Wrapper best-effort para consumidores que solo necesitan la lista
 * (ej. el botón "Buscar en INO" de Sesiones INO) -- colapsa
 * cualquier fallo a un array vacío, sin distinguir la causa.
 */
export async function getPacienteByPhone(waId: string): Promise<PacienteCandidato[]> {
  const result = await lookupPacienteByPhone(waId);
  return result.ok ? result.pacientes : [];
}

// ============================================================
// Búsqueda por número de ficha (getPacientes.jsp) -- endpoint
// distinto al de arriba (que busca por teléfono contra
// DENT.TELEFONOS). Este trae el detalle completo del paciente,
// incluyendo email, que la query SQL de buscar_paciente_telefono no
// selecciona. Usado por:
//   - "Agregar Paciente INO" en Contactos (búsqueda manual por ficha)
//   - resolve-patient.ts, para completar el email al resolver
//     automáticamente un paciente único desde el primer mensaje
// ============================================================
const DENT_FICHA_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/getPacientes.jsp';

interface RawPacienteFichaRow {
  ficha: string;
  rut: string;
  nombres: string;
  apPaterno: string;
  apMaterno: string;
  estado: string;
  email: string | null;
  telefono: string | null;
}

export interface PacienteFichaDetalle {
  ficha: string;
  nombreCompleto: string;
  telefono: string | null;
  email: string | null;
  estado: string;
}

// El teléfono que devuelve DENT es el número local chileno de 8
// dígitos (celular), sin código de país ni el "9" de móvil -- hay
// que anteponer "569" para armar el wa_id completo. Verificado
// 2026-08-17 contra un contacto real: "95192848" -> "56995192848".
const CHILE_MOBILE_PREFIX = '569';

function toFullPhone(telefonoLocal: string | null): string | null {
  if (!telefonoLocal) return null;
  const digits = telefonoLocal.replace(/\D/g, '');
  if (!digits) return null;
  return `${CHILE_MOBILE_PREFIX}${digits}`;
}

/**
 * Busca el detalle completo de un paciente por número de ficha
 * (pac_codigo). DENT devuelve una fila POR CADA teléfono registrado
 * -- el shape cambia de objeto a array según la cantidad de
 * resultados, normalizado acá para que el consumidor siempre reciba
 * un array.
 */
export async function getPacienteByFicha(ficha: string): Promise<PacienteFichaDetalle[]> {
  const token = process.env.INO_NOTIFY_TOKEN;
  if (!token || !/^\d+$/.test(ficha)) return [];

  const params = new URLSearchParams({ valor: ficha, token });
  try {
    const res = await fetch(`${DENT_FICHA_URL}?${params.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    if (body?.peticion?.exito !== 'TRUE') return [];

    const raw = body?.object?.paciente;
    const rows: RawPacienteFichaRow[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return rows.map((row) => ({
      ficha: row.ficha,
      nombreCompleto: [row.nombres, row.apPaterno, row.apMaterno].filter(Boolean).join(' '),
      telefono: toFullPhone(row.telefono),
      email: row.email || null,
      estado: row.estado,
    }));
  } catch (err) {
    console.error('[getPacienteByFicha] failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
