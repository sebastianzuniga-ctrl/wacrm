// ============================================================
// /api/no-molestar
//
//   GET  — lista de contactos marcados do_not_disturb=true en esta cuenta
//          (evidencia SERNAC: fecha + origen del opt-out).
//   POST — { phone }                    -> alta manual por telefono
//          { contact_id, opt_in: true } -> reingreso (opt-in) manual
//
// El alta automatica (por frase de opt-out en el chat) NO pasa por aqui,
// ocurre directo en el webhook (src/lib/whatsapp/dnd.ts).
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { setContactDoNotDisturb } from '@/lib/whatsapp/dnd';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone, do_not_disturb_at, do_not_disturb_source')
      .eq('account_id', ctx.accountId)
      .eq('do_not_disturb', true)
      .order('do_not_disturb_at', { ascending: false });
    if (error) {
      console.error('[GET /api/no-molestar] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500 });
    }
    return NextResponse.json({ contacts: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as {
      phone?: unknown;
      contact_id?: unknown;
      opt_in?: unknown;
    } | null;

    // Reingreso: sacar a un contacto de No Molestar.
    if (typeof body?.contact_id === 'string' && body.opt_in === true) {
      await setContactDoNotDisturb(
        ctx.supabase,
        ctx.accountId,
        body.contact_id,
        ctx.userId,
        false
      );
      return NextResponse.json({ success: true });
    }

    // Alta manual por telefono (ej. el paciente lo pidio por telefono o
    // presencialmente, no por WhatsApp).
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      return NextResponse.json(
        {
          error:
            "Provide 'phone' to add a contact, or 'contact_id' + 'opt_in: true' to remove one",
        },
        { status: 400 }
      );
    }
    const contact = await findExistingContact(ctx.supabase, ctx.accountId, phone);
    if (!contact) {
      return NextResponse.json(
        { error: 'No contact found with that phone number in this account' },
        { status: 404 }
      );
    }
    await setContactDoNotDisturb(ctx.supabase, ctx.accountId, contact.id, ctx.userId, true);
    return NextResponse.json({ success: true, contact });
  } catch (err) {
    return toErrorResponse(err);
  }
}
