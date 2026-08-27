// ============================================================
// GET /api/ino-paciente-telefono?phone=...
//
// Busca en INO (DENT) los pacientes cuyo teléfono coincide con el
// número dado -- misma query que usa BotINO (buscar_paciente_telefono
// en n8n). Usado por el formulario de Contactos para validar/detectar
// desajustes de ficha al editar un contacto (ver lookupPacienteByPhone
// en src/lib/ino/paciente.ts).
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { lookupPacienteByPhone } from '@/lib/ino/paciente';

export async function GET(request: Request) {
  try {
    await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    if (!phone) {
      return NextResponse.json({ error: "'phone' query param is required" }, { status: 400 });
    }

    const waId = normalizePhone(phone);
    if (!waId) {
      return NextResponse.json({ pacientes: [] });
    }

    const result = await lookupPacienteByPhone(waId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ pacientes: result.pacientes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
