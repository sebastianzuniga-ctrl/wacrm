// ============================================================
// /api/broadcast-reply-rules/[id]
//
//   PATCH  — partial update (e.g. toggle is_active, edit action_text).
//   DELETE — remove the rule.
//
// Agent+, enforced here and by the `broadcast_reply_rules_update` /
// `_delete` RLS policies.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

const SAFE_COLUMNS =
  'id, template_name, reply_value, action_type, action_text, webhook_url, is_active, created_at, updated_at';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      action_type?: unknown;
      action_text?: unknown;
      webhook_url?: unknown;
      is_active?: unknown;
    } | null;

    const patch: Record<string, unknown> = {};

    if (body?.action_type !== undefined) {
      if (
        body.action_type !== 'send_text' &&
        body.action_type !== 'webhook' &&
        body.action_type !== 'ai_agent' &&
        body.action_type !== 'none'
      ) {
        return NextResponse.json(
          {
            error:
              "'action_type' must be 'send_text', 'webhook', 'ai_agent', or 'none'",
          },
          { status: 400 }
        );
      }
      patch.action_type = body.action_type;
    }
    if (typeof body?.action_text === 'string' || body?.action_text === null) {
      patch.action_text = body.action_text;
    }
    if (typeof body?.webhook_url === 'string' || body?.webhook_url === null) {
      patch.webhook_url = body.webhook_url;
    }
    if (typeof body?.is_active === 'boolean') {
      patch.is_active = body.is_active;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('broadcast_reply_rules')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/broadcast-reply-rules/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to update rule' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ rule: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('broadcast_reply_rules')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/broadcast-reply-rules/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete rule' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
