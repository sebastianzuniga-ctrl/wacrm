import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { engineSendInteractiveList } from '@/lib/flows/meta-send'

/**
 * Dispara la encuesta de satisfacción 1-5 al cerrar manualmente un
 * ticket desde el inbox (ver message-thread.tsx handleStatusChange).
 * No se llama desde los auto-cierres (cron 24h, webhook stale-session,
 * automations close_conversation) - solo desde el cierre humano.
 *
 * Apagado por defecto (accounts.satisfaction_survey_enabled=false) -
 * feature completa pero en espera de que jefatura decida activarla.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: conversationId } = await params

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()

  const { data: conv, error: convErr } = await db
    .from('conversations')
    .select('id, account_id, contact_id, satisfaction_survey_sent_at')
    .eq('id', conversationId)
    .maybeSingle()
  if (convErr || !conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  const { data: profile } = await db
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile || profile.account_id !== conv.account_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Ya se mandó una encuesta para este ticket - no reenviar (ej. si el
  // ticket se reabre y se vuelve a cerrar).
  if (conv.satisfaction_survey_sent_at) {
    return NextResponse.json({ skipped: 'already_sent' })
  }

  const { data: account, error: accountErr } = await db
    .from('accounts')
    .select('satisfaction_survey_enabled, satisfaction_survey_message')
    .eq('id', conv.account_id)
    .maybeSingle()
  if (accountErr || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  if (!account.satisfaction_survey_enabled) {
    return NextResponse.json({ skipped: 'disabled' })
  }

  try {
    const result = await engineSendInteractiveList({
      accountId: conv.account_id,
      userId: user.id,
      conversationId: conv.id,
      contactId: conv.contact_id,
      bodyText: account.satisfaction_survey_message,
      buttonLabel: 'Calificar',
      sections: [
        {
          rows: [
            { id: 'survey_rating_5', title: '⭐⭐⭐⭐⭐ Excelente' },
            { id: 'survey_rating_4', title: '⭐⭐⭐⭐ Muy bueno' },
            { id: 'survey_rating_3', title: '⭐⭐⭐ Regular' },
            { id: 'survey_rating_2', title: '⭐⭐ Malo' },
            { id: 'survey_rating_1', title: '⭐ Muy malo' },
          ],
        },
      ],
    })

    await db
      .from('conversations')
      .update({ satisfaction_survey_sent_at: new Date().toISOString() })
      .eq('id', conv.id)

    await db.from('satisfaction_surveys').insert({
      account_id: conv.account_id,
      conversation_id: conv.id,
      contact_id: conv.contact_id,
      whatsapp_message_id: result.whatsapp_message_id,
    })

    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('[send-survey] error enviando encuesta:', err)
    return NextResponse.json({ error: 'send_failed' }, { status: 500 })
  }
}
