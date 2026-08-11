"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadHandoffQueue, loadMyTickets } from "@/lib/dashboard/queries";

const POLL_INTERVAL_MS = 12_000;
const BASE_TITLE = "wspcrm INO";

function notify(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icon.png" });
  } catch {
    // Best-effort
  }
}

/**
 * Componente headless montado una sola vez en el shell autenticado
 * (dashboard-shell.tsx). Poll cada 12s a la cola de handoff y a "mis
 * tickets" -- notifica llegadas nuevas y actualiza el titulo de la
 * pestaña con un contador. No usa Supabase Realtime (roto en este
 * deployment, ver wacrm_add3.md/add4.md).
 *
 * La funcion de poll se define DENTRO del useEffect (sin
 * useCallback) a proposito -- envolverla en useCallback rompia la
 * memoizacion del compilador de React de Next 16 ("Compilation
 * Skipped"). Al no memoizarla manualmente, el compilador no tiene
 * nada que "preservar" y compila sin problemas.
 */
export function BrowserNotifications() {
  const { accountId, user, profileLoading } = useAuth();
  const knownHandoffIds = useRef<Set<string>>(new Set());
  const knownMyTicketIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const [handoffCount, setHandoffCount] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!accountId || profileLoading) return;

    const tick = async () => {
      const db = createClient();

      const handoff = await loadHandoffQueue(db, 50);
      const handoffIds = new Set(handoff.map((h) => h.id));
      if (!firstLoad.current) {
        const newOnes = handoff.filter((h) => !knownHandoffIds.current.has(h.id));
        for (const item of newOnes) {
          notify(
            "Nuevo ticket esperando ejecutivo",
            item.contactName ? `${item.contactName} necesita atención` : "Un paciente necesita atención",
          );
        }
      }
      knownHandoffIds.current = handoffIds;
      setHandoffCount(handoff.length);

      if (user?.id) {
        const mine = await loadMyTickets(db, user.id, 50);
        const mineIds = new Set(mine.map((m) => m.id));
        if (!firstLoad.current) {
          const newOnes = mine.filter((m) => !knownMyTicketIds.current.has(m.id));
          for (const item of newOnes) {
            notify("Se te asignó un ticket", item.contactName ?? "Nueva conversación asignada");
          }
        }
        knownMyTicketIds.current = mineIds;
      }

      firstLoad.current = false;
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accountId, user?.id, profileLoading]);

  useEffect(() => {
    document.title = handoffCount > 0 ? `(${handoffCount}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [handoffCount]);

  return null;
}
