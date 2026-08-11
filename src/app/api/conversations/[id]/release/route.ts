// ============================================================
// POST /api/conversations/[id]/release — "Liberar conversación"
//
// El ejecutivo dueño del ticket lo devuelve a la cola sin asignar,
// para que otro ejecutivo pueda tomarlo. Deja el bot pausado
// (ai_autoreply_disabled sigue en true) -- no queremos que la IA
// retome sola una conversación que un humano ya identificó como algo
// que necesita atención humana; simplemente cambia de "asignada a mi"
// a "esperando ejecutivo" de nuevo. Reinicia handoff_requested_at
// para que las alertas de tickets (alert-cron) y el dashboard la
// traten como una espera fresca, no la original.
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    // Solo el dueño actual puede liberarla -- evita que un ejecutivo
    // le quite el ticket a otro sin querer.
    const { data: released, error: releaseErr } = await ctx.supabase
      .from('conversations')
      .update({
        assigned_agent_id: null,
        ai_autoreply_disabled: true,
        handoff_requested_at: new Date().toISOString(),
        handoff_alert_last_sent_at: null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('assigned_agent_id', ctx.userId)
      .select('id')
      .maybeSingle();

    if (releaseErr) {
      console.error('[POST /api/conversations/[id]/release] update error:', releaseErr);
      return NextResponse.json(
        { error: 'No se pudo liberar la conversación' },
        { status: 500 }
      );
    }

    if (!released) {
      return NextResponse.json(
        { error: 'Esta conversación no está asignada a ti' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
