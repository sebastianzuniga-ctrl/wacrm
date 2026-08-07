// ============================================================
// Helper compartido para enviar correos vía el sistema interno
// de notificaciones INO (insNotificacion.jsp). Mismo endpoint y
// formato que usa src/app/api/auth/forgot-password/route.ts.
// ============================================================

const INO_NOTIFY_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/insNotificacion.jsp';
const INO_NOTIFY_TOKEN = '987654321';

export async function sendInoEmail(destinatario: string, asunto: string, mensaje: string): Promise<boolean> {
  const params = new URLSearchParams({
    token: INO_NOTIFY_TOKEN,
    accion: 'mail',
    ficha: '0',
    email: destinatario,
    titulo: asunto,
    msj: mensaje,
    tipo: 'AVISO_INTERNO',
  });

  try {
    const res = await fetch(INO_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[ino-notify] insNotificacion.jsp failed:', destinatario, res.status, text);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ino-notify] unexpected error sending to', destinatario, err);
    return false;
  }
}

// El endpoint solo acepta un destinatario por llamada -> se itera.
// No se usa Promise.all para no golpear el endpoint en paralelo con
// listas largas; se manda en serie y se reporta cuántos fallaron.
export async function sendInoEmailToMany(
  destinatarios: string[],
  asunto: string,
  mensaje: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const d of destinatarios) {
    const ok = await sendInoEmail(d, asunto, mensaje);
    if (ok) sent++;
    else failed++;
  }
  if (failed > 0) {
    console.error(`[ino-notify] ${failed}/${destinatarios.length} envíos fallaron (asunto: "${asunto}")`);
  }
  return { sent, failed };
}
