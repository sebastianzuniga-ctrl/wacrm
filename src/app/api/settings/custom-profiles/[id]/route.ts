// ============================================================
// /api/settings/custom-profiles/[id]
//
//   PATCH  — update name / base_role / allowed_pages.  Admin+.
//   DELETE — delete the profile.                       Admin+.
//
// Members with this profile assigned fall back to seeing
// everything their account_role permits (ON DELETE SET NULL on
// profiles.custom_profile_id, migration 057) -- deleting a profile
// never locks anyone out.
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const VALID_BASE_ROLES = ['admin', 'agent'];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`custom-profile:update:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return bad('name no puede estar vacío');
      update.name = name;
    }
    if (body.base_role !== undefined) {
      if (!VALID_BASE_ROLES.includes(body.base_role)) {
        return bad("base_role debe ser 'admin' o 'agent'");
      }
      update.base_role = body.base_role;
    }
    if (body.allowed_pages !== undefined) {
      if (!Array.isArray(body.allowed_pages)) return bad('allowed_pages debe ser un array');
      update.allowed_pages = body.allowed_pages.filter((p: unknown) => typeof p === 'string');
    }

    if (Object.keys(update).length === 0) return bad('Nada que actualizar');
    update.updated_at = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from('custom_profiles')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id, name, base_role, allowed_pages, created_at')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') return bad('Ya existe un perfil con ese nombre');
      console.error('[custom-profiles PATCH] update error:', error);
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 });

    return NextResponse.json({ profile: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`custom-profile:delete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const { error } = await ctx.supabase
      .from('custom_profiles')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[custom-profiles DELETE] error:', error);
      return NextResponse.json({ error: 'Failed to delete profile' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
