import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendInoEmailToMany } from '@/lib/notifications/ino-notify'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Report window/labels use America/Santiago regardless of server TZ.
const REPORT_TZ = 'America/Santiago'

function santiagoNow(): Date {
  // Reinterpret "now" as if the wall clock were already in Santiago,
  // so simple Date math (getHours/getMinutes, day slicing) lines up
  // with the account's configured local time without a date library.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`
  )
}

function santiagoDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ }).format(d) // YYYY-MM-DD
}

/**
 * Once a day, per account, at the configured local time
 * (accounts.daily_report_time, migration 043), email a business
 * summary: tickets in/closed (manual vs auto 24h sweep), per-agent
 * assignments, handoffs to a human, contacts, DND opt-outs.
 *
 * Idempotent via daily_report_last_sent_date — safe to poll every
 * few minutes without double-sending.
 *
 * Auth: reuses AUTOMATION_CRON_SECRET, same convention as the other
 * cron endpoints in this project.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const nowSantiago = santiagoNow()
  const todayStr = santiagoDateStr(new Date())
  const nowHHMM = `${String(nowSantiago.getHours()).padStart(2, '0')}:${String(
    nowSantiago.getMinutes()
  ).padStart(2, '0')}`

  const { data: accountsRaw, error: acctErr } = await admin
    .from('accounts')
    .select('id, name, daily_report_enabled, daily_report_time, daily_report_emails, daily_report_last_sent_date')
    .eq('daily_report_enabled', true)
  // Filtered in JS instead of via PostgREST array-eq (finicky with the
  // text[] "{}" empty-array literal) — accounts with no configured
  // recipients are simply skipped here.
  const accounts = (accountsRaw ?? []).filter(
    (a) => (a.daily_report_emails ?? []).length > 0
  )

  if (acctErr) {
    console.error('[reports/daily-cron] accounts query failed:', acctErr.message)
    return NextResponse.json({ error: acctErr.message }, { status: 500 })
  }

  const sentFor: string[] = []

  for (const account of accounts ?? []) {
    if (account.daily_report_last_sent_date === todayStr) continue
    // daily_report_time is "HH:MM:SS" from Postgres `time` type.
    const targetHHMM = account.daily_report_time.slice(0, 5)
    if (nowHHMM < targetHHMM) continue // not time yet today

    const dayStart = `${todayStr}T00:00:00-04:00` // Chile continental offset; DST-safe enough for a daily digest
    const dayStartIso = new Date(dayStart).toISOString()

    const [
      { count: newTickets },
      { data: statusEvents },
      { data: assignedEvents },
      { count: openPendingCount },
      { count: newContacts },
      { count: dndOptOuts },
      { count: handoffsToday },
    ] = await Promise.all([
      admin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .gte('created_at', dayStartIso),
      admin
        .from('conversation_events')
        .select('actor_id')
        .eq('account_id', account.id)
        .eq('event_type', 'status_changed')
        .eq('to_value', 'closed')
        .gte('created_at', dayStartIso),
      admin
        .from('conversation_events')
        .select('actor_id')
        .eq('account_id', account.id)
        .eq('event_type', 'assigned')
        .gte('created_at', dayStartIso),
      admin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .in('status', ['open', 'pending']),
      admin
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .gte('created_at', dayStartIso),
      admin
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .eq('do_not_disturb', true)
        .gte('do_not_disturb_at', dayStartIso),
      admin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account.id)
        .not('handoff_requested_at', 'is', null)
        .gte('handoff_requested_at', dayStartIso),
    ])

    const closedManual = (statusEvents ?? []).filter((e) => e.actor_id !== null).length
    const closedAuto = (statusEvents ?? []).filter((e) => e.actor_id === null).length

    const assignedCounts = new Map<string, number>()
    for (const e of assignedEvents ?? []) {
      if (!e.actor_id) continue
      assignedCounts.set(e.actor_id, (assignedCounts.get(e.actor_id) ?? 0) + 1)
    }
    let perAgentLines = '<li>Sin asignaciones registradas hoy.</li>'
    if (assignedCounts.size > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', Array.from(assignedCounts.keys()))
      const nameByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]))
      perAgentLines = Array.from(assignedCounts.entries())
        .map(([userId, n]) => `<li>${nameByUserId.get(userId) ?? 'Agente desconocido'}: ${n} ticket(s) tomado(s)</li>`)
        .join('\n')
    }

    const mensaje = `<p>Informe de negocio — ${account.name ?? 'wacrm'} — ${todayStr}</p>
<ul>
  <li>Tickets nuevos hoy: ${newTickets ?? 0}</li>
  <li>Tickets cerrados hoy: ${(closedManual + closedAuto)} (manual: ${closedManual}, auto-cierre 24h: ${closedAuto})</li>
  <li>Tickets abiertos/pendientes ahora: ${openPendingCount ?? 0}</li>
  <li>Derivados a ejecutiva hoy: ${handoffsToday ?? 0}</li>
  <li>Contactos nuevos hoy: ${newContacts ?? 0}</li>
  <li>Opt-outs "No Molestar" hoy: ${dndOptOuts ?? 0}</li>
</ul>
<p>Tickets tomados por ejecutivo hoy:</p>
<ul>
${perAgentLines}
</ul>`

    const { sent } = await sendInoEmailToMany(
      account.daily_report_emails,
      `wacrm — Informe diario ${todayStr}`,
      mensaje
    )

    if (sent > 0) {
      await admin
        .from('accounts')
        .update({ daily_report_last_sent_date: todayStr })
        .eq('id', account.id)
      sentFor.push(account.id)
    }
  }

  return NextResponse.json({ sentFor })
}
