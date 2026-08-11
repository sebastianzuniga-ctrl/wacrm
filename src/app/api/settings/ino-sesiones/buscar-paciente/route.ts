// ============================================================
// GET /api/settings/ino-sesiones/buscar-paciente?wa_id=...
//
// Busca en INO (DENT) los pacientes asociados a un teléfono, para
// autocompletar el formulario de edición en Sesiones INO. Solo
// admin/owner.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getPacienteByPhone } from '@/lib/ino/paciente';

export async function GET(request: Request) {
  try {
    await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const waId = searchParams.get('wa_id');
    if (!waId) {
      return NextResponse.json({ error: "'wa_id' es requerido" }, { status: 400 });
    }
    const pacientes = await getPacienteByPhone(waId);
    return NextResponse.json({ pacientes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
