// ============================================================
// /api/supabase-gate/check
//
// Target de nginx `auth_request` para proteger Supabase Studio.
// nginx llama a este endpoint por cada request a supabase.ino.cl/ ;
// 200 = deja pasar, 401 = nginx redirige a /api/supabase-gate/login.
//
// No usa sesión de Supabase Auth -- valida la cookie propia
// `sb_gate` (ver src/lib/supabase-gate/token.ts).
// ============================================================
import { NextResponse } from 'next/server'
import { verifyGateToken } from '@/lib/supabase-gate/token'

const GATE_COOKIE = 'sb_gate'

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${GATE_COOKIE}=([^;]+)`))
  const token = match ? decodeURIComponent(match[1]) : null

  const payload = verifyGateToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ ok: true, login: payload.login })
}
