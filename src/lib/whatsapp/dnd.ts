// ============================================================
// Do Not Disturb (No Molestar) — cumplimiento Ley No Molestar / SERNAC.
//
// Un contacto NO queda en no-molestar por presionar el boton "NO" de una
// plantilla de campaña. Queda en no-molestar UNICAMENTE cuando responde
// con la frase explicita de opt-out en un mensaje de TEXTO libre (el bot
// se la pide al despedirse, ej. "escriba: NO RECIBIR MENSAJES"). Ver
// src/app/api/whatsapp/webhook/route.ts, donde se detecta y corta el
// flujo (no sigue a flows/automatizaciones/IA para ese mensaje).
//
// Una vez marcado, contacts.do_not_disturb=true excluye al contacto de
// TODO envio de campaña futuro (ver whatsapp/broadcast/route.ts y
// broadcast-core.ts) -- pero NO afecta el chat normal, IA, ni agenda.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js'

const OPT_OUT_PHRASES = [
  'no recibir mensajes',
  'no recibir mas mensajes',
  'no quiero recibir mensajes',
  'no quiero recibir mas mensajes',
  'no molestar',
]

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes (más -> mas)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * True si el texto (mensaje libre del contacto) coincide con alguna de
 * las frases de opt-out. Coincidencia flexible (contains) para tolerar
 * saludos/puntuacion alrededor, ej. "ok no recibir mensajes gracias".
 */
export function isOptOutPhrase(text: string | null | undefined): boolean {
  if (!text) return false
  const normalized = normalize(text)
  if (!normalized) return false
  return OPT_OUT_PHRASES.some((phrase) => normalized.includes(phrase))
}

/**
 * Marca un contacto como do_not_disturb=true por haber escrito la frase
 * de opt-out, y deja el registro de auditoria (contact_dnd_events) que
 * sirve de evidencia ante SERNAC de que se respeto la solicitud.
 */
export async function markContactDoNotDisturb(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  replyText: string
): Promise<void> {
  const nowIso = new Date().toISOString()
  const { error: updErr } = await db
    .from('contacts')
    .update({
      do_not_disturb: true,
      do_not_disturb_at: nowIso,
      do_not_disturb_source: 'keyword_reply',
    })
    .eq('id', contactId)
  if (updErr) {
    console.error('[dnd] failed to flag contact do_not_disturb:', updErr.message)
  }
  const { error: logErr } = await db.from('contact_dnd_events').insert({
    account_id: accountId,
    contact_id: contactId,
    action: 'opt_out',
    source: 'keyword_reply',
    reply_text: replyText,
  })
  if (logErr) {
    console.error('[dnd] failed to log contact_dnd_events:', logErr.message)
  }
}

/**
 * Alta/baja manual (desde la UI) — para cuando el paciente pide no
 * recibir mas mensajes por telefono o presencialmente, o para revertir
 * un opt-out. `createdByUserId` queda en el registro de auditoria.
 */
export async function setContactDoNotDisturb(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  createdByUserId: string,
  optOut: boolean
): Promise<void> {
  const nowIso = new Date().toISOString()
  const { error: updErr } = await db
    .from('contacts')
    .update({
      do_not_disturb: optOut,
      do_not_disturb_at: optOut ? nowIso : null,
      do_not_disturb_source: optOut ? 'manual' : null,
    })
    .eq('id', contactId)
  if (updErr) {
    console.error('[dnd] failed to set contact do_not_disturb manually:', updErr.message)
  }
  const { error: logErr } = await db.from('contact_dnd_events').insert({
    account_id: accountId,
    contact_id: contactId,
    action: optOut ? 'opt_out' : 'opt_in',
    source: 'manual',
    created_by: createdByUserId,
  })
  if (logErr) {
    console.error('[dnd] failed to log contact_dnd_events (manual):', logErr.message)
  }
}
