// ============================================================
// GET /api/historial/stats
//
// Resumen de tickets (conversations) para la cuenta actual: totales por
// estado, duracion promedio de los cerrados, y volumen por dia (ultimos
// 30 dias). Visible para cualquier miembro de la cuenta.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    // Historial y Estadisticas: solo admin/owner, agentes no lo ven.
    const ctx = await requireRole('admin');

    const { data: convs, error } = await ctx.supabase
      .from('conversations')
      .select('status, created_at, updated_at')
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[GET /api/historial/stats] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
    }

    const rows = convs ?? [];
    const total = rows.length;
    const open = rows.filter((c) => c.status === 'open').length;
    const pending = rows.filter((c) => c.status === 'pending').length;
    const closed = rows.filter((c) => c.status === 'closed').length;

    // Duracion de un ticket cerrado = updated_at - created_at. updated_at
    // se toca automaticamente (trigger set_updated_at) cuando se cierra,
    // y no hay mas updates despues de cerrado, asi que sirve de proxy
    // confiable de "closed_at" sin necesitar una columna nueva.
    const durationsHours = rows
      .filter((c) => c.status === 'closed')
      .map((c) => (new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 3_600_000)
      .filter((h) => Number.isFinite(h) && h >= 0);
    const avgDurationHours = durationsHours.length
      ? durationsHours.reduce((a, b) => a + b, 0) / durationsHours.length
      : null;

    // Tickets nuevos por dia, ultimos 30 dias.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const perDayMap = new Map<string, number>();
    for (const c of rows) {
      const t = new Date(c.created_at).getTime();
      if (t < cutoff) continue;
      const day = c.created_at.slice(0, 10);
      perDayMap.set(day, (perDayMap.get(day) ?? 0) + 1);
    }
    const perDay = Array.from(perDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json({
      total,
      open,
      pending,
      closed,
      avgDurationHours,
      perDay,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
