"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  derivePresence,
  isActivelyViewing,
  type PresenceRow,
  type PresenceStatus,
} from "@/lib/presence";

// Polling en vez de Supabase Realtime -- Realtime (postgres_changes
// sobre websocket) esta roto en este deployment (ver
// wacrm_add3.md/add4.md). Antes esta suscripcion nunca disparaba
// tras la carga inicial, asi que un miembro que se conectaba DESPUES
// de que otro cargara la pagina nunca aparecia online para ese otro,
// y alguien que seguia activo podia aparecer como "away"/"offline"
// incorrectamente porque su last_seen_at fresco nunca llegaba.
// Mismo intervalo que el resto de los hooks de polling de la app.
const POLL_INTERVAL_MS = 15_000;

type PresenceMap = Map<string, PresenceRow>;

interface UsePresenceResult {
  /** Derived status for one member (defaults to offline if unseen). */
  getPresence: (userId: string) => PresenceStatus;
  /** Raw row for tooltips ("last seen …"). */
  getRow: (userId: string) => PresenceRow | undefined;
  /**
   * user_ids (excluyendo excludeUserId) que estan viendo activamente
   * la conversacion dada ahora mismo -- alimenta el aviso "alguien
   * mas esta viendo esto" en el inbox.
   */
  getViewers: (conversationId: string, excludeUserId?: string | null) => string[];
  /**
   * The clock value the hook is currently deriving against. Pass this
   * to `presenceLabel` / `formatLastSeen` so labels stay in lockstep
   * with the dots (both advance on the same ~15s re-derive tick).
   */
  now: number;
}

/**
 * Live presence for every member of the caller's account. Reads the
 * `member_presence` table (RLS-scoped to the account) via polling and
 * re-derives "offline" on the same local timer.
 *
 * Account comes from useAuth; pass `enabled: false` to opt a consumer
 * out (e.g. while a parent sheet is closed).
 */
export function usePresence(enabled = true): UsePresenceResult {
  const { accountId } = useAuth();

  const [rows, setRows] = useState<PresenceMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());

  const active = enabled && !!accountId;

  useEffect(() => {
    if (!active || !accountId) return;

    const supabase = createClient();
    let cancelled = false;

    const refetch = async () => {
      const { data, error } = await supabase
        .from("member_presence")
        .select("user_id, status, last_seen_at, viewing_conversation_id")
        .eq("account_id", accountId);
      if (cancelled) return;
      if (error) {
        console.error("[usePresence] refetch error:", error.message);
        return;
      }
      const next: PresenceMap = new Map();
      for (const r of data ?? []) {
        next.set(r.user_id as string, {
          status: r.status,
          last_seen_at: r.last_seen_at,
          viewing_conversation_id: r.viewing_conversation_id ?? null,
        });
      }
      setRows(next);
    };

    void refetch();
    const interval = setInterval(() => {
      void refetch();
      setNow(Date.now());
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, accountId]);

  const getRow = useCallback(
    (userId: string): PresenceRow | undefined => rows.get(userId),
    [rows],
  );

  const getPresence = useCallback(
    (userId: string): PresenceStatus => {
      const row = rows.get(userId);
      return derivePresence(row?.status, row?.last_seen_at, now);
    },
    [rows, now],
  );

  const getViewers = useCallback(
    (conversationId: string, excludeUserId?: string | null): string[] => {
      const viewers: string[] = [];
      for (const [userId, row] of rows) {
        if (userId === excludeUserId) continue;
        if (isActivelyViewing(row, conversationId, now)) viewers.push(userId);
      }
      return viewers;
    },
    [rows, now],
  );

  return { getPresence, getRow, getViewers, now };
}
