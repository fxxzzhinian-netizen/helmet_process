import type { EventRow } from './data'

const dayClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
const hourClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23',
})

export type RecordScope = { from?: string; to?: string; address?: string; hour?: number }

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(day + 'T00:00:00Z')
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day
}

// Unzoned park timestamps are Beijing time. Never substitute upload/decision time.
export function parkTime(value?: string) {
  if (!value) return undefined
  const text = value.trim().replace(/\//g, '-')
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text)
  if (!match) return undefined
  const day = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-')
  if (!validDay(day)) return undefined
  if (match[4] == null) return { day, hour: undefined, timestamp: Date.parse(day + 'T00:00:00+08:00') }
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6] || 0)
  if (hour > 23 || minute > 59 || second > 59) return undefined
  const date = new Date(`${day}T${String(hour).padStart(2, '0')}:${match[5]}:${match[6] || '00'}${match[7] || ''}${match[8] || '+08:00'}`)
  if (isNaN(date.getTime())) return undefined
  return { day: dayClock.format(date), hour: Number(hourClock.format(date)), timestamp: date.getTime() }
}
export const captureTime = (row: EventRow) => parkTime(row.identity?.captured_at)
export const todayInPark = () => dayClock.format(new Date())
export function daysEnding(to: string, count: number) {
  if (!validDay(to)) return []
  const end = Date.parse(to + 'T00:00:00Z')
  return Array.from({ length: count }, (_, i) => new Date(end - (count - i - 1) * 86400000).toISOString().slice(0, 10))
}
export function daysBetween(from: string, to: string) {
  if (!validDay(from) || !validDay(to) || from > to) return []
  const count = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
  return count <= 366 ? daysEnding(to, count) : []
}
export function readRecordScope(params: URLSearchParams): RecordScope {
  const from = params.get('from') || '', to = params.get('to') || '', hour = params.get('hour')
  return {
    from: validDay(from) ? from : undefined, to: validDay(to) ? to : undefined,
    address: params.get('address') || undefined,
    hour: hour != null && /^\d{1,2}$/.test(hour) && Number(hour) < 24 ? Number(hour) : undefined,
  }
}
export function scopeParams(scope: RecordScope): Record<string, string> {
  return {
    ...(scope.from ? { from: scope.from } : {}), ...(scope.to ? { to: scope.to } : {}),
    ...(scope.address ? { address: scope.address } : {}), ...(scope.hour != null ? { hour: String(scope.hour) } : {}),
  }
}
export function inRecordScope(row: EventRow, scope: RecordScope) {
  const stamp = captureTime(row)
  if (scope.from && (!stamp || stamp.day < scope.from)) return false
  if (scope.to && (!stamp || stamp.day > scope.to)) return false
  if (scope.address && row.identity?.address?.trim() !== scope.address) return false
  if (scope.hour != null && stamp?.hour !== scope.hour) return false
  return true
}
export function summarizeOverview(rows: EventRow[], from: string, to: string) {
  const dates = daysBetween(from, to), selected = rows.filter(row => inRecordScope(row, { from, to }))
  const locations = new Map<string, number>(), hourly = Array<number>(24).fill(0)
  const model = dates.map(() => 0), human = dates.map(() => 0), other = dates.map(() => 0)
  const positions = new Map(dates.map((day, i) => [day, i]))
  let missingLocation = 0, missingHour = 0
  for (const row of selected) {
    const stamp = captureTime(row)!, i = positions.get(stamp.day)
    if (i != null) (row.source === 'human' ? human : row.source === 'model' ? model : other)[i]++
    const address = row.identity?.address?.trim()
    if (address) locations.set(address, (locations.get(address) || 0) + 1)
    else missingLocation++
    if (stamp.hour != null) hourly[stamp.hour]++
    else missingHour++
  }
  return {
    dates, selected, model, human, other, hourly, missingLocation, missingHour,
    missingDate: rows.filter(row => !captureTime(row)).length,
    locations: [...locations].sort(([a, n], [b, m]) => m - n || a.localeCompare(b, 'zh-CN')),
    modelCount: selected.filter(row => row.source === 'model').length,
    humanCount: selected.filter(row => row.source === 'human').length,
  }
}
