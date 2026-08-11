// ============================================================
// GET /api/ino-ficha?phone=...
//
// Devuelve la ficha/paciente activo que el bot de n8n (BotINO
// Principal) tiene asociado a este telefono en este momento --
// lectura en vivo desde la base botino_analytics (rol de solo
// lectura). Ver src/lib/ino/sesion.ts.
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { getFichaActivaByPhone } from '@/lib/ino/sesion';
import { getCitasByPacCodigo } from '@/lib/ino/citas';

export async function GET(request: Request) {
  try {
    // Solo confirma que hay una sesion valida de wacrm -- cualquier
    // miembro de la cuenta puede ver esto (es informativo, no hay rol
    // especifico requerido).
    await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone');
    if (!phone) {
      return NextResponse.json({ error: "'phone' query param is required" }, { status: 400 });
    }

    const waId = normalizePhone(phone);
    if (!waId) {
      return NextResponse.json({ ficha: null });
    }

    const ficha = await getFichaActivaByPhone(waId);

    // Citas actuales/futuras -- solo si hay una ficha activa
    // resuelta a un pac_codigo real (no aplica a los estados
    // 'seleccionando' / 'esperando_rut' / 'sin_sesion').
    const citas =
      ficha?.estado === 'activa' && ficha.pac_codigo
        ? await getCitasByPacCodigo(ficha.pac_codigo)
        : [];

    return NextResponse.json({ ficha, citas });
  } catch (err) {
    return toErrorResponse(err);
  }
}
