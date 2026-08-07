import type { SupabaseClient } from '@supabase/supabase-js'

export interface BusinessHoursConfig {
  business_hours_enabled: boolean
  business_hours_days: number[]
  business_hours_start: string // 'HH:MM:SS' (Postgres time)
  business_hours_end: string
  business_hours_closed_message: string
  business_hours_weekend_enabled: boolean
  business_hours_weekend_start: string
  business_hours_weekend_end: string
  business_hours_revert_message: string
}

export async function loadBusinessHours(
  db: SupabaseClient,
  accountId: string,
): Promise<BusinessHoursConfig | null> {
  const { data } = await db
    .from('accounts')
    .select(
      'business_hours_enabled, business_hours_days, business_hours_start, business_hours_end, business_hours_closed_message, business_hours_weekend_enabled, business_hours_weekend_start, business_hours_weekend_end, business_hours_revert_message',
    )
    .eq('id', accountId)
    .maybeSingle()
  return (data as BusinessHoursConfig | null) ?? null
}

/** ISO weekday (1=lunes...7=domingo) y HH:MM en America/Santiago, sin librerías de fecha. */
function santiagoNowParts(): { isoDay: number; hhmm: string } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  }
  return { isoDay: map[weekdayShort] ?? 1, hhmm: `${hour}:${minute}` }
}

const WEEKEND_DAYS = new Set([6, 7])

/** true = hay ejecutivos disponibles ahora mismo (o la feature está desactivada). */
export function isWithinBusinessHours(config: BusinessHoursConfig): boolean {
  if (!config.business_hours_enabled) return true
  const { isoDay, hhmm } = santiagoNowParts()
  if (!config.business_hours_days.includes(isoDay)) return false

  const useWeekendHours = WEEKEND_DAYS.has(isoDay) && config.business_hours_weekend_enabled
  const start = (useWeekendHours ? config.business_hours_weekend_start : config.business_hours_start).slice(0, 5)
  const end = (useWeekendHours ? config.business_hours_weekend_end : config.business_hours_end).slice(0, 5)
  return hhmm >= start && hhmm <= end
}
