// ============================================================
// /api/auth/ino-login
//
// Login complementario usando credenciales del sistema interno de INO
// (loginJson.jsp) en vez de email+password de Supabase Auth directo.
// Ver wacrm addendum sesión 2026-08-07 para el diseño completo.
//
// Flujo:
//   1) Login SIN '@' en el campo usuario -> se llama este endpoint
//      (en vez de supabase.auth.signInWithPassword() directo).
//   2) Validamos contra loginJson.jsp del sistema INO (server-side,
//      nunca desde el navegador -- necesitamos la service role key
//      más adelante en el flujo).
//   3) Si es válido, buscamos en `profiles` un perfil con `login_ino`
//      igual al login recién validado. Ese perfil DEBE existir de
//      antemano (dado de alta por un admin de wacrm) -- este endpoint
//      nunca crea perfiles nuevos.
//   4) Intentamos iniciar sesión en Supabase con el email guardado en
//      ese perfil + la contraseña que la persona acaba de escribir.
//   5) Si falla (primer login, o cambió su clave en el sistema INO
//      desde la última vez), usamos la Admin API para fijar esa
//      contraseña nueva en el usuario de Supabase y reintentamos --
//      esto sincroniza la clave de INO hacia Supabase sin fricción.
//   6) El cliente SSR (server.ts) escribe las cookies de sesión en la
//      respuesta -- de ahí en más, sesión normal indistinguible de un
//      login por email tradicional.
// ============================================================
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

const INO_LOGIN_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/loginJson.jsp'

interface InoLoginResponse {
  peticion?: { exito?: string }
  object?: { rut?: string; nombre?: string; rol?: string; login?: string }
}

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function invalidCredentials() {
  return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { login?: unknown; password?: unknown }
      | null
    const login = typeof body?.login === 'string' ? body.login.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!login || !password) {
      return NextResponse.json({ error: 'Login and password are required' }, { status: 400 })
    }

    const inoUrl = `${INO_LOGIN_URL}?user=${encodeURIComponent(login)}&psw=${encodeURIComponent(password)}`
    let inoData: InoLoginResponse
    try {
      const inoRes = await fetch(inoUrl, { method: 'GET' })
      if (!inoRes.ok) {
        console.error('[ino-login] loginJson.jsp returned', inoRes.status)
        return invalidCredentials()
      }
      inoData = (await inoRes.json()) as InoLoginResponse
    } catch (err) {
      console.error('[ino-login] loginJson.jsp unreachable:', err)
      return NextResponse.json(
        { error: 'No se pudo contactar al sistema INO. Intenta de nuevo.' },
        { status: 502 }
      )
    }

    if (inoData?.peticion?.exito !== 'TRUE') {
      return invalidCredentials()
    }

    const admin = supabaseAdmin()
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('user_id, email')
      .eq('login_ino', login)
      .maybeSingle()

    if (profileError) {
      console.error('[ino-login] profile lookup failed:', profileError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'Usuario no autorizado. Contacta al administrador de wacrm.' },
        { status: 403 }
      )
    }

    const supabase = await createServerClient()
    let { error: signInError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password,
    })

    if (signInError) {
      const { error: updateError } = await admin.auth.admin.updateUserById(profile.user_id, {
        password,
      })
      if (updateError) {
        console.error('[ino-login] updateUserById failed:', updateError)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }

      const retry = await supabase.auth.signInWithPassword({
        email: profile.email,
        password,
      })
      signInError = retry.error
    }

    if (signInError) {
      console.error('[ino-login] signInWithPassword failed after sync:', signInError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[ino-login] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
