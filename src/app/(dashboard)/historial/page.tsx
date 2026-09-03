"use client"
import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/hooks/use-auth"
import { hasMinRole } from "@/lib/auth/roles"
import { Loader2, ShieldAlert, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PRESENCE_DOT_CLASS } from "@/components/presence/presence-dot"
import { createClient } from "@/lib/supabase/client"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"

interface AuthActivityRow {
  action: string
  created_at: string
}

// Cada refresco de token JWT genera un par login/logout casi
// simultaneo -- ruidoso para un humano. Colapsa eventos consecutivos
// separados por menos de 60s en uno solo (se queda con el primer
// login de cada racha), para que el log muestre sesiones reales, no
// cada refresco silencioso. Pedido 2026-09-03.
const SESSION_MERGE_GAP_MS = 60_000

function dedupeActivity(rows: AuthActivityRow[]): AuthActivityRow[] {
  // rows viene ordenado DESC (mas reciente primero) desde la RPC.
  const result: AuthActivityRow[] = []
  for (const row of rows) {
    const prev = result[result.length - 1]
    if (prev) {
      const gap = Math.abs(
        new Date(prev.created_at).getTime() - new Date(row.created_at).getTime()
      )
      if (gap < SESSION_MERGE_GAP_MS) continue
    }
    result.push(row)
  }
  return result
}

// Agrupa logins (ya deduplicados) por dia, para el grafico de barras.
// range: cuantos dias hacia atras mostrar (7/30/90 ~ semana/mes/trimestre).
function buildDailyActivity(
  rows: AuthActivityRow[],
  rangeDays: number
): { date: string; count: number }[] {
  const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.action !== "login") continue
    const t = new Date(row.created_at).getTime()
    if (t < cutoff) continue
    const day = new Date(row.created_at).toLocaleDateString("es-CL", {
      timeZone: "America/Santiago",
      day: "2-digit",
      month: "2-digit",
    })
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .reverse()
}

interface AgentRow {
  user_id: string
  full_name: string
  email: string
  account_role: string
  last_seen_at: string | null
  presence_status: "online" | "away" | "offline"
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
  const [activityUser, setActivityUser] = useState<AgentRow | null>(null)
  const [activityRows, setActivityRows] = useState<AuthActivityRow[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityRange, setActivityRange] = useState<7 | 30 | 90>(7)

  const dailyActivity = useMemo(() => {
    if (!activityRows) return []
    return buildDailyActivity(activityRows, activityRange)
  }, [activityRows, activityRange])

  async function openActivity(agent: AgentRow) {
    setActivityUser(agent)
    setActivityRows(null)
    setActivityLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("get_user_auth_activity", {
        p_user_id: agent.user_id,
        p_limit: 100,
      })
      if (error) {
        console.error("[historial] get_user_auth_activity failed:", error)
        setActivityRows([])
        return
      }
      setActivityRows(dedupeActivity((data ?? []) as AuthActivityRow[]))
    } catch (err) {
      console.error("[historial] get_user_auth_activity failed:", err)
      setActivityRows([])
    } finally {
      setActivityLoading(false)
    }
  }

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
                <tr
                  key={a.user_id}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/50"
                  onClick={() => openActivity(a)}
                >
                  <td className="p-3 text-foreground">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRESENCE_DOT_CLASS[a.presence_status]}`}
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
      <Dialog
        open={activityUser !== null}
        onOpenChange={(open) => {
          if (!open) setActivityUser(null)
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {activityUser?.full_name}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Historial de inicio/cierre de sesion. Nota: cada refresco de
              token genera un par login/logout, no representa solo aperturas
              reales de la app.
            </DialogDescription>
          </DialogHeader>
          {!activityLoading && activityRows && activityRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex gap-1">
                {([7, 30, 90] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setActivityRange(r)}
                    className={`rounded-md px-2 py-1 text-xs ${
                      activityRange === r
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {r === 7 ? "Semana" : r === 30 ? "Mes" : "Trimestre"}
                  </button>
                ))}
              </div>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyActivity}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      stroke="var(--muted-foreground)"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10 }}
                      stroke="var(--muted-foreground)"
                      width={24}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        borderColor: "var(--border)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto space-y-1">
            {activityLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                Cargando...
              </div>
            ) : !activityRows || activityRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sin actividad registrada.</p>
            ) : (
              activityRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0"
                >
                  <span
                    className={
                      row.action === "login" ? "text-emerald-500 font-medium" : "text-muted-foreground"
                    }
                  >
                    {row.action === "login" ? "Inicio de sesion" : "Cierre de sesion"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(row.created_at).toLocaleString("es-CL", {
                      timeZone: "America/Santiago",
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
