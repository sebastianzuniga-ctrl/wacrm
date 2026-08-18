// ============================================================
// GET /api/ino-paciente-ficha?ficha=XXXX
//
// Busca en INO (DENT) los datos de un paciente por número de ficha,
// vía getPacientes.jsp. Usado por "Agregar Paciente INO" en
// Contactos para autocompletar nombre/teléfono/correo.
//
// La consulta real vive en src/lib/ino/paciente.ts
// (getPacienteByFicha), compartida con resolve-patient.ts (que la
// usa para completar el email al resolver automáticamente un
// paciente único desde el primer mensaje de WhatsApp).
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getPacienteByFicha } from '@/lib/ino/paciente';

export async function GET(request: Request) {
  try {
    // Sin restricción de rol -- mismo criterio que Contactos hoy,
    // cualquier miembro de la cuenta puede agregar contactos.
    await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const ficha = searchParams.get('ficha')?.trim();
    if (!ficha || !/^\d+$/.test(ficha)) {
      return NextResponse.json({ error: 'ficha inválida' }, { status: 400 });
    }

    const pacientes = await getPacienteByFicha(ficha);
    return NextResponse.json({ pacientes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
