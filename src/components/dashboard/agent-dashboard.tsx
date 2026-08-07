"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Loader2, UserCog, Inbox as InboxIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { useHandoffQueueLive } from "@/hooks/use-handoff-queue-live"
import { createClient } from "@/lib/supabase/client"
import { loadMyTickets } from "@/lib/dashboard/queries"
import type { MyTicketItem } from "@/lib/dashboard/types"
import { EmptyState } from "./empty-state"
import { Skeleton } from "./skeleton"

/**
 * Dashboard for agents (accountRole === 'agent'): the shared handoff
 * queue (tickets waiting on any human) with a sound + visual pulse
 * when a new one lands, plus their own assigned open/pending tickets.
 * Deliberately excludes the business metrics on the admin dashboard —
 * those don't help an agent and just add scroll.
 */
export function AgentDashboard() {
  const router = useRouter()
  const { accountId, user } = useAuth()
  const userId = user?.id ?? null
  const { items: queueItems, loading: queueLoading, justArrivedId } = useHandoffQueueLive()

  const [myTickets, setMyTickets] = useState<MyTicketItem[] | null>(null)
  const [myTicketsLoading, setMyTicketsLoading] = useState(true)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [pulseId, setPulseId] = useState<string | null>(null)


  useEffect(() => {
    if (!justArrivedId) return
    setPulseId(justArrivedId)
    const timeout = setTimeout(() => setPulseId(null), 3000)
    return () => clearTimeout(timeout)
  }, [justArrivedId])

  const refetchMyTickets = useCallback((showSpinner = false) => {
    if (!userId) return
    // Only flash the skeleton on the very first load. Poll ticks after
    // that update the list silently — flipping loading true/false every
    // 12s made the whole card blink even when nothing actually changed.
    if (showSpinner) setMyTicketsLoading(true)
    const db = createClient()
    loadMyTickets(db, userId, 20)
      .then((t) => setMyTickets(t))
      .catch((err) => console.error("[agent-dashboard] my tickets failed:", err))
      .finally(() => setMyTicketsLoading(false))
  }, [userId])

  useEffect(() => {
    refetchMyTickets(true)
  }, [refetchMyTickets])

  // Polling, not realtime — see the comment in use-handoff-queue-live.ts
  // for why (Kong 431s on the websocket upgrade on this deployment).
  // A claim or reassignment shows up within one tick.
  useEffect(() => {
    if (!accountId) return
    const interval = setInterval(() => refetchMyTickets(false), 12_000)
    return () => clearInterval(interval)
  }, [accountId, refetchMyTickets])

  async function handleClaim(id: string) {
    setClaimingId(id)
    try {
      const res = await fetch(`/api/conversations/${id}/claim`, { method: "POST" })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j?.error ?? "No se pudo tomar esta conversación")
        return
      }
      // Straight to the chat — no intermediate confirmation, the agent
      // asked for this ticket and wants to start replying immediately.
      router.push(`/inbox?c=${id}`)
    } catch {
      toast.error("No se pudo conectar con el servidor")
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mi panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tickets esperando ejecutivo y tus conversaciones asignadas.
          </p>
        </div>

      </div>

      {/* Shared handoff queue */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Esperando ejecutivo</h2>
            {!queueLoading && (queueItems?.length ?? 0) > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                {queueItems?.length}
              </span>
            )}
          </div>
          <Link href="/inbox" className="text-xs font-medium text-primary hover:text-primary/80">
            Ver inbox
          </Link>
        </header>

        {queueLoading || !queueItems ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : queueItems.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={UserCog} title="Nadie esperando" hint="Los tickets derivados a ejecutiva aparecerán aquí." />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {queueItems.map((it, i) => {
              const stripe = i % 2 === 0 ? "bg-transparent" : "bg-muted/40"
              const claiming = claimingId === it.id
              const pulsing = pulseId === it.id
              return (
                <li
                  key={it.id}
                  className={cn(
                    stripe,
                    "transition-colors duration-1000 hover:bg-muted/40",
                    pulsing && "bg-red-500/20",
                  )}
                >
                  <div className="flex items-center gap-3 px-5 py-2.5">
                    <span
                      className={cn(
                        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400",
                        pulsing && "ring-2 ring-red-500",
                      )}
                    >
                      <UserCog className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {it.contactName || it.phone}
                      </span>
                      {it.preview && (
                        <span className="block truncate text-xs text-muted-foreground">{it.preview}</span>
                      )}
                    </span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                      {relativeTime(it.waitingSince)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleClaim(it.id)}
                      disabled={claiming}
                      className="flex-shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                    >
                      {claiming ? <Loader2 className="h-3 w-3 animate-spin" /> : "Tomar"}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* My assigned tickets */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Mis conversaciones</h2>
        </header>

        {myTicketsLoading || !myTickets ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : myTickets.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={InboxIcon} title="Sin conversaciones asignadas" hint="Los tickets que tomes aparecerán aquí." />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {myTickets.map((it, i) => {
              const stripe = i % 2 === 0 ? "bg-transparent" : "bg-muted/40"
              return (
                <li key={it.id} className={cn(stripe, "transition-colors hover:bg-muted/40")}>
                  <Link href={`/inbox?c=${it.id}`} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <InboxIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {it.contactName || it.phone}
                      </span>
                      {it.preview && (
                        <span className="block truncate text-xs text-muted-foreground">{it.preview}</span>
                      )}
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {it.status === "open" ? "Abierta" : "Pendiente"}
                    </span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                      {relativeTime(it.lastActivity)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return `${Math.max(1, diffSec)}s`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`
  return `${Math.floor(diffSec / 86400)}d`
}
