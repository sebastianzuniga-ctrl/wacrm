// ============================================================
// GET /api/ino-paciente-ficha?ficha=XXXX
//
// Busca en INO (DENT) los datos de un paciente por número de ficha,
// vía getPacientes.jsp. Usado por "Agregar Paciente INO" en
// Contactos para autocompletar nombre/teléfono/correo.
//
// DENT devuelve un mismo paciente con una fila POR CADA teléfono
// registrado (fijo, celular, etc.) -- si hay más de uno, el llamador
// debe dejar elegir cuál usar como número de WhatsApp. La forma de
// `object.paciente` cambia según la cantidad de resultados: un
// OBJETO si hay uno solo, un ARRAY si hay varios -- se normaliza acá
// para que el consumidor siempre reciba un array.
// ============================================================
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

const DENT_URL = 'http://sistema.ino.cl/DentWeb12/dent/rest/getPacientes.jsp';

// El teléfono que devuelve DENT es el número local chileno de 8
// dígitos (celular), sin código de país ni el "9" de móvil -- hay
// que anteponer "569" para armar el wa_id completo. Verificado
// 2026-08-17 contra un contacto real: "95192848" -> "56995192848".
const CHILE_MOBILE_PREFIX = '569';

interface RawPacienteRow {
  ficha: string;
  rut: string;
  nombres: string;
  apPaterno: string;
  apMaterno: string;
  estado: string;
  email: string | null;
  telefono: string | null;
}

export interface FichaCandidato {
  ficha: string;
  nombreCompleto: string;
  telefono: string | null;
  email: string | null;
  estado: string;
}

function toFullPhone(telefonoLocal: string | null): string | null {
  if (!telefonoLocal) return null;
  const digits = telefonoLocal.replace(/\D/g, '');
  if (!digits) return null;
  return `${CHILE_MOBILE_PREFIX}${digits}`;
}

export async function GET(request: Request) {
  try {
    // Sin restricción de rol -- mismo criterio que Contactos hoy,
    // cualquier miembro de la cuenta puede agregar contactos.
    await getCurrentAccount();

    const { searchParams } = new URL(request.url);
    const ficha = searchParams.get('ficha')?.trim();
    if (!ficha || !/^\d+$/.test(ficha)) {
      return NextResponse.json({ error: 'ficha inválida' }, { status: 400 });
    }

    const token = process.env.INO_NOTIFY_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'INO_NOTIFY_TOKEN no configurado' }, { status: 500 });
    }

    const params = new URLSearchParams({ valor: ficha, token });
    const res = await fetch(`${DENT_URL}?${params.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `INO respondió HTTP ${res.status}` }, { status: 502 });
    }
    const body = await res.json();

    if (body?.peticion?.exito !== 'TRUE') {
      // "no encontrado" también llega por acá con exito:FALSE -- se
      // trata como lista vacía, no como error duro.
      return NextResponse.json({ pacientes: [] });
    }

    const raw = body?.object?.paciente;
    const rows: RawPacienteRow[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const pacientes: FichaCandidato[] = rows.map((row) => ({
      ficha: row.ficha,
      nombreCompleto: [row.nombres, row.apPaterno, row.apMaterno]
        .filter(Boolean)
        .join(' '),
      telefono: toFullPhone(row.telefono),
      email: row.email || null,
      estado: row.estado,
    }));

    return NextResponse.json({ pacientes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
