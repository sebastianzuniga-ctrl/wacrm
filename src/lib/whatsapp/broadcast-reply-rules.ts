// ============================================================
// Broadcast reply rules — per-(account, template_name, reply_value)
// action to run when a contact taps a quick-reply button on a
// campaign message (e.g. "SI" / "NO" on a template broadcast).
//
// Looked up from the webhook right after `flagBroadcastReplyIfAny`
// confirms the reply belongs to a recent broadcast. Three action types:
//
//   - send_text: replies with a fixed text via the same sender the
//     Flows engine uses (`engineSendText`).
//   - webhook: POSTs the contact/conversation context to an external
//     URL — fire-and-forget, response ignored.
//   - ai_agent: hands the event off to the account's already-configured
//     AI provider (typically the 'n8n' provider pointing at BotINO
//     Principal or similar) via the same `generateReply` dispatcher the
//     normal chat auto-reply uses, so the account's own workflow logic
//     decides what to do (e.g. kick off an appointment booking) and
//     returns the text to send back to the customer.
//
// Best-effort by design: any failure here is logged and swallowed so
// it never blocks the webhook's 200 ack to Meta.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText } from '@/lib/flows/meta-send'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'

interface DispatchArgs {
  accountId: string
  /** Sender-of-record for outbound sends — same convention as the
   *  Flows engine (the WhatsApp config owner). */
  userId: string
  contactId: string
  conversationId: string
  templateName: string
  /** The tapped button's value, e.g. 'SI' / 'NO'. Exact match against
   *  `broadcast_reply_rules.reply_value`. */
  replyValue: string
}

interface RuleRow {
  action_type: 'send_text' | 'webhook' | 'ai_agent' | 'none'
  action_text: string | null
  webhook_url: string | null
}

export async function dispatchBroadcastReplyRule(
  args: DispatchArgs
): Promise<void> {
  try {
    const db = supabaseAdmin()

    const { data: rule, error } = await db
      .from('broadcast_reply_rules')
      .select('action_type, action_text, webhook_url')
      .eq('account_id', args.accountId)
      .eq('template_name', args.templateName)
      .eq('reply_value', args.replyValue)
      .eq('is_active', true)
      .maybeSingle<RuleRow>()

    if (error) {
      console.error('[broadcast-reply-rules] lookup failed:', error.message)
      return
    }
    if (!rule || rule.action_type === 'none') return

    if (rule.action_type === 'send_text') {
      if (!rule.action_text) return
      await engineSendText({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        text: rule.action_text,
      })
      return
    }

    if (rule.action_type === 'webhook') {
      if (!rule.webhook_url) return
      const { data: contact } = await db
        .from('contacts')
        .select('phone, name')
        .eq('id', args.contactId)
        .maybeSingle()

      await fetch(rule.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'broadcast_reply',
          template_name: args.templateName,
          reply_value: args.replyValue,
          contact_id: args.contactId,
          conversation_id: args.conversationId,
          phone: contact?.phone ?? null,
          name: contact?.name ?? null,
        }),
      }).catch((err) => {
        console.error('[broadcast-reply-rules] webhook POST failed:', err)
      })
      return
    }

    if (rule.action_type === 'ai_agent') {
      // Decoupled from the global auto-reply master switch — this is a
      // deliberately-configured rule, so it should fire even if the
      // general assistant toggle happens to be off.
      const config = await loadAiConfig(db, args.accountId, {
        requireActive: false,
      })
      if (!config) {
        console.error(
          '[broadcast-reply-rules] ai_agent action skipped: no AI provider configured for account',
          args.accountId
        )
        return
      }

      const { data: contact } = await db
        .from('contacts')
        .select('phone')
        .eq('id', args.contactId)
        .maybeSingle()

      const eventText =
        rule.action_text?.trim() ||
        `Customer replied "${args.replyValue}" to the "${args.templateName}" campaign.`

      const result = await generateReply({
        config,
        systemPrompt: config.systemPrompt ?? '',
        messages: [{ role: 'user', content: eventText }],
        conversationId: args.conversationId,
        contactId: args.contactId,
        phone: contact?.phone ?? undefined,
      })

      if (result.text && result.text.trim()) {
        await engineSendText({
          accountId: args.accountId,
          userId: args.userId,
          conversationId: args.conversationId,
          contactId: args.contactId,
          text: result.text,
        })
      }
    }
  } catch (err) {
    console.error('[broadcast-reply-rules] dispatch failed:', err)
  }
}
