"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"

// Polling en vez de Supabase Realtime -- Realtime (postgres_changes
// sobre websocket) esta roto en este deployment (Kong 431 en el
// handshake, ver wacrm_add3.md/add4.md). Antes esta suscripcion nunca
// disparaba, asi que el badge quedaba pegado en el valor inicial
// hasta un refresh de pagina. Mismo intervalo que
// use-handoff-queue-live.ts para consistencia.
const POLL_INTERVAL_MS = 12_000

/**
 * Count of conversations waiting on a human agent — the AI paused
 * auto-reply on them (`ai_autoreply_disabled = true`) and they're not
 * yet closed. Drives the red badge on the sidebar/dashboard.
 */
export function useHandoffQueueCount(): number {
  const { accountId } = useAuth()
  const [count, setCount] = useState(0)

  const refetch = useCallback(async () => {
    if (!accountId) return
    const supabase = createClient()
    const { count: n, error } = await supabase
      .from("conversations")
      .select("*", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("ai_autoreply_disabled", true)
      .is("assigned_agent_id", null)
      .neq("status", "closed")
    if (error) return
    setCount(n ?? 0)
  }, [accountId])

  useEffect(() => {
    if (!accountId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch()
    const interval = setInterval(() => void refetch(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [accountId, refetch])

  return count
}
