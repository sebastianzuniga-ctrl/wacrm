"use client"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Search, ShieldAlert } from "lucide-react"

interface Stats {
  total: number
  open: number
  pending: number
  closed: number
  avgDurationHours: number | null
  perDay: { date: string; count: number }[]
}

interface ConvRow {
  id: string
  status: string
  created_at: string
  last_message_at: string | null
  last_message_text: string | null
}

interface ContactResult {
  id: string
  name: string | null
  phone: string
  avatar_url: string | null
  conversations: ConvRow[]
}

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  pending: "Pendiente",
  closed: "Cerrada",
}

const STATUS_COLOR: Record<string, string> = {
  open: "text-primary",
  pending: "text-amber-500",
  closed: "text-muted-foreground",
}

export default function HistorialPage() {
  const { accountRole, profileLoading } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ContactResult[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const allowed = !profileLoading && !!accountRole && hasMinRole(accountRole, "admin")

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/historial/stats")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? "Failed to load stats")
      setStats(body)
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Failed to load stats")
    }
  }, [])

  useEffect(() => {
    if (allowed) loadStats()
  }, [allowed, loadStats])

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (query.trim().length < 2) {
        setSearchError("Ingresa al menos 2 caracteres")
        return
      }
      setSearching(true)
      setSearchError(null)
      try {
        const res = await fetch(`/api/historial/search?q=${encodeURIComponent(query.trim())}`)
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error ?? "Search failed")
        setResults(body.contacts ?? [])
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "Search failed")
      } finally {
        setSearching(false)
      }
    },
    [query]
  )

  if (profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Acceso restringido</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Esta sección es solo para administradores.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Historial y Estadísticas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumen de tickets y búsqueda de historial de conversaciones por paciente o teléfono.
        </p>
      </div>

      {statsError ? (
        <p className="text-sm text-red-400">{statsError}</p>
      ) : !stats ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total tickets" value={stats.total} />
            <StatCard label="Abiertas" value={stats.open} accent="text-primary" />
            <StatCard label="Pendientes" value={stats.pending} accent="text-amber-500" />
            <StatCard label="Cerradas" value={stats.closed} accent="text-muted-foreground" />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">
              Tickets nuevos por día (últimos 30 días)
            </p>
            {stats.perDay.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin tickets en este período.</p>
            ) : (
              <div className="space-y-1">
                {[...stats.perDay].reverse().map((d) => (
                  <div
                    key={d.date}
                    className="flex items-center justify-between rounded-md px-2 py-1 text-sm hover:bg-muted"
                  >
                    <span className="text-muted-foreground">
                      {new Date(d.date + "T00:00:00").toLocaleDateString("es-CL", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className="font-medium text-foreground">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-semibold text-foreground">
          Buscar historial por paciente o teléfono
        </p>
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre o número de teléfono"
              className="border-border bg-muted pl-9 text-sm text-foreground"
            />
          </div>
          <Button type="submit" disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
          </Button>
        </form>
        {searchError && <p className="mt-2 text-sm text-red-400">{searchError}</p>}

        {results !== null && (
          <div className="mt-4 space-y-4">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No se encontraron contactos para &quot;{query}&quot;.
              </p>
            ) : (
              results.map((contact) => (
                <div key={contact.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {contact.name || contact.phone}
                    </p>
                    <span className="text-xs text-muted-foreground">{contact.phone}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {contact.conversations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin conversaciones.</p>
                    ) : (
                      contact.conversations.map((conv) => (
                        <Link
                          key={conv.id}
                          href={`/inbox?c=${conv.id}`}
                          className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <span className="truncate text-muted-foreground">
                            {conv.last_message_text || "Sin mensajes"}
                          </span>
                          <span className="ml-2 flex shrink-0 items-center gap-2">
                            <span className={STATUS_COLOR[conv.status] ?? "text-muted-foreground"}>
                              {STATUS_LABEL[conv.status] ?? conv.status}
                            </span>
                            <span className="text-muted-foreground">
                              {new Date(conv.created_at).toLocaleDateString("es-CL")}
                            </span>
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? "text-foreground"}`}>{value}</p>
    </div>
  )
}
