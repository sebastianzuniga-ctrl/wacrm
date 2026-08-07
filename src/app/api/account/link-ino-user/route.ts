// ============================================================
// /api/account/link-ino-user
//
// Da de alta a una persona para que pueda loguearse en wacrm con sus
// credenciales del sistema interno de INO (ver /api/auth/ino-login),
// SIN que el admin de wacrm conozca ni maneje su contraseña real.
//
// Crea de una vez:
//   1) Un usuario de Supabase Auth con una password aleatoria temporal
//      que nunca se muestra ni se guarda en ningún lado -- se
//      sobreescribe automáticamente en el primer login exitoso vía
//      /api/auth/ino-login (ver ese archivo para el mecanismo).
//   2) Un `profiles` con `login_ino` seteado, vinculando ese login al
//      usuario recién creado, con el rol elegido por el admin.
//
// admin+ únicamente (mismo criterio que /api/account/invitations).
// ============================================================
import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isAccountRole } from '@/lib/auth/roles'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Password aleatoria de un solo uso -- nunca se le entrega a nadie.
// Se sobreescribe en el primer login real por INO (ver ino-login/route.ts).
function generateTempPassword(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const limit = checkRateLimit(
      `admin:linkInoUser:${ctx.userId}`,
      RATE_LIMITS.adminAction
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as
      | { login_ino?: unknown; full_name?: unknown; email?: unknown; role?: unknown }
      | null

    const loginIno = typeof body?.login_ino === 'string' ? body.login_ino.trim() : ''
    const fullName = typeof body?.full_name === 'string' ? body.full_name.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const role = body?.role

    if (!loginIno || !fullName || !email) {
      return NextResponse.json(
        { error: 'login_ino, full_name and email are required' },
        { status: 400 }
      )
    }
    if (!isAccountRole(role) || role === 'owner') {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 }
      )
    }

    const admin = supabaseAdmin()

    // Chequeo previo de unicidad de login_ino -- da un 409 legible en
    // vez de dejar que el índice único parcial lo rechace como 500.
    const { data: existing, error: existingError } = await admin
      .from('profiles')
      .select('id')
      .eq('login_ino', loginIno)
      .maybeSingle()

    if (existingError) {
      console.error('[link-ino-user] uniqueness check failed:', existingError)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (existing) {
      return NextResponse.json(
        { error: 'Ese login de INO ya está vinculado a otro usuario.' },
        { status: 409 }
      )
    }

    // Paso 1: crear el usuario de Supabase Auth con password temporal
    // aleatoria. auto-confirmado porque nunca pasa por el flujo normal
    // de verificación de email -- entra siempre vía loginJson.jsp.
    const tempPassword = generateTempPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })

    if (createError || !created?.user) {
      console.error('[link-ino-user] createUser failed:', createError)
      return NextResponse.json(
        { error: createError?.message || 'Failed to create auth user' },
        { status: 400 }
      )
    }

    // Paso 2: el trigger `on_auth_user_created` (handle_new_user())
    // ya creó automáticamente, al crear el usuario de Auth arriba, un
    // `profiles` básico Y una `accounts` nueva con esta persona como
    // owner solitario -- comportamiento de bootstrap para signups
    // normales, no lo que queremos aquí. En vez de INSERT (chocaría
    // con la unique constraint de profiles.user_id), hacemos UPDATE
    // sobre esa fila para vincularla a la cuenta real de INO, y
    // borramos la cuenta fantasma que el trigger dejó de paso.
    const phantomAccountId: string | null = await admin
      .from('profiles')
      .select('account_id')
      .eq('user_id', created.user.id)
      .maybeSingle()
      .then((r) => r.data?.account_id ?? null)

    const { error: profileError } = await admin
      .from('profiles')
      .update({
        full_name: fullName,
        email,
        account_id: ctx.accountId,
        account_role: role,
        login_ino: loginIno,
      })
      .eq('user_id', created.user.id)

    if (profileError) {
      console.error('[link-ino-user] profile update failed:', profileError)
      // Rollback best-effort del usuario Auth (y su cuenta fantasma,
      // vía ON DELETE CASCADE una vez que ya no hay profile apuntándola
      // sería innecesario aquí porque el update falló y sigue intacta).
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {})
      return NextResponse.json(
        { error: 'Failed to create profile' },
        { status: 500 }
      )
    }

    // Limpieza: la cuenta fantasma del trigger ya no la referencia
    // ningún profile (lo reapuntamos arriba) -- si sigue existiendo,
    // bórrala. Best-effort: si falla, queda una cuenta huérfana inerte
    // que nadie usa, no es grave.
    if (phantomAccountId && phantomAccountId !== ctx.accountId) {
      await admin.from('accounts').delete().eq('id', phantomAccountId).then(
        () => {},
        (err) => console.warn('[link-ino-user] phantom account cleanup failed:', err)
      )
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
