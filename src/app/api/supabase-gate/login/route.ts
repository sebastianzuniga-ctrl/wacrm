// ============================================================
// /api/supabase-gate/login
//
// Pantalla de login + validación para el "gate" que nginx pone
// delante de Supabase Studio en https://supabase.ino.cl.
//
// Reusa el mismo loginJson.jsp del sistema INO que ya usa
// /api/auth/ino-login, pero:
//   - NO crea sesión de Supabase Auth (esto es independiente).
//   - Autoriza directamente por el campo `rol` que devuelve
//     loginJson.jsp (SOP, ASI) -- Studio es acceso de
//     infraestructura, no un permiso de negocio de wacrm, así
//     que no depende de profiles.account_role ni de que exista
//     un perfil de wacrm vinculado.
//   - Si es válido, firma una cookie propia (sb_gate, HMAC,
//     ver src/lib/supabase-gate/token.ts) que nginx valida en
//     cada request a Studio vía auth_request.
// ============================================================
import { NextResponse } from 'next/server'
import { signGateToken } from '@/lib/supabase-gate/token'

const INO_LOGIN_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/loginJson.jsp'
const GATE_COOKIE = 'sb_gate'
const SESSION_HOURS = 8
const ALLOWED_INO_ROLES = ['SOP', 'ASI']
const STUDIO_URL = 'https://supabase.ino.cl/'

interface InoLoginResponse {
  peticion?: { exito?: string }
  object?: { rol?: string; login?: string }
}

function loginPageHtml(error?: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Acceso Supabase Studio - INO</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: system-ui, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  form { background:#1e293b; padding:2rem; border-radius:0.75rem; width:320px; box-shadow:0 10px 25px rgba(0,0,0,0.3); }
  h1 { font-size:1.1rem; margin:0 0 1.25rem; color:#f1f5f9; }
  label { display:block; font-size:0.85rem; margin-bottom:0.25rem; color:#94a3b8; }
  input { width:100%; padding:0.6rem; margin-bottom:1rem; border-radius:0.4rem; border:1px solid #334155; background:#0f172a; color:#f1f5f9; box-sizing:border-box; }
  button { width:100%; padding:0.65rem; border:none; border-radius:0.4rem; background:#E62D28; color:white; font-weight:600; cursor:pointer; }
  button:hover { background:#c92722; }
  .error { background:#7f1d1d; color:#fecaca; padding:0.6rem; border-radius:0.4rem; margin-bottom:1rem; font-size:0.85rem; }
</style>
</head>
<body>
  <form method="POST" action="/api/supabase-gate/login">
    <h1>Acceso Supabase Studio</h1>
    ${error ? `<div class="error">${error}</div>` : ''}
    <label for="login">Usuario INO</label>
    <input type="text" id="login" name="login" autocomplete="username" required autofocus />
    <label for="password">Contraseña</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required />
    <button type="submit">Entrar</button>
  </form>
</body>
</html>`
}

function html(body: string, status: number) {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function GET() {
  return html(loginPageHtml(), 200)
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || ''
  let login = ''
  let password = ''

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData()
    login = String(form.get('login') || '').trim()
    password = String(form.get('password') || '')
  } else {
    const body = (await request.json().catch(() => null)) as
      | { login?: unknown; password?: unknown }
      | null
    login = typeof body?.login === 'string' ? body.login.trim() : ''
    password = typeof body?.password === 'string' ? body.password : ''
  }

  const fail = (msg: string) => html(loginPageHtml(msg), 401)

  if (!login || !password) {
    return fail('Ingresa usuario y contraseña.')
  }

  let inoData: InoLoginResponse
  try {
    const inoUrl = `${INO_LOGIN_URL}?user=${encodeURIComponent(login)}&psw=${encodeURIComponent(password)}`
    const inoRes = await fetch(inoUrl, { method: 'GET' })
    if (!inoRes.ok) return fail('Usuario o contraseña incorrectos.')
    inoData = (await inoRes.json()) as InoLoginResponse
  } catch (err) {
    console.error('[supabase-gate] loginJson.jsp unreachable:', err)
    return fail('No se pudo contactar al sistema INO. Intenta de nuevo.')
  }

  if (inoData?.peticion?.exito !== 'TRUE') {
    return fail('Usuario o contraseña incorrectos.')
  }

  const rol = inoData?.object?.rol || ''
  if (!ALLOWED_INO_ROLES.includes(rol)) {
    return fail('Tu usuario no tiene permiso para acceder a Supabase Studio.')
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600
  const token = signGateToken({ login, exp })

  const response = NextResponse.redirect(STUDIO_URL, { status: 302 })
  response.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  })
  return response
}
