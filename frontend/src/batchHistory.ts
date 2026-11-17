import type { Batch } from './data'

export type HistoryOrder = 'newest' | 'oldest'
type HistoryFilters = {
  query?: string
  status?: string
  from?: string
  to?: string
  order?: HistoryOrder
}

const calendar = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// 与页面显示一致，日期范围按北京时间计算，包含起止两天。
export function createdDay(iso?: string) {
  const date = new Date(iso || '')
  if (!Number.isFinite(date.getTime())) return ''
  const parts = calendar.formatToParts(date)
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-')
}

export function filterHistory(
  batches: Batch[],
  { query = '', status = '', from = '', to = '', order = 'newest' }: HistoryFilters = {}
) {
  if (from && to && from > to) return []
  const keyword = query.trim().toLowerCase()
  return batches
    .filter((batch) => {
      if (status && batch.status !== status) return false
      if (!batch.name.toLowerCase().includes(keyword)) return false
      if (!from && !to) return true
      const day = createdDay(batch.created_at)
      return !!day && (!from || day >= from) && (!to || day <= to)
    })
    .map((batch) => ({ batch, time: Date.parse(batch.created_at || '') }))
    .sort((a, b) => {
      // 缺失时间始终放在末尾；相同时间保持原顺序。
      if (!Number.isFinite(a.time)) return Number.isFinite(b.time) ? 1 : 0
      if (!Number.isFinite(b.time)) return -1
      return order === 'newest' ? b.time - a.time : a.time - b.time
    })
    .map(({ batch }) => batch)
}
