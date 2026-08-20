// ============================================================
// Notificación a INO de un opt-out "No Molestar" (Ley No Molestar /
// SERNAC), disparada cuando un contacto escribe la frase explícita de
// opt-out en WhatsApp (ver src/lib/whatsapp/dnd.ts).
//
// Llamar a este único endpoint SETEA el estado en INO -- no hace falta
// ningún POST separado. Best-effort: si falla o no hay ficha, se deja
// registro en consola/log y NO bloquea el flujo del webhook.
// ============================================================

const NO_MOLESTAR_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/getNoMolestar.jsp';

// Mismo criterio que paciente.ts: DENT espera el número local chileno
// de 8 dígitos, sin código de país (56) ni el prefijo móvil (9).
const CHILE_MOBILE_PREFIX_LEN = 3;

function toTelefonoLocal(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= CHILE_MOBILE_PREFIX_LEN) return null;
  return digits.slice(CHILE_MOBILE_PREFIX_LEN);
}

export interface NotifyNoMolestarResult {
  ok: boolean;
  skipped?: 'no_ficha' | 'invalid_phone';
  error?: string;
}

/**
 * Avisa a INO que este teléfono+ficha debe quedar en No Molestar
 * (canal mobile/WhatsApp). Si el contacto no tiene ficha asociada
 * (nunca se resolvió como paciente INO), no se llama a nada -- se
 * informa en el resultado para que el caller deje constancia en log.
 */
export async function notifyNoMolestarINO(
  phone: string,
  ficha: string | null | undefined,
): Promise<NotifyNoMolestarResult> {
  if (!ficha) {
    return { ok: false, skipped: 'no_ficha' };
  }

  const telefonoLocal = toTelefonoLocal(phone);
  if (!telefonoLocal) {
    return { ok: false, skipped: 'invalid_phone' };
  }

  const token = process.env.INO_NOTIFY_TOKEN;
  if (!token) {
    return { ok: false, error: 'INO_NOTIFY_TOKEN no configurado' };
  }

  const params = new URLSearchParams({
    token,
    telefono: telefonoLocal,
    ficha,
    canal: 'mobile',
  });

  try {
    const res = await fetch(`${NO_MOLESTAR_URL}?${params.toString()}`, {
      method: 'POST',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => null);
    if (body?.peticion?.exito !== 'TRUE') {
      return { ok: false, error: body?.peticion?.mensaje ?? 'respuesta inesperada de INO' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
