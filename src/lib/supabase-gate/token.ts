// ============================================================
// Firma y verificación de la cookie del "gate" delante de
// Supabase Studio (supabase.ino.cl). Cookie HMAC simple,
// sin librerías externas: payload.base64url + firma.base64url
// ============================================================
import { createHmac, timingSafeEqual } from 'crypto'

const SECRET = process.env.SUPABASE_GATE_SECRET || ''

export interface GatePayload {
  login: string
  exp: number // unix seconds
}

function sign(payloadB64: string): string {
  return createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
}

export function signGateToken(payload: GatePayload): string {
  if (!SECRET) throw new Error('SUPABASE_GATE_SECRET no configurado')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${payloadB64}.${sign(payloadB64)}`
}

export function verifyGateToken(token: string | undefined | null): GatePayload | null {
  if (!token || !SECRET) return null
  const [payloadB64, sig] = token.split('.')
  if (!payloadB64 || !sig) return null

  const expectedSig = sign(payloadB64)
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as GatePayload
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    if (typeof payload.login !== 'string' || !payload.login) return null
    return payload
  } catch {
    return null
  }
}
