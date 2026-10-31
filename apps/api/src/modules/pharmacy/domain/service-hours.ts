export type ServiceHours = { weekday: number; opensAt: string; closesAt: string; timezone: string; active?: boolean }
export type ServiceException = { localDate: string; closed: boolean; opensAt?: string; closesAt?: string }

export function validClock(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false }
}

export function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export function localServiceTime(timeZone: string, instant = new Date()) {
  try {
    const pieces = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant)
    const values = Object.fromEntries(pieces.map((part) => [part.type, part.value]))
    const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return { weekday: days[values.weekday], minute: Number(values.hour) * 60 + Number(values.minute), date: `${values.year}-${values.month}-${values.day}` }
  } catch {
    return null
  }
}

export function isWithinServiceHours(hours: ServiceHours, instant: Date): boolean {
  const local = localServiceTime(hours.timezone, instant)
  if (!local || hours.active === false || local.weekday !== hours.weekday) return false
  if (!validClock(hours.opensAt) || !validClock(hours.closesAt)) return false
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
  return local.minute >= toMinutes(hours.opensAt) && local.minute < toMinutes(hours.closesAt)
}

export function isValidServiceHours(hours: unknown): hours is ServiceHours[] {
  if (!Array.isArray(hours)) return false
  const weekdays = new Set<number>()
  return hours.every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const value = entry as Record<string, unknown>
    const timezone = value.timezone ?? 'Asia/Jakarta'
    const weekday = value.weekday
    const valid = typeof weekday === 'number' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 && !weekdays.has(weekday)
      && validClock(value.opensAt) && validClock(value.closesAt) && String(value.closesAt) > String(value.opensAt)
      && validTimezone(timezone)
    if (valid) weekdays.add(weekday as number)
    return valid
  })
}

export function isValidServiceExceptions(exceptions: unknown): exceptions is ServiceException[] {
  if (!Array.isArray(exceptions)) return false
  return exceptions.every((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const value = entry as Record<string, unknown>
    return validLocalDate(value.localDate) && typeof value.closed === 'boolean'
      && (value.closed === true || (validClock(value.opensAt) && validClock(value.closesAt) && String(value.closesAt) > String(value.opensAt)))
  })
}
