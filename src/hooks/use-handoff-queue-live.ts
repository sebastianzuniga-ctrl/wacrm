"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { loadHandoffQueue } from "@/lib/dashboard/queries"
import type { HandoffQueueItem } from "@/lib/dashboard/types"

// Polling interval for the agent's handoff queue. Supabase Realtime
// (postgres_changes over websocket) isn't usable on this deployment —
// the local Kong gateway 431s on the websocket upgrade, a Supabase-CLI/
// Kong internals issue, not something fixable from the app. 12s keeps
// the dashboard feeling responsive (worst case: a new ticket shows up
// ~12s after it lands) without hammering PostgREST.
const POLL_INTERVAL_MS = 12_000

/**
 * Handoff queue for the agent dashboard: full list (not just a count,
 * unlike useHandoffQueueCount) plus a one-shot "justArrived" flag the
 * caller can use to fire a sound/visual alert exactly once per newly
 * -seen ticket, not on every poll tick.
 *
 * Polling-based (see POLL_INTERVAL_MS comment) rather than realtime.
 */
export function useHandoffQueueLive(): {
  items: HandoffQueueItem[] | null
  loading: boolean
  justArrivedId: string | null
} {
  const { accountId } = useAuth()
  const [items, setItems] = useState<HandoffQueueItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [justArrivedId, setJustArrivedId] = useState<string | null>(null)
  const knownIds = useRef<Set<string>>(new Set())
  const firstLoad = useRef(true)

  const refetch = useCallback(async () => {
    const db = createClient()
    const fresh = await loadHandoffQueue(db, 50)
    const freshIds = new Set(fresh.map((it) => it.id))

    if (!firstLoad.current) {
      const newOne = fresh.find((it) => !knownIds.current.has(it.id))
      if (newOne) setJustArrivedId(newOne.id)
    }
    firstLoad.current = false
    knownIds.current = freshIds

    setItems(fresh)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!accountId) return
    void refetch()
    const interval = setInterval(() => void refetch(), POLL_INTERVAL_MS)
    return () => {
      clearInterval(interval)
    }
  }, [accountId, refetch])

  return { items, loading, justArrivedId }
}
