// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Both delegate to SECURITY DEFINER RPCs from migration 018:
//   - set_member_role(p_user_id, p_new_role)
//   - remove_account_member(p_user_id)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account, target can't be the
// owner, can't be self. The TS layer here only forwards the call
// and maps Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; full_name?: unknown; email?: unknown }
      | null;

    // Pedido 2026-09-01: admin/owner puede editar nombre y correo de
    // cualquier miembro de la cuenta, ademas de su rol -- los tres
    // campos son independientes entre si en el mismo body.
    if (typeof body?.full_name === "string" || typeof body?.email === "string") {
      // El userId es un uuid arbitrario en el body -- verificar que
      // pertenece a ESTA cuenta antes de tocar nada, ya que el cambio
      // de correo usa el cliente admin (bypassa RLS por completo).
      const { data: target, error: targetErr } = await ctx.supabase
        .from("profiles")
        .select("user_id")
        .eq("user_id", userId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();

      if (targetErr) {
        console.error("[members route] target lookup error:", targetErr);
        return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
      }
      if (!target) {
        return NextResponse.json({ error: "Member not found in this account" }, { status: 404 });
      }

      if (typeof body.full_name === "string") {
        const fullName = body.full_name.trim();
        // BUG REAL 2026-09-01: esto usaba ctx.supabase (scoped a la
        // sesion del admin que llama). La policy profiles_update es
        // "auth.uid() = user_id" -- un admin editando el perfil de
        // OTRO miembro filtraba 0 filas por RLS SIN lanzar error (un
        // UPDATE que no matchea ninguna fila no es un error en
        // Postgres/Supabase), asi que el endpoint devolvia { ok: true
        // } sin haber cambiado nada. 5 miembros quedaron con nombres
        // viejos en produccion por este bug -- corregidos a mano.
        // Requiere el cliente admin para bypassear RLS aca.
        const { error: nameErr } = await supabaseAdmin()
          .from("profiles")
          .update({ full_name: fullName || null })
          .eq("user_id", userId)
          .eq("account_id", ctx.accountId);
        if (nameErr) {
          console.error("[members route] full_name update error:", nameErr);
          return NextResponse.json({ error: "Failed to update name" }, { status: 500 });
        }
      }

      if (typeof body.email === "string") {
        const email = body.email.trim();
        if (!email || !email.includes("@")) {
          return NextResponse.json({ error: "Invalid email" }, { status: 400 });
        }
        // Cambiar el correo de OTRO usuario requiere la Admin API
        // (auth.admin), no el cliente scoped a la sesion del que llama.
        // email_confirm:true aplica el cambio de inmediato -- este es
        // un cambio iniciado por un admin, no un flujo de doble
        // confirmacion por el propio usuario.
        const { error: authErr } = await supabaseAdmin().auth.admin.updateUserById(userId, {
          email,
          email_confirm: true,
        });
        if (authErr) {
          console.error("[members route] auth email update error:", authErr);
          return NextResponse.json({ error: authErr.message || "Failed to update email" }, { status: 400 });
        }
        // profiles.email es una copia denormalizada -- mantenerla en
        // sync, ya que no hay trigger de sync en cambios (solo en
        // creacion, ver on_auth_user_created). Mismo bug de RLS que
        // full_name arriba -- usar el cliente admin.
        const { error: profileEmailErr } = await supabaseAdmin()
          .from("profiles")
          .update({ email })
          .eq("user_id", userId)
          .eq("account_id", ctx.accountId);
        if (profileEmailErr) {
          console.error("[members route] profiles.email sync error:", profileEmailErr);
        }
      }
    }

    const role = body?.role;

    if (role !== undefined) {
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });

      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
