// ============================================================
// /api/auth/forgot-password
//
// Reemplaza supabase.auth.resetPasswordForEmail() (que depende del SMTP
// de Supabase -- no configurado en esta instancia self-hosted, por eso
// "olvidé mi contraseña" no mandaba nada). En vez de eso:
//
//   1) Generamos el link de recovery con la Admin API de Supabase
//      (generateLink NO manda correo, solo crea el token).
//   2) Armamos nuestro propio link apuntando a APP_URL (el dominio
//      publico de wacrm) en vez del host interno de Supabase
//      (NEXT_PUBLIC_SUPABASE_URL es una IP de LAN, no alcanzable desde
//      afuera).
//   3) Mandamos el correo por el sistema interno de INO (DentWeb12 /
//      insNotificacion.jsp) en vez de por Supabase.
//
// El link resultante apunta a /reset-password?token_hash=...&type=recovery,
// que en el cliente llama a supabase.auth.verifyOtp() para completar el
// flujo -- ver src/app/(auth)/reset-password/page.tsx.
// ============================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const APP_URL = 'https://wspcrm.ino.cl';

const INO_NOTIFY_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/insNotificacion.jsp';
const INO_NOTIFY_TOKEN = '987654321';

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Respuesta generica -- no revela si el correo existe o no, ni
    // cuando generateLink falla (usuario inexistente) ni cuando todo
    // sale bien. Solo un fallo real de infraestructura (insNotificacion
    // caido) devuelve error al usuario, mas abajo.
    const generic = () =>
      NextResponse.json({
        success: true,
        message: 'If that email exists, a reset link was sent.',
      });

    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    if (error || !data?.properties?.hashed_token) {
      console.error(
        '[forgot-password] generateLink failed:',
        error?.message ?? 'no hashed_token in response'
      );
      return generic();
    }

    const resetLink = `${APP_URL}/reset-password?token_hash=${data.properties.hashed_token}&type=recovery`;

    const asunto = 'Restablece tu contraseña - wacrm INO';
    const mensaje =
      'Recibimos una solicitud para restablecer tu contraseña en wacrm.\n\n' +
      `Haz clic en el siguiente link para crear una nueva contraseña:\n${resetLink}\n\n` +
      'Si no solicitaste esto, puedes ignorar este correo.';

    const params = new URLSearchParams({
      token: INO_NOTIFY_TOKEN,
      accion: 'mail',
      ficha: '0',
      email,
      titulo: asunto,
      msj: mensaje,
      tipo: 'AVISO_INTERNO',
    });

    const notifyRes = await fetch(INO_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!notifyRes.ok) {
      const text = await notifyRes.text().catch(() => '');
      console.error('[forgot-password] insNotificacion.jsp failed:', notifyRes.status, text);
      return NextResponse.json(
        { error: 'Failed to send the reset email. Please try again shortly.' },
        { status: 502 }
      );
    }

    return generic();
  } catch (err) {
    console.error('[forgot-password] unexpected error:', err);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
