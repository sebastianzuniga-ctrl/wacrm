import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadBusinessHours, isWithinBusinessHours } from '@/lib/ino/business-hours'
import { engineSendText } from '@/lib/flows/meta-send'

/**
 * Corre cada 5 min. Por cada cuenta con business_hours_enabled=true que
 * está fuera de horario AHORA, revierte los tickets que quedaron
 * esperando ejecutivo (handoff_requested_at set, sin asignar, sin
 * cerrar) de vuelta a la IA: limpia el estado de handoff y le informa
 * al cliente que por horario no hay ejecutivo disponible. Idempotente —
 * una vez revertido el ticket deja de matchear el filtro.
 *
 * IMPORTANTE: si el ticket YA fue tomado por un agente (assigned_agent_id
 * no nulo) NO se toca — un humano lo está atendiendo, el horario de
 * atención del bot no aplica a ese caso.
 */
export async function GET(request: Request) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== process.env.AUTOMATION_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  let checked = 0
  let reverted = 0

  const { data: accounts, error: accountsErr } = await db
    .from('accounts')
    .select(
      'id, business_hours_enabled, business_hours_days, business_hours_start, business_hours_end, business_hours_closed_message',
    )
    .eq('business_hours_enabled', true)

  if (accountsErr) {
    console.error('[hours-revert-cron] error listando cuentas:', accountsErr)
    return NextResponse.json({ error: 'query failed' }, { status: 500 })
  }

  for (const account of accounts ?? []) {
    checked++
    const bh = await loadBusinessHours(db, account.id)
    if (!bh || isWithinBusinessHours(bh)) continue // sigue en horario, no tocar

    const { data: pending, error: pendingErr } = await db
      .from('conversations')
      .select('id, contact_id')
      .eq('account_id', account.id)
      .is('assigned_agent_id', null)
      .neq('status', 'closed')
      .not('handoff_requested_at', 'is', null)

    if (pendingErr || !pending || pending.length === 0) continue

    const { data: configRow } = await db
      .from('whatsapp_config')
      .select('user_id')
      .eq('account_id', account.id)
      .maybeSingle()
    const configOwnerUserId = configRow?.user_id
    if (!configOwnerUserId) continue // sin config de WhatsApp, no se puede enviar

    for (const conv of pending) {
      const { error: updateErr } = await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: false,
          handoff_requested_at: null,
          handoff_alert_last_sent_at: null,
        })
        .eq('id', conv.id)

      if (updateErr) {
        console.error(
          `[hours-revert-cron] error revirtiendo conversación ${conv.id}:`,
          updateErr,
        )
        continue
      }

      try {
        await engineSendText({
          accountId: account.id,
          userId: configOwnerUserId,
          conversationId: conv.id,
          contactId: conv.contact_id,
          text: bh.business_hours_revert_message,
          aiGenerated: true,
        })
      } catch (sendErr) {
        console.error(
          `[hours-revert-cron] error enviando mensaje a conversación ${conv.id}:`,
          sendErr,
        )
      }
      reverted++
    }
  }

  return NextResponse.json({ checked, reverted })
}
