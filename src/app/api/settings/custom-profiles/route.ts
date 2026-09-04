// ============================================================
// /api/settings/custom-profiles
//
//   GET  — list custom profiles for the account.  Any member.
//   POST — create a custom profile.               Admin+.
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const VALID_BASE_ROLES = ['admin', 'agent'];

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { data, error } = await supabase
      .from('custom_profiles')
      .select('id, name, base_role, allowed_pages, allowed_template_ids, created_at')
      .eq('account_id', accountId)
      .order('name');
    if (error) {
      console.error('[custom-profiles GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load profiles' }, { status: 500 });
    }
    return NextResponse.json({ profiles: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`custom-profile:create:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return bad('name es requerido');

    const baseRole = body.base_role;
    if (!VALID_BASE_ROLES.includes(baseRole)) return bad("base_role debe ser 'admin' o 'agent'");

    const allowedPages = Array.isArray(body.allowed_pages)
      ? body.allowed_pages.filter((p: unknown) => typeof p === 'string')
      : [];

    // null = sin restricción (default para perfiles nuevos si el
    // caller no manda nada explícito distinto); array = whitelist.
    const allowedTemplateIds = body.allowed_template_ids === null
      ? null
      : Array.isArray(body.allowed_template_ids)
        ? body.allowed_template_ids.filter((t: unknown) => typeof t === 'string')
        : null;

    const { data, error } = await ctx.supabase
      .from('custom_profiles')
      .insert({
        account_id: ctx.accountId,
        name,
        base_role: baseRole,
        allowed_pages: allowedPages,
        allowed_template_ids: allowedTemplateIds,
      })
      .select('id, name, base_role, allowed_pages, allowed_template_ids, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return bad('Ya existe un perfil con ese nombre');
      }
      console.error('[custom-profiles POST] insert error:', error);
      return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
    }

    return NextResponse.json({ profile: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
