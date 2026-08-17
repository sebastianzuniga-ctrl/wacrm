import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

let cachedInactivityLimitMs: number | null = null
let cachedInactivityLimitFetchedAt = 0
const INACTIVITY_LIMIT_CACHE_TTL_MS = 60 * 1000
const DEFAULT_INACTIVITY_LIMIT_MS = 12 * 60 * 60 * 1000

async function getInactivityLimitMs(supabase: ReturnType<typeof createServerClient>): Promise<number> {
  const now = Date.now()
  if (cachedInactivityLimitMs !== null && now - cachedInactivityLimitFetchedAt < INACTIVITY_LIMIT_CACHE_TTL_MS) {
    return cachedInactivityLimitMs
  }
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'session_inactivity_hours')
      .maybeSingle()
    if (!error && data && typeof data.value === 'number' && data.value > 0) {
      cachedInactivityLimitMs = data.value * 60 * 60 * 1000
    } else {
      cachedInactivityLimitMs = DEFAULT_INACTIVITY_LIMIT_MS
    }
  } catch {
    cachedInactivityLimitMs = DEFAULT_INACTIVITY_LIMIT_MS
  }
  cachedInactivityLimitFetchedAt = now
  return cachedInactivityLimitMs
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Auto-logout tras N horas de inactividad (configurable en
  // app_settings.session_inactivity_hours, editable desde Configuración).
  // Independiente del refresh token, que no expira por sí solo mientras
  // haya actividad periódica.
  let sessionExpiredByInactivity = false
  let effectiveUser = user
  if (user) {
    const inactivityLimitMs = await getInactivityLimitMs(supabase)
    const lastSeenCookie = request.cookies.get('wacrm_last_seen')?.value
    const lastSeen = lastSeenCookie ? parseInt(lastSeenCookie, 10) : null
    if (lastSeen && Date.now() - lastSeen > inactivityLimitMs) {
      await supabase.auth.signOut()
      sessionExpiredByInactivity = true
      effectiveUser = null
      supabaseResponse.cookies.delete('wacrm_last_seen')
    } else {
      // La cookie debe sobrevivir MÁS que el límite de inactividad;
      // si el navegador la borrara justo al llegar al límite, el
      // request siguiente vería "sin cookie" y reiniciaría el conteo
      // en vez de detectar el vencimiento. La comparación real de
      // tiempo la hace el código de arriba con el timestamp guardado,
      // no la expiración de la cookie.
      const COOKIE_SAFETY_MARGIN_MS = 24 * 60 * 60 * 1000
      const nowStr = String(Date.now())
      supabaseResponse.cookies.set('wacrm_last_seen', nowStr, {
        httpOnly: true,
        maxAge: (inactivityLimitMs + COOKIE_SAFETY_MARGIN_MS) / 1000,
        sameSite: 'lax',
        path: '/',
      })
      // Cookie gemela SIN httpOnly y SIN datos sensibles (solo un
      // timestamp) para que un badge de UI pueda mostrar la cuenta
      // regresiva hasta el auto-logout. No reemplaza la validación
      // real, que sigue haciéndose server-side con la cookie httpOnly.
      supabaseResponse.cookies.set('wacrm_session_meta', JSON.stringify({
        lastSeen: Number(nowStr),
        limitMs: inactivityLimitMs,
      }), {
        httpOnly: false,
        maxAge: (inactivityLimitMs + COOKIE_SAFETY_MARGIN_MS) / 1000,
        sameSite: 'lax',
        path: '/',
      })
    }
  }

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (effectiveUser && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/campaign-rules', '/no-molestar', '/flows', '/agents', '/historial', '/sesiones-ino']
  if (!effectiveUser && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    if (sessionExpiredByInactivity) {
      url.searchParams.set('expired', '1')
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!effectiveUser && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
