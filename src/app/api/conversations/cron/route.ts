import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const CONVERSATION_IDLE_HOURS = 24

/**
 * Sweep open/pending conversations idle 24h+ and close them, even when
 * the contact never sends another message to trigger the reactive
 * check in findOrCreateConversation (src/app/api/whatsapp/webhook/
 * route.ts). Without this, "open conversations" stats stay stale until
 * the next inbound message from that specific contact.
 *
 * Auth: reuses AUTOMATION_CRON_SECRET (same convention as
 * /api/flows/cron) so operators only provision one secret.
 *
 * Hosting: hit on a schedule (cron / systemd timer / external pinger).
 * A 5-minute interval is more than enough for a 24h cutoff.
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
  const cutoff = new Date(Date.now() - CONVERSATION_IDLE_HOURS * 60 * 60 * 1000).toISOString()

  // Two updates instead of one OR'd query: conversations with a
  // last_message_at fall under the first, the (rare) ones that never
  // got a message at all fall back to created_at in the second.
  const { data: updated1, error: err1 } = await admin
    .from('conversations')
    .update({ status: 'closed' })
    .in('status', ['open', 'pending'])
    .lt('last_message_at', cutoff)
    .select('id')

  const { data: updated2, error: err2 } = await admin
    .from('conversations')
    .update({ status: 'closed' })
    .in('status', ['open', 'pending'])
    .is('last_message_at', null)
    .lt('created_at', cutoff)
    .select('id')

  if (err1 || err2) {
    console.error('[conversations-cron] close failed:', err1?.message, err2?.message)
    return NextResponse.json({ error: err1?.message ?? err2?.message }, { status: 500 })
  }

  const swept = (updated1?.length ?? 0) + (updated2?.length ?? 0)
  return NextResponse.json({ swept })
}
