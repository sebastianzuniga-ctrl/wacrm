// ============================================================
// GET /api/v1/business-hours
//
// Expone el estado de horario de atencion (accounts.business_hours_*)
// para consumidores externos que no tienen acceso directo a la DB de
// wacrm -- en la practica, BotINO Principal (n8n), que corre contra
// una base Postgres separada (botino_analytics) y no puede leer la
// tabla `accounts` de wacrm directamente.
//
// Replica el mismo criterio que ya usa el auto-reply propio de wacrm
// (ver dispatchInboundToAiReply en src/lib/ai/auto-reply.ts): si se
// pide derivar a una ejecutiva y estamos fuera de horario, no hay
// nadie para tomar el ticket -- se informa al paciente con el mensaje
// ya configurado en Configuracion, sin pausar al bot ni asignar la
// conversacion a un humano.
// ============================================================
import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth/api-context';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { loadBusinessHours, isWithinBusinessHours } from '@/lib/ino/business-hours';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'business_hours:read');

    const bh = await loadBusinessHours(ctx.supabase, ctx.accountId);
    if (!bh) {
      // Sin config de horario en la cuenta -- tratar como "siempre
      // abierto", mismo default que isWithinBusinessHours cuando
      // business_hours_enabled es false.
      return NextResponse.json({ isOpen: true, enabled: false });
    }

    const isOpen = isWithinBusinessHours(bh);

    return NextResponse.json({
      isOpen,
      enabled: bh.business_hours_enabled,
      closedMessage: bh.business_hours_closed_message,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
