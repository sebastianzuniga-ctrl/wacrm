import { AiError } from '../types'
import { toNetworkError, providerHttpError, type ProviderArgs } from './shared'
import type { ProviderResult } from '../types'

// The 'n8n' provider is a synchronous callout to an external workflow
// (a bring-your-own-automation webhook, typically n8n): wacrm posts
// the inbound message + conversation context, waits for the workflow
// to run its own logic (patient lookup, external APIs, an LLM, etc.),
// and uses the returned text as the reply. The webhook URL is stored
// in the same encrypted `api_key` column other providers use for a
// credential — here it holds a URL instead.
//
// Contract (wacrm -> webhook):
//   POST <api_key/url>
//   { conversation_id, contact_id, phone, text, history: ChatMessage[] }
// Expected response (webhook -> wacrm), 200 JSON:
//   { "text": "reply to send back to the customer" }

interface N8nResponse {
  text?: unknown
}

export async function generateN8n(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey: webhookUrl, messages, timeoutMs, conversationId, contactId, phone } = args
  const lastMessage = messages[messages.length - 1]?.content ?? ''
  let res: Response
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId ?? null,
        contact_id: contactId ?? null,
        phone: phone ?? null,
        text: lastMessage,
        history: messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) {
    throw await providerHttpError('n8n', res)
  }
  const data = (await res.json().catch(() => null)) as N8nResponse | null
  const text = typeof data?.text === 'string' ? data.text : null
  if (!text || !text.trim()) {
    throw new AiError('n8n workflow returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { text, usage: null }
}
