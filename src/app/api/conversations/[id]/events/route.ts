// ============================================================
// GET /api/conversations/[id]/events
//
// Historial de auditoria de un ticket: cambios de estado y de
// agente asignado, capturados automaticamente por el trigger
// trg_log_conversation_changes (migracion 042). Cualquier
// miembro de la cuenta puede verlo -- es informativo sobre un
// ticket al que ya tiene acceso via RLS de conversations.
//
// actor_name / from_name / to_name vienen en null cuando no hay
// usuario que resolver (evento del sistema, o perfil ausente) --
// el frontend decide el texto ("Sistema"/"System"/"시스템") segun
// el idioma via next-intl, en vez de que el backend hardcodee un
// idioma.
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const { data: events, error } = await ctx.supabase
      .from('conversation_events')
      .select('id, event_type, from_value, to_value, actor_id, created_at')
      .eq('conversation_id', id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/conversations/[id]/events] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load events' }, { status: 500 });
    }

    // Collect every user id we need a display name for: the actor on
    // every event, plus the old/new assignee on assign/unassign events
    // (those are plain-text columns, not FKs, so we resolve them the
    // same way as actor_id via a single batched profiles lookup).
    const idsToResolve = new Set<string>();
    for (const e of events ?? []) {
      if (e.actor_id) idsToResolve.add(e.actor_id);
      if (e.event_type !== 'status_changed') {
        if (e.from_value && UUID_RE.test(e.from_value)) idsToResolve.add(e.from_value);
        if (e.to_value && UUID_RE.test(e.to_value)) idsToResolve.add(e.to_value);
      }
    }

    let namesByUserId = new Map<string, string>();
    if (idsToResolve.size > 0) {
      const { data: profiles } = await ctx.supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', Array.from(idsToResolve));
      namesByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
    }

    const resolveAssignee = (value: string | null) =>
      value ? namesByUserId.get(value) ?? null : null;

    const enriched = (events ?? []).map((e) => ({
      id: e.id,
      event_type: e.event_type,
      from_value: e.from_value,
      to_value: e.to_value,
      from_name: e.event_type === 'status_changed' ? null : resolveAssignee(e.from_value),
      to_name: e.event_type === 'status_changed' ? null : resolveAssignee(e.to_value),
      created_at: e.created_at,
      actor_name: e.actor_id ? namesByUserId.get(e.actor_id) ?? null : null,
    }));

    return NextResponse.json({ events: enriched });
  } catch (err) {
    return toErrorResponse(err);
  }
}
