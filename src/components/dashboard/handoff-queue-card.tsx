"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Loader2, UserCog } from "lucide-react"
import type { HandoffQueueItem } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"
import { EmptyState } from "./empty-state"
import { Skeleton } from "./skeleton"

interface HandoffQueueCardProps {
  items: HandoffQueueItem[] | null
  loading: boolean
}

export function HandoffQueueCard({ items, loading }: HandoffQueueCardProps) {
  const [claimingId, setClaimingId] = useState<string | null>(null)
  // Locally hide anything claimed from this card without waiting on a
  // full dashboard refetch \u2014 the badge/list catch up on their own next
  // load (or via the count hook's realtime subscription).
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set())

  const visibleItems = items?.filter((it) => !claimedIds.has(it.id)) ?? null
  const count = visibleItems?.length ?? 0

  async function handleClaim(id: string) {
    setClaimingId(id)
    try {
      const res = await fetch(`/api/conversations/${id}/claim`, {
        method: "POST",
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        toast.error(j?.error ?? "Couldn't claim this conversation")
        return
      }
      setClaimedIds((prev) => new Set(prev).add(id))
      toast.success("Conversation claimed")
    } catch {
      toast.error("Couldn't reach the server")
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            Needs a human agent
          </h2>
          {!loading && count > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
              {count}
            </span>
          )}
        </div>
        <Link
          href="/inbox"
          className="text-xs font-medium text-primary hover:text-primary/80"
        >
          View inbox
        </Link>
      </header>

      {loading || !visibleItems ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={UserCog}
            title="Nobody's waiting"
            hint="Conversations the AI hands off to a human will show up here."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visibleItems.map((it, i) => {
            const stripe = i % 2 === 0 ? "bg-transparent" : "bg-muted/40"
            const claiming = claimingId === it.id
            return (
              <li key={it.id} className={cn(stripe, "transition-colors hover:bg-muted/40")}>
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <Link
                    href={`/inbox?c=${it.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                      <UserCog className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {it.contactName || it.phone}
                      </span>
                      {it.preview && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {it.preview}
                        </span>
                      )}
                    </span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                      {relativeTime(it.waitingSince)}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleClaim(it.id)}
                    disabled={claiming}
                    className="flex-shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {claiming ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Claim"
                    )}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
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
