// ============================================================
// PUT/DELETE /api/settings/ino-sesiones/[waId]
//
// Edita o borra una fila de sesiones en botino_analytics. Solo
// admin/owner. Ver src/lib/ino/sesion.ts (updateSesion/deleteSesion)
// y scripts/grant-botino-write.sql (permisos de escritura otorgados
// a wacrm_readonly para esta tabla puntual).
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { updateSesion, deleteSesion } from '@/lib/ino/sesion';

export async function PUT(request: Request, { params }: { params: Promise<{ waId: string }> }) {
  try {
    await requireRole('admin');
    const { waId } = await params;

    // Ahora que updateSesion hace upsert (puede crear filas nuevas,
    // no solo editar), validar el formato antes de escribir --
    // evita crear filas con wa_id vacío o basura.
    if (!/^\d{6,20}$/.test(waId)) {
      return NextResponse.json({ error: 'wa_id inválido (debe ser solo dígitos)' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
    }

    // pacientes_lista debe ser JSON válido (array) o vacío -- validar
    // antes de escribir para no dejar la fila en un estado que rompa
    // JSON.parse() en getFichaActivaByPhone() más adelante.
    const pacientesLista = typeof body.pacientes_lista === 'string' ? body.pacientes_lista.trim() : '';
    if (pacientesLista) {
      try {
        const parsed = JSON.parse(pacientesLista);
        if (!Array.isArray(parsed)) {
          return NextResponse.json({ error: 'pacientes_lista debe ser un array JSON' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'pacientes_lista no es JSON válido' }, { status: 400 });
      }
    }

    const ok = await updateSesion(waId, {
      pac_codigo: typeof body.pac_codigo === 'string' && body.pac_codigo.trim() ? body.pac_codigo.trim() : null,
      pac_nombre: typeof body.pac_nombre === 'string' && body.pac_nombre.trim() ? body.pac_nombre.trim() : null,
      pac_apellido: typeof body.pac_apellido === 'string' && body.pac_apellido.trim() ? body.pac_apellido.trim() : null,
      pacientes_lista: pacientesLista || null,
    });

    if (!ok) {
      return NextResponse.json({ error: 'No se pudo actualizar la sesión' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ waId: string }> }) {
  try {
    await requireRole('admin');
    const { waId } = await params;
    const ok = await deleteSesion(waId);
    if (!ok) {
      return NextResponse.json({ error: 'No se pudo eliminar la sesión' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
