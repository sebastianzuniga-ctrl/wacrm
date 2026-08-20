// ============================================================
// Resolución de paciente al llegar el PRIMER mensaje de un número
// (o cualquier contacto que nunca se haya chequeado contra INO).
//
// Se llama desde el webhook de WhatsApp, ANTES de despachar el
// mensaje al proveedor de IA (n8n) -- así el nombre real del
// paciente aparece en el inbox de wacrm desde el primer mensaje, sin
// depender de que n8n complete su propio flujo de resolución.
//
// Reintenta ante fallos de red/timeout (no ante un "no encontrado"
// genuino, que es una respuesta válida). Sincroniza el resultado en
// TRES lugares para que nada quede desincronizado:
//   - contacts (wacrm, Supabase)
//   - sesiones (botino_analytics) -- mismo formato que "Guardar
//     Sesión" en n8n, así n8n no repite la consulta a INO
//   - contacts (botino_analytics) -- idem
// ============================================================
import { getPool } from './sesion';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { lookupPacienteByPhone, getPacienteByFicha, type PacienteCandidato } from './paciente';

const MAX_ATTEMPTS = 3; // 1 intento + 2 reintentos
const RETRY_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ResolvePatientResult {
  outcome: 'single' | 'multiple' | 'not_found' | 'failed';
  pacientes?: PacienteCandidato[];
}

export async function resolvePatientForContact(
  waId: string,
  contactId: string,
  currentEmail: string | null = null,
): Promise<ResolvePatientResult> {
  let result: Awaited<ReturnType<typeof lookupPacienteByPhone>> | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await lookupPacienteByPhone(waId);
    if (result.ok) break;
    console.warn(`[resolve-patient] intento ${attempt}/${MAX_ATTEMPTS} falló para ${waId}: ${result.error}`);
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }

  if (!result || !result.ok) {
    // Todos los intentos fallaron -- NO marcamos pac_lookup_checked_at,
    // para que el próximo mensaje reintente desde cero (ver migración 053).
    console.error(`[resolve-patient] no se pudo resolver ${waId} tras ${MAX_ATTEMPTS} intentos.`);
    return { outcome: 'failed' };
  }

  const pacientes = result.pacientes;
  const checkedAt = new Date().toISOString();

  if (pacientes.length === 0) {
    await supabaseAdmin()
      .from('contacts')
      .update({ es_paciente_ino: false, pac_lookup_checked_at: checkedAt })
      .eq('id', contactId);
    await syncBotinoContacts(waId, { pac_codigo: null, pac_nombre: null, pac_apellido: null, es_paciente_ino: false });
    await syncBotinoSesion(waId, { pac_codigo: '', pac_nombre: null, pac_apellido: null, pacientes_lista: [] });
    return { outcome: 'not_found' };
  }

  if (pacientes.length === 1) {
    const p = pacientes[0];
    const nombreCompleto = `${p.pac_nombre} ${p.pac_apellido}`.trim();

    // La query SQL de buscar_paciente_telefono no trae email -- se
    // completa con una segunda consulta a getPacientes.jsp (mismo
    // endpoint que "Agregar Paciente INO" en Contactos), que sí lo
    // incluye. Best-effort: si falla o no hay email, no bloquea la
    // resolución del nombre/pac_codigo, que es lo más importante.
    // Solo se completa si el contacto NO tenía email ya puesto --
    // nunca pisa un email cargado a mano por un agente.
    let email: string | null = null;
    if (!currentEmail) {
      try {
        const detalle = await getPacienteByFicha(p.pac_codigo);
        email = detalle[0]?.email ?? null;
      } catch (err) {
        console.error('[resolve-patient] getPacienteByFicha failed:', err instanceof Error ? err.message : err);
      }
    }

    await supabaseAdmin()
      .from('contacts')
      .update({
        name: nombreCompleto,
        pac_codigo: p.pac_codigo,
        es_paciente_ino: true,
        pac_lookup_checked_at: checkedAt,
        ...(email ? { email } : {}),
      })
      .eq('id', contactId);
    await syncBotinoContacts(waId, {
      pac_codigo: p.pac_codigo,
      pac_nombre: p.pac_nombre,
      pac_apellido: p.pac_apellido,
      es_paciente_ino: true,
    });
    await syncBotinoSesion(waId, {
      pac_codigo: p.pac_codigo,
      pac_nombre: p.pac_nombre,
      pac_apellido: p.pac_apellido,
      pacientes_lista: pacientes,
    });
    return { outcome: 'single', pacientes };
  }

  // Múltiples candidatos -- no adivinamos cuál es. wacrm mantiene el
  // nombre de WhatsApp tal cual hasta que la persona se identifique.
  // Solo dejamos marcado que se chequeó (wacrm no repite la consulta),
  // pero NO tocamos `sesiones` acá -- si lo hiciéramos con
  // pac_codigo='SELECCIONANDO', el switch "Estado Sesión" de n8n
  // saltaría directo a "Resolver Selección" sin que "Enviar Lista
  // Pacientes" se haya ejecutado nunca, y el paciente recibiría "responde
  // con un número" sin haber visto la lista. Dejamos sesiones intacta
  // para que n8n corra su propia cadena completa (Query INO Paciente ->
  // Resolver Paciente -> Guardar Sesión -> Enviar Lista Pacientes) como
  // si wacrm no hubiera intervenido en este caso puntual.
  await supabaseAdmin()
    .from('contacts')
    .update({ pac_lookup_checked_at: checkedAt })
    .eq('id', contactId);
  return { outcome: 'multiple', pacientes };
}

