// ============================================================
// GET /api/settings/ino-sesiones?search=...
//
// Lista sesiones de botino_analytics (base del bot de n8n, ajena a
// wacrm) para la pantalla de administración manual. Solo admin/owner
// -- esto toca datos operativos del bot en producción.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { listSesiones } from '@/lib/ino/sesion';

export async function GET(request: Request) {
  try {
    await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') ?? undefined;
    const sesiones = await listSesiones(search, 100);
    return NextResponse.json({ sesiones });
  } catch (err) {
    return toErrorResponse(err);
  }
}
