// ============================================================
// /api/broadcast-reply-rules
//
//   GET  — list this account's rules (any member).
//   POST — create or update a rule for (template_name, reply_value),
//          upserting on that pair so re-saving the same campaign+button
//          combo from the UI edits in place instead of duplicating.
//
// A rule says: "when a contact taps a button worth `reply_value` on a
// broadcast of `template_name`, run `action_type`." See
// `src/lib/whatsapp/broadcast-reply-rules.ts` for the runtime side
// (looked up from the inbound webhook).
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';

const SAFE_COLUMNS =
  'id, template_name, reply_value, action_type, action_text, webhook_url, is_active, created_at, updated_at';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('broadcast_reply_rules')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('template_name', { ascending: true });

    if (error) {
      console.error('[GET /api/broadcast-reply-rules] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load rules' },
        { status: 500 }
      );
    }

    return NextResponse.json({ rules: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const body = (await request.json().catch(() => null)) as {
      template_name?: unknown;
      reply_value?: unknown;
      action_type?: unknown;
      action_text?: unknown;
      webhook_url?: unknown;
      is_active?: unknown;
    } | null;

    const templateName =
      typeof body?.template_name === 'string' ? body.template_name.trim() : '';
    const replyValue =
      typeof body?.reply_value === 'string' ? body.reply_value.trim() : '';
    const actionType = body?.action_type;

    if (!templateName || !replyValue) {
      return NextResponse.json(
        { error: "'template_name' and 'reply_value' are required" },
        { status: 400 }
      );
    }
    if (
      actionType !== 'send_text' &&
      actionType !== 'webhook' &&
      actionType !== 'ai_agent' &&
      actionType !== 'none'
    ) {
      return NextResponse.json(
        {
          error:
            "'action_type' must be 'send_text', 'webhook', 'ai_agent', or 'none'",
        },
        { status: 400 }
      );
    }

    const actionText =
      typeof body?.action_text === 'string' ? body.action_text : null;
    const webhookUrl =
      typeof body?.webhook_url === 'string' ? body.webhook_url : null;
    const isActive =
      typeof body?.is_active === 'boolean' ? body.is_active : true;

    if (actionType === 'send_text' && !actionText) {
      return NextResponse.json(
        { error: "'action_text' is required for action_type 'send_text'" },
        { status: 400 }
      );
    }
    if (actionType === 'webhook' && !webhookUrl) {
      return NextResponse.json(
        { error: "'webhook_url' is required for action_type 'webhook'" },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('broadcast_reply_rules')
      .upsert(
        {
          account_id: ctx.accountId,
          created_by: ctx.userId,
          template_name: templateName,
          reply_value: replyValue,
          action_type: actionType,
          action_text: actionText,
          webhook_url: webhookUrl,
          is_active: isActive,
        },
        { onConflict: 'account_id,template_name,reply_value' }
      )
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[POST /api/broadcast-reply-rules] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to save rule' },
        { status: 500 }
      );
    }

    return NextResponse.json({ rule: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
