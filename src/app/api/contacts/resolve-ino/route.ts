// ============================================================
// POST /api/contacts/resolve-ino
//
// Botón manual "Revisar y completar" en Contactos. Recorre los
// contactos de la cuenta que quedaron sin nombre real (name === phone
// -- el marcador que deja findOrCreateContact cuando el input no
// traía 'name') y, para cada uno:
//   - Si tiene pac_codigo: resuelve el nombre real via getPacienteByFicha
//     (sin ambigüedad posible, la ficha ya es específica).
//   - Si NO tiene pac_codigo: intenta via lookupPacienteByPhone: solo
//     aplica si hay EXACTAMENTE un paciente para ese teléfono.
// Nunca adivina en casos ambiguos -- esos quedan igual para revisión
// manual (el modal de editar contacto ya valida/ofrece aplicar).
//
// Se ejecuta manualmente (no cron) para no golpear INO en horarios
// aleatorios -- ver conversación 2026-08-27.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getPacienteByFicha, lookupPacienteByPhone } from '@/lib/ino/paciente';
import { clearEsperandoRut } from '@/lib/ino/sesion';

interface ContactRow {
  id: string;
  phone: string;
  pac_codigo: string | null;
}

export async function POST() {
  try {
    const ctx = await requireRole('agent');
    const db = supabaseAdmin();

    const { data: rows, error } = await db
      .from('contacts')
      .select('id, phone, name, pac_codigo')
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[resolve-ino] fetch error:', error);
      return NextResponse.json({ error: 'No se pudo leer contactos' }, { status: 500 });
    }

    const pending = (rows ?? []).filter(
      (r) => r.name === r.phone
    ) as ContactRow[];

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const contact of pending) {
      try {
        if (contact.pac_codigo) {
          const detalles = await getPacienteByFicha(contact.pac_codigo);
          const nombre = detalles[0]?.nombreCompleto;
          if (!nombre) {
            skipped++;
            continue;
          }
          // es_paciente_ino=true evita que el webhook pise este nombre
          // real con el nombre de perfil de WhatsApp en el proximo
          // mensaje entrante -- bug real detectado 2026-08-28.
          await db.from('contacts').update({ name: nombre, es_paciente_ino: true }).eq('id', contact.id);
          await clearEsperandoRut(contact.phone, contact.pac_codigo, nombre, null);
          updated++;
        } else {
          const result = await lookupPacienteByPhone(contact.phone);
          if (!result.ok) {
            skipped++;
            continue;
          }
          const unique = new Map(result.pacientes.map((p) => [p.pac_codigo, p]));
          if (unique.size !== 1) {
            skipped++; // ambiguo o sin match -- no adivinar
            continue;
          }
          const paciente = [...unique.values()][0];
          const nombreCompleto = [
            paciente.pac_nombre,
            paciente.pac_apellido,
            paciente.pac_apellido_materno,
          ]
            .filter(Boolean)
            .join(' ');
          await db
            .from('contacts')
            .update({ pac_codigo: paciente.pac_codigo, name: nombreCompleto, es_paciente_ino: true })
            .eq('id', contact.id);
          await clearEsperandoRut(contact.phone, paciente.pac_codigo, paciente.pac_nombre, paciente.pac_apellido);
          updated++;
        }
      } catch (err) {
        console.error('[resolve-ino] contact', contact.id, 'failed:', err);
        failed++;
      }
    }

    return NextResponse.json({ total: pending.length, updated, skipped, failed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
