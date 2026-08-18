// ============================================================
// PATCH /api/account/members/[userId]/custom-profile
//
// Asigna o quita el perfil personalizado de un miembro. Delega en
// el RPC SECURITY DEFINER set_member_custom_profile (migración 058)
// -- profiles_update solo permite auth.uid() = user_id, así que un
// admin no puede tocar el custom_profile_id de OTRO usuario sin él.
// ============================================================
import { NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === '42501') {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === '22023') {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error('[custom-profile assign] unexpected RPC error:', err);
  return NextResponse.json({ error: 'Failed to assign profile' }, { status: 500 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`admin:customProfileAssign:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const body = (await request.json().catch(() => null)) as { custom_profile_id?: unknown } | null;
    const customProfileId = body?.custom_profile_id;

    if (customProfileId !== null && typeof customProfileId !== 'string') {
      return NextResponse.json(
        { error: "'custom_profile_id' debe ser un uuid o null" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc('set_member_custom_profile', {
      p_user_id: userId,
      p_custom_profile_id: customProfileId,
    });
    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
