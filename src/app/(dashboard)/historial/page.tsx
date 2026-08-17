"use client"
import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { Loader2, ShieldAlert, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface AgentRow {
  user_id: string
  full_name: string
  email: string
  account_role: string
  last_seen_at: string | null
  presence_status: "online" | "away" | null
  total_attended: number
  open_count: number
  pending_count: number
  closed_count: number
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  admin: "Admin",
  agent: "Agente",
}

type RangePreset = "today" | "week" | "month" | "all" | "custom"

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Nunca"
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "Justo ahora"
  if (diffMin < 60) return `Hace ${diffMin} min`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `Hace ${diffHrs} h`
  const diffDays = Math.floor(diffHrs / 24)
  return `Hace ${diffDays} d`
}

// Fechas locales (no UTC) para que "hoy"/"esta semana" coincidan con
// lo que el admin espera ver en su huso horario, no en UTC.
function toDateInputValue(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function rangeForPreset(preset: RangePreset): { from: string | null; to: string | null } {
  const now = new Date()
  if (preset === "all") return { from: null, to: null }
  if (preset === "today") {
    return { from: toDateInputValue(now), to: null }
  }
  if (preset === "week") {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return { from: toDateInputValue(d), to: null }
  }
  if (preset === "month") {
    const d = new Date(now)
    d.setDate(d.getDate() - 30)
    return { from: toDateInputValue(d), to: null }
  }
  return { from: null, to: null }
}

export default function HistorialPage() {
  const { accountRole, profileLoading } = useAuth()
  const allowed = !profileLoading && !!accountRole && hasMinRole(accountRole, "admin")

  const [preset, setPreset] = useState<RangePreset>("all")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")

  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const effectiveRange = useMemo(() => {
    if (preset === "custom") return { from: customFrom || null, to: customTo || null }
    return rangeForPreset(preset)
  }, [preset, customFrom, customTo])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (effectiveRange.from) params.set("from", effectiveRange.from)
      if (effectiveRange.to) params.set("to", effectiveRange.to)
      const qs = params.toString()
      const res = await fetch(`/api/historial/agent-report${qs ? `?${qs}` : ""}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? "Failed to load report")
      setAgents(body.agents ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report")
    } finally {
      setLoading(false)
    }
  }, [effectiveRange])

  useEffect(() => {
    if (allowed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load()
    }
  }, [allowed, load])

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

  const presetLabel: Record<RangePreset, string> = {
    today: "Hoy",
    week: "Últimos 7 días",
    month: "Últimos 30 días",
    all: "Todo el histórico",
    custom: "Rango personalizado",
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Historial y Estadísticas
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Acceso y actividad por usuario: último acceso al sistema y
        conversaciones atendidas en el rango seleccionado (incluye
        reasignadas), desglosadas por estado actual.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["today", "week", "month", "all", "custom"] as RangePreset[]).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={preset === p ? "default" : "outline"}
            onClick={() => setPreset(p)}
          >
            {presetLabel[p]}
          </Button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="w-36"
            />
            <span className="text-sm text-muted-foreground">a</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="w-36"
            />
          </div>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{error}</p>
        ) : !agents || agents.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Sin datos en este rango.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">Usuario</th>
                <th className="p-3 font-medium">Rol</th>
                <th className="p-3 font-medium">Último acceso</th>
                <th className="p-3 font-medium text-right">Atendidas</th>
                <th className="p-3 font-medium text-right">Abiertas</th>
                <th className="p-3 font-medium text-right">Pendientes</th>
                <th className="p-3 font-medium text-right">Cerradas</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.user_id} className="border-b border-border last:border-0">
                  <td className="p-3 text-foreground">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          a.presence_status === "online" ? "bg-primary" : "bg-muted-foreground/40"
                        }`}
                      />
                      <div>
                        <div>{a.full_name}</div>
                        <div className="text-xs text-muted-foreground">{a.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {ROLE_LABEL[a.account_role] ?? a.account_role}
                  </td>
                  <td className="p-3 text-muted-foreground">{formatLastSeen(a.last_seen_at)}</td>
                  <td className="p-3 text-right font-medium text-foreground">{a.total_attended}</td>
                  <td className="p-3 text-right text-primary">{a.open_count}</td>
                  <td className="p-3 text-right text-amber-500">{a.pending_count}</td>
                  <td className="p-3 text-right text-muted-foreground">{a.closed_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
