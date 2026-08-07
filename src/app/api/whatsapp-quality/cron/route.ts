import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { sendInoEmailToMany } from '@/lib/notifications/ino-notify'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Meta flags account health via quality_rating on the phone number:
// GREEN (healthy), YELLOW (degrading), RED (at risk of restriction —
// Meta can throttle or pause the number entirely). Only alert on the
// two unhealthy states; GREEN is the expected steady state and would
// just be daily noise.
const UNHEALTHY_RATINGS = ['YELLOW', 'RED']

/**
 * Daily check of the WhatsApp phone number's quality_rating (Meta's
 * account-health signal). Reuses the same ticket_alert_emails list
 * from migration 043 — this is jefatura-facing operational health,
 * same audience as "a ticket sat unclaimed."
 *
 * Auth: reuses AUTOMATION_CRON_SECRET, same convention as the other
 * cron endpoints in this project.
 *
 * Hosting: once a day is enough — quality_rating doesn't change
 * minute to minute. A dedicated last-sent-date column would prevent
 * duplicate alerts on a bad day; deliberately left simple (fires
 * every run while unhealthy) since a rate-limited number failing
 * silently is worse than an extra email.
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

  const { data: configs, error: configErr } = await admin
    .from('whatsapp_config')
    .select('account_id, phone_number_id, access_token')

  if (configErr) {
    console.error('[whatsapp/quality-cron] config query failed:', configErr.message)
    return NextResponse.json({ error: configErr.message }, { status: 500 })
  }

  const results: Array<{ accountId: string; rating: string | null; alerted: boolean }> = []

  for (const config of configs ?? []) {
    if (!config.phone_number_id || !config.access_token) continue

    let rating: string | null = null
    try {
      const accessToken = decrypt(config.access_token)
      const info = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      rating = info.quality_rating ?? null
    } catch (err) {
      console.error(
        `[whatsapp/quality-cron] verifyPhoneNumber failed for account ${config.account_id}:`,
        err,
      )
      continue
    }

    let alerted = false
    if (rating && UNHEALTHY_RATINGS.includes(rating)) {
      const { data: account } = await admin
        .from('accounts')
        .select('ticket_alert_emails')
        .eq('id', config.account_id)
        .maybeSingle()
      const emails = account?.ticket_alert_emails ?? []
      if (emails.length > 0) {
        const asunto = `wacrm — Calidad de WhatsApp: ${rating}`
        const mensaje = `El número de WhatsApp Business tiene calificación de calidad "${rating}" según Meta.

${rating === 'RED' ? 'RED significa riesgo alto de restricción o bloqueo del número por parte de Meta.' : 'YELLOW significa que la calidad está bajando — conviene revisar antes de que empeore.'}

Revisar en Meta Business Manager, o en wacrm: Configuración → WhatsApp.`
        const { sent } = await sendInoEmailToMany(emails, asunto, mensaje)
        alerted = sent > 0
      }
    }

    results.push({ accountId: config.account_id, rating, alerted })
  }

  return NextResponse.json({ results })
}
