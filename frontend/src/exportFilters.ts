import { eventStatus, eventStatusName, sourceName, type EventRow } from './data'

export type ExportFilters = {
  query: string
  name: string
  personId: string
  plate: string
  chip: string
  address: string
  batch: string
  source: string
  identity: string
  status: string
  dateField: 'captured' | 'recognized' | 'decision'
  from: string
  to: string
}
export const emptyExportFilters = (): ExportFilters => ({
  query: '', name: '', personId: '', plate: '', chip: '', address: '', batch: '', source: '', identity: '', status: '',
  dateField: 'captured', from: '', to: '',
})
const dateClock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
export function exportDay(value?: string) {
  if (!value) return undefined
  const text = value.trim()
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text)
    return isNaN(date.getTime()) ? undefined : dateClock.format(date)
  }
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\b|T)/.exec(text)
  if (!match) return undefined
  const key = [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-')
  const parsed = new Date(key + 'T00:00:00Z')
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : undefined
}

export function filterExportRows(rows: EventRow[], filter: ExportFilters) {
  if (filter.from && filter.to && filter.from > filter.to) return []
  const contains = (value: string | undefined, term: string) => !term.trim() || (value || '').toLowerCase().includes(term.trim().toLowerCase())
  const terms = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    const person = row.identity
    if (filter.batch && row.batch_id !== filter.batch || filter.source && row.source !== filter.source ||
        filter.status && eventStatus(row) !== filter.status || filter.identity && (person?.status || 'unrecognized') !== filter.identity) return false
    if (!contains(person?.name || '未识别', filter.name) || !contains(person?.person_id, filter.personId) ||
        !contains(person?.plate_number, filter.plate) || !contains(person?.rfid_chip, filter.chip) || !contains(person?.address, filter.address)) return false
    if (terms.length) {
      const fields = [row.filename, row.id, row.batch_name, row.batch_id, row.reason, sourceName(row.source), eventStatusName(row),
        person?.name, person?.person_id, person?.plate_number, person?.rfid_chip, person?.phone, person?.address, person?.department, person?.jurisdiction]
      if (!terms.every((term) => fields.some((value) => value?.toLowerCase().includes(term)))) return false
    }
    if (filter.from || filter.to) {
      const date = exportDay(filter.dateField === 'captured' ? person?.captured_at : filter.dateField === 'recognized' ? row.recognized_at : row.updated_at)
      if (!date || filter.from && date < filter.from || filter.to && date > filter.to) return false
    }
    return true
  })
}
