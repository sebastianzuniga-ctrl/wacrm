// ============================================================
// "Lock-in" de ficha al confirmar una campaña por WhatsApp.
//
// Un mismo telefono puede recibir campañas para distintas fichas (ej.
// familiares compartiendo numero). Cuando el paciente confirma "SI" en
// el boton de quick-reply, la ficha con la que se envio ESA campaña
// puntual (guardada en broadcast_recipients.ficha, no en
// contacts.pac_codigo) es la señal mas confiable de identidad -- pisa
// cualquier pac_codigo que el contacto ya tuviera.
//
// Sincroniza en los mismos TRES lugares que resolve-patient.ts, para
// que nada quede desincronizado entre wacrm y el bot de n8n.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getPacienteByFicha } from './paciente';
import { getPool } from './sesion';

export async function applyCampaignFicha(
  contactId: string,
  waId: string,
  ficha: string,
): Promise<void> {
  let pacNombre: string | null = null;
  let pacApellido: string | null = null;
  let nombreCompleto: string | null = null;

  try {
    const detalle = await getPacienteByFicha(ficha);
    if (detalle[0]?.nombreCompleto) {
      nombreCompleto = detalle[0].nombreCompleto;
      const parts = nombreCompleto.split(' ');
      pacNombre = parts[0] ?? null;
      pacApellido = parts.slice(1).join(' ') || null;
    }
  } catch (err) {
    console.error(
      '[campaign-ficha] getPacienteByFicha failed (continuing without name):',
      err instanceof Error ? err.message : err,
    );
  }

  const { error: updErr } = await supabaseAdmin()
    .from('contacts')
    .update({
      pac_codigo: ficha,
      es_paciente_ino: true,
      ...(nombreCompleto ? { name: nombreCompleto } : {}),
    })
    .eq('id', contactId);
  if (updErr) {
    console.error('[campaign-ficha] failed to update contacts.pac_codigo:', updErr.message);
  }

  await syncBotinoSesion(waId, ficha, pacNombre, pacApellido);
  await syncBotinoContacts(waId, ficha, pacNombre, pacApellido);
}

async function syncBotinoSesion(
  waId: string,
  ficha: string,
  pacNombre: string | null,
  pacApellido: string | null,
) {
  const db = getPool();
  if (!db) return;
  try {
    // El historial de chat tambien se resetea: es la conversacion de
    // OTRA identidad (ficha vieja), no debe seguir apareciendole al bot
    // como contexto de la persona recien confirmada por campaña.
    await db.query(
      `INSERT INTO sesiones (wa_id, pac_codigo, pac_nombre, pac_apellido, pacientes_lista, historial, updated_at)
       VALUES ($1, $2, $3, $4, '[]', '[]', NOW())
       ON CONFLICT (wa_id) DO UPDATE SET
         pac_codigo = EXCLUDED.pac_codigo,
         pac_nombre = COALESCE(EXCLUDED.pac_nombre, sesiones.pac_nombre),
         pac_apellido = COALESCE(EXCLUDED.pac_apellido, sesiones.pac_apellido),
         pacientes_lista = '[]',
         historial = '[]',
         updated_at = NOW()`,
      [waId, ficha, pacNombre, pacApellido],
    );
  } catch (err) {
    console.error('[campaign-ficha] syncBotinoSesion failed:', err instanceof Error ? err.message : err);
  }
}

async function syncBotinoContacts(
  waId: string,
  ficha: string,
  pacNombre: string | null,
  pacApellido: string | null,
) {
  const db = getPool();
  if (!db) return;
  try {
    await db.query(
      `INSERT INTO contacts (phone_number, pac_codigo, pac_nombre, pac_apellido, es_paciente_ino)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (phone_number) DO UPDATE SET
         pac_codigo = EXCLUDED.pac_codigo,
         pac_nombre = COALESCE(EXCLUDED.pac_nombre, contacts.pac_nombre),
         pac_apellido = COALESCE(EXCLUDED.pac_apellido, contacts.pac_apellido),
         es_paciente_ino = true,
         last_seen_at = NOW()`,
      [waId, ficha, pacNombre, pacApellido],
    );
  } catch (err) {
    console.error('[campaign-ficha] syncBotinoContacts failed:', err instanceof Error ? err.message : err);
  }
}
