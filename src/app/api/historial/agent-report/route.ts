// ============================================================
// GET /api/historial/agent-report?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Reporte de acceso y actividad por agente (requerimiento
// 2026-08-17): último acceso y conversaciones atendidas dentro del
// rango de fechas indicado (histórico completo, incluye
// reasignadas), desglosadas por estado ACTUAL de la conversación.
//
// Sin from/to -> trae todo el histórico (comportamiento original).
// El rango filtra por assigned_at de agent_assignment_events
// (migration 056): cualquier evento de asignación dentro del rango
// cuenta, según se acordó con el usuario.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    // Mismo criterio que /api/historial/stats: solo admin/owner.
    const ctx = await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (from && Number.isNaN(Date.parse(from))) return bad('from inválido');
    if (to && Number.isNaN(Date.parse(to))) return bad('to inválido');

    // `from`/`to` llegan como YYYY-MM-DD (fecha local de Chile, sin
    // hora). Interpretados tal cual, JS/Postgres los toman como
    // medianoche UTC -- con Chile en UTC-4/-3 eso corta el día ~4-5
    // horas antes de lo que el admin espera, y en particular `to`
    // excluiría el día completo en vez de incluirlo. Chile no usa DST
    // hace unos años (UTC-4 fijo), así que un offset fijo es seguro
    // acá; si eso cambiara habría que resolver el offset dinámicamente.
    const CHILE_UTC_OFFSET = '-04:00';
    const fromIso = from ? `${from}T00:00:00${CHILE_UTC_OFFSET}` : null;
    const toIso = to ? `${to}T23:59:59.999${CHILE_UTC_OFFSET}` : null;

    // 1. Perfiles + último acceso (siempre "todo el tiempo", no tiene
    //    sentido filtrar el último acceso por rango).
    const { data: profiles, error: profilesErr } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, email, account_role')
      .eq('account_id', ctx.accountId);
    if (profilesErr) {
      console.error('[GET /api/historial/agent-report] profiles fetch error:', profilesErr);
      return NextResponse.json({ error: 'Failed to load report' }, { status: 500 });
    }

    const { data: presence, error: presenceErr } = await ctx.supabase
      .from('member_presence')
      .select('user_id, last_seen_at, status')
      .eq('account_id', ctx.accountId);
    if (presenceErr) {
      console.error('[GET /api/historial/agent-report] presence fetch error:', presenceErr);
      return NextResponse.json({ error: 'Failed to load report' }, { status: 500 });
    }
    const presenceByUser = new Map((presence ?? []).map((p) => [p.user_id, p]));

    // 2. Eventos de asignación en el rango pedido.
    let eventsQuery = ctx.supabase
      .from('agent_assignment_events')
      .select('agent_id, conversation_id, assigned_at')
      .eq('account_id', ctx.accountId);
    if (fromIso) eventsQuery = eventsQuery.gte('assigned_at', fromIso);
    if (toIso) eventsQuery = eventsQuery.lte('assigned_at', toIso);
    const { data: events, error: eventsErr } = await eventsQuery;
    if (eventsErr) {
      console.error('[GET /api/historial/agent-report] events fetch error:', eventsErr);
      return NextResponse.json({ error: 'Failed to load report' }, { status: 500 });
    }

    // 3. Estado actual de las conversaciones involucradas (para el
    //    desglose abiertas/pendientes/cerradas).
    const conversationIds = Array.from(new Set((events ?? []).map((e) => e.conversation_id)));
    const statusByConv = new Map<string, string>();
    if (conversationIds.length > 0) {
      const { data: convs, error: convsErr } = await ctx.supabase
        .from('conversations')
        .select('id, status')
        .in('id', conversationIds);
      if (convsErr) {
        console.error('[GET /api/historial/agent-report] conversations fetch error:', convsErr);
        return NextResponse.json({ error: 'Failed to load report' }, { status: 500 });
      }
      for (const c of convs ?? []) statusByConv.set(c.id, c.status);
    }

    // 4. Agregar: conversaciones DISTINTAS atendidas por agente
    //    (una conversación con 3 reasignaciones al mismo agente en el
    //    rango cuenta una sola vez).
    const convsByAgent = new Map<string, Set<string>>();
    for (const e of events ?? []) {
      if (!convsByAgent.has(e.agent_id)) convsByAgent.set(e.agent_id, new Set());
      convsByAgent.get(e.agent_id)!.add(e.conversation_id);
    }

    const agents = (profiles ?? []).map((p) => {
      const convIds = convsByAgent.get(p.user_id) ?? new Set<string>();
      let open_count = 0;
      let pending_count = 0;
      let closed_count = 0;
      for (const cid of convIds) {
        const status = statusByConv.get(cid);
        if (status === 'open') open_count++;
        else if (status === 'pending') pending_count++;
        else if (status === 'closed') closed_count++;
      }
      const pres = presenceByUser.get(p.user_id);
      return {
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        account_role: p.account_role,
        last_seen_at: pres?.last_seen_at ?? null,
        presence_status: pres?.status ?? null,
        total_attended: convIds.size,
        open_count,
        pending_count,
        closed_count,
      };
    });

    agents.sort((a, b) => b.total_attended - a.total_attended);

    return NextResponse.json({ agents });
  } catch (err) {
    return toErrorResponse(err);
  }
}
