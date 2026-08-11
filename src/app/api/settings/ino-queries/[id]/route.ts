// ============================================================
// PUT /api/settings/ino-queries/[id]
//
// Actualiza el sql_template de una consulta existente. Solo
// admin/owner. `key` y `label` son inmutables desde acá a propósito
// -- el código las referencia por `key`, cambiarlas rompería el
// lookup en src/lib/ino/*.ts.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const sqlTemplate = typeof body?.sql_template === 'string' ? body.sql_template.trim() : '';
    if (!sqlTemplate) {
      return NextResponse.json({ error: 'sql_template es requerido' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from('ino_queries')
      .update({ sql_template: sqlTemplate, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[PUT /api/settings/ino-queries/[id]] update error:', error);
      return NextResponse.json({ error: 'Failed to update query' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Query no encontrada' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
