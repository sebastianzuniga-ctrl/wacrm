// ============================================================
// POST /api/ino-clear-esperando-rut
//
// Saca a un contacto del sentinel ESPERANDO_RUT/SELECCIONANDO en
// botino_analytics.sesiones cuando wacrm ya resolvio su ficha real
// por otra via (validador manual en editar contacto, boton
// "Actualizar desde INO" en el inbox). Usado desde componentes
// cliente que no tienen acceso directo a pg -- ver clearEsperandoRut
// en src/lib/ino/sesion.ts para el detalle de por que hace falta esto
// (bug real detectado 2026-08-28).
//
// Best-effort: cualquier fallo se loguea y se ignora, nunca debe
// bloquear el flujo principal de actualizar el contacto.
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { clearEsperandoRut } from '@/lib/ino/sesion';

export async function POST(request: Request) {
  try {
    await getCurrentAccount();

    const body = await request.json().catch(() => null);
    if (!body?.phone || !body?.pac_codigo) {
      return NextResponse.json({ error: 'phone y pac_codigo son requeridos' }, { status: 400 });
    }

    const waId = normalizePhone(body.phone);
    if (!waId) {
      return NextResponse.json({ ok: false });
    }

    const ok = await clearEsperandoRut(
      waId,
      String(body.pac_codigo),
      typeof body.pac_nombre === 'string' ? body.pac_nombre : null,
      typeof body.pac_apellido === 'string' ? body.pac_apellido : null
    );

    return NextResponse.json({ ok });
  } catch (err) {
    return toErrorResponse(err);
  }
}
