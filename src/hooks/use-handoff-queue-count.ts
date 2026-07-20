"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"

/**
 * Count of conversations waiting on a human agent — the AI paused
 * auto-reply on them (`ai_autoreply_disabled = true`) and they're not
 * yet closed. Drives the red badge on the sidebar/dashboard.
 *
 * Unlike `useUnreadNotifications` (which derives the new count purely
 * from the changed row's single `read_at` field), a conversation's
 * "needs a human" state depends on two columns at once
 * (`ai_autoreply_disabled` + `status`), so any change just triggers a
 * fresh COUNT rather than hand-rolled increment/decrement logic —
 * simpler and correct, and cheap given how rarely this fires.
 */
export function useHandoffQueueCount(): number {
  const { accountId } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!accountId) return
    const supabase = createClient()
    let cancelled = false

    async function refetch() {
      const { count: n, error } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .eq("account_id", accountId as string)
        .eq("ai_autoreply_disabled", true)
        .is("assigned_agent_id", null)
        .neq("status", "closed")
      if (cancelled || error) return
      setCount(n ?? 0)
    }

    refetch()

    const channel = supabase
      .channel(`handoff-queue-count-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `account_id=eq.${accountId}`,
        },
        () => refetch(),
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [accountId])

  return count
}