async function syncBotinoSesion(
  waId: string,
  data: { pac_codigo: string; pac_nombre: string | null; pac_apellido: string | null; pacientes_lista: PacienteCandidato[] },
) {
  const db = getPool();
  if (!db) return;
  try {
    const pacientesJson = JSON.stringify(
      data.pacientes_lista.map((p) => ({
        PAC_CODIGO: Number(p.pac_codigo),
        PAC_NOMBRES: p.pac_nombre,
        PAC_APELLIDO_PATERNO: p.pac_apellido,
        PAC_APELLIDO_MATERNO: p.pac_apellido_materno,
      })),
    );
    await db.query(
      `INSERT INTO sesiones (wa_id, pac_codigo, pac_nombre, pac_apellido, pacientes_lista, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (wa_id) DO UPDATE SET
         pac_codigo = EXCLUDED.pac_codigo,
         pac_nombre = EXCLUDED.pac_nombre,
         pac_apellido = EXCLUDED.pac_apellido,
         pacientes_lista = EXCLUDED.pacientes_lista,
         updated_at = NOW()`,
      [waId, data.pac_codigo, data.pac_nombre, data.pac_apellido, pacientesJson],
    );
  } catch (err) {
    console.error('[resolve-patient] syncBotinoSesion failed:', err instanceof Error ? err.message : err);
  }
}

async function syncBotinoContacts(
  waId: string,
  data: { pac_codigo: string | null; pac_nombre: string | null; pac_apellido: string | null; es_paciente_ino: boolean },
) {
  const db = getPool();
  if (!db) return;
  try {
    await db.query(
      `INSERT INTO contacts (phone_number, pac_codigo, pac_nombre, pac_apellido, es_paciente_ino)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (phone_number) DO UPDATE SET
         pac_codigo = EXCLUDED.pac_codigo,
         pac_nombre = EXCLUDED.pac_nombre,
         pac_apellido = EXCLUDED.pac_apellido,
         es_paciente_ino = EXCLUDED.es_paciente_ino,
         last_seen_at = NOW()`,
      [waId, data.pac_codigo, data.pac_nombre, data.pac_apellido, data.es_paciente_ino],
    );
  } catch (err) {
    console.error('[resolve-patient] syncBotinoContacts failed:', err instanceof Error ? err.message : err);
  }
}
