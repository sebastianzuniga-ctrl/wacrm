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

/**
 * Sweep conversations waiting on a human (handoff_requested_at set,
 * still unassigned, not closed) and email jefatura when nobody claims
 * one within the account's configured threshold. Per-account settings
 * (migration 043): ticket_alert_enabled, ticket_alert_threshold_minutes,
 * ticket_alert_repeat(+_minutes), ticket_alert_emails.
 *
 * Auth: reuses AUTOMATION_CRON_SECRET, same convention as
 * /api/conversations/cron and /api/flows/cron.
 *
 * Hosting: hit every 1 minute — the threshold itself can be as low as
 * 1 minute, so the sweep interval has to be tight too.
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
  const now = new Date()

  const { data: accountsRaw, error: acctErr } = await admin
    .from('accounts')
    .select(
      'id, ticket_alert_enabled, ticket_alert_threshold_minutes, ticket_alert_repeat, ticket_alert_repeat_minutes, ticket_alert_emails'
    )
    .eq('ticket_alert_enabled', true)
  // Filtered in JS instead of via PostgREST array-eq (finicky with the
  // text[] "{}" empty-array literal) — accounts with no configured
  // recipients are simply skipped here.
  const accounts = (accountsRaw ?? []).filter(
    (a) => (a.ticket_alert_emails ?? []).length > 0
  )

  if (acctErr) {
    console.error('[tickets/alert-cron] accounts query failed:', acctErr.message)
    return NextResponse.json({ error: acctErr.message }, { status: 500 })
  }

  let checked = 0
  let alerted = 0

  for (const account of accounts ?? []) {
    const thresholdCutoff = new Date(
      now.getTime() - account.ticket_alert_threshold_minutes * 60 * 1000
    ).toISOString()

    const { data: pending, error: convErr } = await admin
      .from('conversations')
      .select('id, contact_id, handoff_requested_at, handoff_alert_last_sent_at, contacts(name, phone)')
      .eq('account_id', account.id)
      .is('assigned_agent_id', null)
      .neq('status', 'closed')
      .not('handoff_requested_at', 'is', null)
      .lt('handoff_requested_at', thresholdCutoff)

    if (convErr) {
      console.error(
        `[tickets/alert-cron] conversations query failed for account ${account.id}:`,
        convErr.message
      )
      continue
    }

    for (const conv of pending ?? []) {
      checked++
      const alreadyAlerted = !!conv.handoff_alert_last_sent_at

      if (alreadyAlerted) {
        // Already sent once — only send again if repeat is on AND the
        // repeat interval has elapsed since the last alert.
        if (!account.ticket_alert_repeat) continue
        const repeatCutoff = new Date(
          now.getTime() - account.ticket_alert_repeat_minutes * 60 * 1000
        ).toISOString()
        if (conv.handoff_alert_last_sent_at! >= repeatCutoff) continue
      }

      const minutesWaiting = Math.round(
        (now.getTime() - new Date(conv.handoff_requested_at!).getTime()) / 60000
      )
      // Supabase returns the joined row as an object here (FK relation,
      // not an array) despite the client's default array typing for
      // embedded resources — cast defensively either way.
      const contactRaw = (conv as unknown as { contacts?: { name: string | null; phone: string } | { name: string | null; phone: string }[] }).contacts
      const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw
      const contactLabel = contact?.name || contact?.phone || 'Contacto sin nombre'
      const primaryLink = `https://wspcrm.ino.cl/inbox?c=${conv.id}`
      const fallbackLink = `http://192.168.0.123:3001/inbox?c=${conv.id}`
      const asunto = `wacrm — Ticket sin atender (${contactLabel})`
      const mensaje = `Hay un ticket esperando ejecutivo hace ${minutesWaiting} minuto(s) sin ser tomado.

Contacto: ${contactLabel}${contact?.phone ? ` (${contact.phone})` : ''}

Ver ticket: ${primaryLink}
Si el link anterior no carga (fuera de la red de la clínica), usa: ${fallbackLink}`

      const { sent } = await sendInoEmailToMany(
        account.ticket_alert_emails,
        asunto,
        mensaje
      )

      if (sent > 0) {
        alerted++
        await admin
          .from('conversations')
          .update({ handoff_alert_last_sent_at: now.toISOString() })
          .eq('id', conv.id)
      }
    }
  }

  return NextResponse.json({ checked, alerted })
}
