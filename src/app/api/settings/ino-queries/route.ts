// ============================================================
// GET /api/settings/ino-queries
//
// Lista todas las consultas SQL editables que wacrm envía a
// sistema.ino.cl (queryGptJson.jsp). Solo admin/owner -- estas
// queries tocan directo la base productiva DENT del sistema INO,
// no algo que un agente deba poder ver o tocar.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET() {
  try {
    await requireRole('admin');

    const { data, error } = await supabaseAdmin()
      .from('ino_queries')
      .select('id, key, label, description, sql_template, updated_at')
      .order('label', { ascending: true });

    if (error) {
      console.error('[GET /api/settings/ino-queries] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load queries' }, { status: 500 });
    }

    return NextResponse.json({ queries: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
