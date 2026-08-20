import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { renderTemplatePreview } from '@/lib/whatsapp/broadcast-core'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
// import { findExistingContact } from '@/lib/contacts/dedupe' // sin uso: filtro do_not_disturb deshabilitado 2026-08-20
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
// Throttle entre envios para no mandar en rafaga (buena practica de
// quality-rating de Meta). El valor real (mensajes/minuto) es
// configurable por cuenta en Configuracion > WhatsApp
// (accounts.broadcast_messages_per_minute, migration 039); aqui solo
// convertimos ese numero a un delay en ms entre destinatarios.
const DEFAULT_MESSAGES_PER_MINUTE = 60
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed' | 'skipped'
  whatsapp_message_id?: string
  error?: string
}
interface NewRecipient {
  phone: string
  params?: string[]
  messageParams?: SendTimeParams
}
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }
    const { data: accountRow } = await supabase
      .from('accounts')
      .select('broadcast_messages_per_minute')
      .eq('id', accountId)
      .maybeSingle()
    const messagesPerMinute =
      accountRow?.broadcast_messages_per_minute ?? DEFAULT_MESSAGES_PER_MINUTE
    const sendDelayMs = Math.max(
      0,
      Math.round(60000 / (messagesPerMinute || DEFAULT_MESSAGES_PER_MINUTE)),
    )
    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }
    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()
    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }
    const accessToken = decrypt(config.access_token)
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .maybeSingle()
    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    const templateRow = rawTemplateRow ?? null
    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0
    const skippedCount = 0
    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)
      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }
      // Ley No Molestar / SERNAC: el filtro local do_not_disturb quedo
      // DESHABILITADO (2026-08-20) -- fuente de verdad ahora es INO
      // (audiencias pre-filtradas, ver src/lib/ino/no-molestar.ts).
      //
      // const existingContact = await findExistingContact(supabase, accountId, sanitized)
      // if (existingContact?.do_not_disturb) {
      //   results.push({
      //     phone: recipient.phone,
      //     status: 'skipped',
      //     error: 'Contact opted out of campaigns (do not disturb)',
      //   })
      //   skippedCount++
      //   continue
      // }
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null
      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
        }
      }
      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
        try {
          const { conversationId } = await resolveConversationByPhone(
            supabase,
            accountId,
            recipient.phone
          )
          const previewText = renderTemplatePreview(
            templateRow,
            recipient.params ?? [],
            template_name
          )
          await supabase.from('messages').insert({
            conversation_id: conversationId,
            sender_type: 'agent',
            content_type: 'template',
            content_text: previewText,
            media_url: null,
            template_name: template_name,
            interactive_payload: null,
            message_id: sentMessageId,
            status: 'sent',
            reply_to_message_id: null,
          })
        } catch (err) {
          console.error(
            '[whatsapp/broadcast] failed to log outbound message to inbox:',
            err
          )
        }
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
      }

      // Pausa entre destinatarios (evita rafagas de envio).
      if (sendDelayMs > 0) {
        await sleep(sendDelayMs)
      }
    }
    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
