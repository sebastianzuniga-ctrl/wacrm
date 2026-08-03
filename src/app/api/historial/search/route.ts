// ============================================================
// GET /api/historial/search?q=...
//
// Busca contactos por nombre o telefono y devuelve, para cada uno,
// TODAS sus conversaciones historicas (tickets) -- incluye cerradas,
// a diferencia del inbox normal que arranca en la mas reciente. Cada
// ticket se ve completo en /inbox?c=<id> (se reusa el inbox existente,
// no se duplica el visor de mensajes).
// ============================================================
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { getPhonesByFichaCodigo } from '@/lib/ino/sesion';

interface ConvRow {
  id: string;
  contact_id: string;
  status: string;
  created_at: string;
  last_message_at: string | null;
  last_message_text: string | null;
}

export async function GET(request: Request) {
  try {
    // Historial y Estadisticas: solo admin/owner, agentes no lo ven.
    const ctx = await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') ?? '').trim();

    if (q.length < 2) {
      return NextResponse.json({ contacts: [] });
    }

    const digits = q.replace(/\D/g, '');
    const orClauses = [`name.ilike.%${q}%`];
    if (digits) orClauses.push(`phone_normalized.ilike.%${digits}%`);

    const { data: contactsData, error: contactsError } = await ctx.supabase
      .from('contacts')
      .select('id, name, phone, avatar_url')
      .eq('account_id', ctx.accountId)
      .or(orClauses.join(','))
      .limit(20);

    if (contactsError) {
      console.error('[GET /api/historial/search] contacts error:', contactsError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    const contacts = contactsData ?? [];

    // Busqueda adicional por numero de ficha (pac_codigo), resuelto via
    // la base de n8n (botino_analytics) -- ver src/lib/ino/sesion.ts.
    // Solo tiene sentido si el termino parece un codigo (puramente
    // numerico); un nombre nunca calzaria con pac_codigo de todas formas.
    if (/^\d+$/.test(q)) {
      const phones = await getPhonesByFichaCodigo(q);
      for (const phone of phones) {
        const waId = normalizePhone(phone);
        if (!waId) continue;
        const { data: extra } = await ctx.supabase
          .from('contacts')
          .select('id, name, phone, avatar_url')
          .eq('account_id', ctx.accountId)
          .eq('phone_normalized', waId)
          .limit(1);
        const found = extra?.[0];
        if (found && !contacts.some((c) => c.id === found.id)) {
          contacts.push(found);
        }
      }
    }

    if (contacts.length === 0) {
      return NextResponse.json({ contacts: [] });
    }

    const contactIds = contacts.map((c) => c.id);
    const { data: convsData, error: convsError } = await ctx.supabase
      .from('conversations')
      .select('id, contact_id, status, created_at, last_message_at, last_message_text')
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false });

    if (convsError) {
      console.error('[GET /api/historial/search] conversations error:', convsError);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    const convsByContact = new Map<string, ConvRow[]>();
    for (const conv of (convsData ?? []) as ConvRow[]) {
      const list = convsByContact.get(conv.contact_id) ?? [];
      list.push(conv);
      convsByContact.set(conv.contact_id, list);
    }

    const result = contacts.map((c) => ({
      ...c,
      conversations: convsByContact.get(c.id) ?? [],
    }));

    return NextResponse.json({ contacts: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
