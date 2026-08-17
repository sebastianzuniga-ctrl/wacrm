import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/settings/app-settings
 *
 * Cualquier miembro autenticado puede leer (usado por la pantalla de
 * Configuración para mostrar el valor actual, y potencialmente por el
 * cliente para mostrar avisos). No contiene datos sensibles.
 */
export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value, updated_at')
      .eq('key', 'session_inactivity_hours')
      .maybeSingle()
    if (error) {
      console.error('[app-settings GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load settings' },
        { status: 500 },
      )
    }
    return NextResponse.json({
      session_inactivity_hours: data?.value ?? 12,
      updated_at: data?.updated_at ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/settings/app-settings  (admin+)
 *
 * Actualiza session_inactivity_hours. El middleware cachea este valor
 * hasta 60s, así que el cambio no es instantáneo pero sí rápido.
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireRole('admin')
    const limit = checkRateLimit(`app-settings:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const hours = Number(body.session_inactivity_hours)
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      return bad('session_inactivity_hours debe ser un número entre 1 y 720')
    }

    const { error } = await supabase
      .from('app_settings')
      .upsert(
        {
          key: 'session_inactivity_hours',
          value: hours,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        },
        { onConflict: 'key' },
      )

    if (error) {
      console.error('[app-settings POST] upsert error:', error)
      return NextResponse.json(
        { error: 'Failed to update settings' },
        { status: 500 },
      )
    }

    return NextResponse.json({ session_inactivity_hours: hours })
  } catch (err) {
    return toErrorResponse(err)
  }
}
