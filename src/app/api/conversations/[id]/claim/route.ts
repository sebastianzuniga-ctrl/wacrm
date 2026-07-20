// ============================================================
// POST /api/conversations/[id]/claim — "Tomar contacto"
//
// An agent claims an unassigned conversation (typically one the AI
// handed off) and the customer gets a greeting so they know a human
// picked up. First-come-first-served: the update only succeeds if
// nobody has been assigned yet, so two agents clicking at the same
// moment can't both "win" the same thread.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    // Atomic claim: only succeeds while assigned_agent_id is still null.
    const { data: claimed, error: claimErr } = await ctx.supabase
      .from('conversations')
      .update({ assigned_agent_id: ctx.userId })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('assigned_agent_id', null)
      .select('id')
      .maybeSingle();

    if (claimErr) {
      console.error('[POST /api/conversations/[id]/claim] update error:', claimErr);
      return NextResponse.json(
        { error: 'Failed to claim conversation' },
        { status: 500 }
      );
    }

    if (!claimed) {
      // Either it's not in this account, or someone already claimed it.
      const { data: existing } = await ctx.supabase
        .from('conversations')
        .select('id')
        .eq('id', id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'This conversation was already claimed by someone else' },
        { status: 409 }
      );
    }

    // Greet the customer so they know a human picked up. Best-effort —
    // the claim itself already succeeded, so a send failure here
    // shouldn't fail the whole request.
    try {
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', ctx.userId)
        .maybeSingle();
      const agentName = profile?.full_name?.trim() || 'nuestro equipo';

      await sendMessageToConversation(ctx.supabase, ctx.accountId, {
        conversationId: id,
        messageType: 'text',
        contentText: `Hola, soy ${agentName}. ¿En qué puedo ayudarte? 😊`,
      });
    } catch (err) {
      console.error('[POST /api/conversations/[id]/claim] greeting send failed:', err);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
