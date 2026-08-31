// ============================================================
// POST /api/conversations/[id]/handoff — "Derivar a ejecutivo"
//
// Boton manual en el header del inbox (pedido 2026-08-28): un
// admin/agente que ve que el paciente necesita ayuda humana (y el
// bot no lo detecto o no ejecuto la derivacion correctamente) puede
// forzarla el mismo, sin esperar a que el bot la dispare solo.
//
// Replica exactamente el mismo mecanismo que ya usa el handoff
// automatico de la IA propia de wacrm (ver dispatchInboundToAiReply
// en src/lib/ai/auto-reply.ts): pausa el bot, deja el ticket en la
// cola compartida (o lo asigna al agente de handoff configurado) para
// que alguien lo "tome" via /claim, y le avisa al paciente. Mismo
// criterio de horario de atencion: si esta fuera de horario, solo se
// informa con el mensaje ya configurado, sin pausar el bot ni asignar
// -- no hay nadie para tomar el ticket ahora mismo.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { loadAiConfig } from '@/lib/ai/config';
import { loadBusinessHours, isWithinBusinessHours } from '@/lib/ino/business-hours';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: conv, error: convErr } = await ctx.supabase
      .from('conversations')
      .select('id, contact_id, assigned_agent_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (convErr) {
      console.error('[POST /api/conversations/[id]/handoff] fetch error:', convErr);
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Fuera de horario: no hay ejecutivos disponibles para tomar el
    // ticket -- solo informar, sin pausar el bot ni asignar a nadie.
    // Mismo criterio que el handoff automatico de la IA.
    const bh = await loadBusinessHours(ctx.supabase, ctx.accountId);
    if (bh && !isWithinBusinessHours(bh)) {
      await sendMessageToConversation(ctx.supabase, ctx.accountId, {
        conversationId: id,
        messageType: 'text',
        contentText: bh.business_hours_closed_message,
      });
      return NextResponse.json({ success: true, withinHours: false });
    }

    const { data: profile } = await ctx.supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const agentName = profile?.full_name?.trim() || 'un agente';

    const config = await loadAiConfig(ctx.supabase, ctx.accountId, { requireActive: false });

    const update: Record<string, unknown> = {
      ai_autoreply_disabled: true,
      ai_handoff_summary: `Derivación manual solicitada por ${agentName}.`,
      handoff_requested_at: new Date().toISOString(),
      handoff_alert_last_sent_at: null,
    };
    // Nunca pisar una asignacion humana ya existente.
    if (config?.handoffAgentId && !conv.assigned_agent_id) {
      update.assigned_agent_id = config.handoffAgentId;
    }

    const { error: updateErr } = await ctx.supabase
      .from('conversations')
      .update(update)
      .eq('id', id);

    if (updateErr) {
      console.error('[POST /api/conversations/[id]/handoff] update error:', updateErr);
      return NextResponse.json({ error: 'Failed to hand off conversation' }, { status: 500 });
    }

    await sendMessageToConversation(ctx.supabase, ctx.accountId, {
      conversationId: id,
      messageType: 'text',
      contentText: 'Te voy a derivar con un ejecutivo de nuestro equipo, en breve te contactan por este mismo medio 😊',
    });

    return NextResponse.json({ success: true, withinHours: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
