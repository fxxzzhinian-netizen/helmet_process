import { api, getIndex, pathId, type AnalyticsCounts, type Batch, type Detail, type Index, type Outcome, type WorkAnalytics } from './data'

const counters = ['uploaded', 'processed', 'done', 'failed', 'helmet', 'no_helmet', 'unknown',
  'scored', 'correct', 'people', 'violations', 'reviews', 'clear', 'matched', 'unmatched', 'demo'] as const
type Counts = Record<typeof counters[number], number>
type Sample = {
  status: Detail['status']; prediction: Detail['prediction']; truth: Detail['truth']; completed_at?: string
  people: number; events: { status: Outcome; matched: boolean; demo: boolean }[]
}
const batchesCache = new Map<string, { signature: string; batch: Batch }>()
const imagesCache = new Map<string, { signature: string; sample: Sample }>()
const dateClock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
const empty = (): Counts => Object.fromEntries(counters.map((key) => [key, 0])) as Counts
const dateKey = (value?: string) => {
  const date = value ? new Date(value) : undefined
  return date && !isNaN(date.getTime()) ? dateClock.format(date) : undefined
}
const ratio = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : null
const withRates = (counts: Counts): AnalyticsCounts => ({ ...counts,
  failure_rate: ratio(counts.failed, counts.processed), score_rate: ratio(counts.correct, counts.scored),
  match_rate: ratio(counts.matched, counts.matched + counts.unmatched),
})

async function pooled<T, R>(items: T[], action: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await action(items[index])
    }
  }))
  return results
}

// Existing installations can show the same statistics before their service is
// restarted. Read only, with bounded requests and cached per-image summaries.
async function compatibleAnalytics(scope: string, span: number, source?: Index): Promise<WorkAnalytics> {
  const index = source || await getIndex()
  const selected = index.batches.filter((batch) => !scope || batch.id === scope)
  if (scope && !selected.length) throw new Error('所选批次已不存在，请重新选择统计批次。')
  const last = Date.parse(dateClock.format(new Date()) + 'T00:00:00Z')
  const dates = Array.from({ length: span }, (_, day) => new Date(last - (span - day - 1) * 86400000).toISOString().slice(0, 10))
  const daily = new Map(dates.map((date) => [date, empty()]))
  const batches = await pooled(selected, async (batch) => {
    const signature = [batch.total, batch.processed, batch.failed, batch.running, batch.queued].join(':')
    const cached = batchesCache.get(batch.id)
    if (cached?.signature === signature) return { ...cached.batch, association: batch.association }
    const detail = await api<Batch>('/batches/' + pathId(batch.id))
    batchesCache.set(batch.id, { signature, batch: detail })
    return detail
  })
  const eventVersions = new Map<string, string[]>()
  for (const event of [...index.reviews, ...index.violations]) {
    const versions = eventVersions.get(event.image_id) || []
    versions.push([event.id, event.status, event.updated_at].join(':'))
    eventVersions.set(event.image_id, versions)
  }
  for (const batch of batches) {
    const bucket = daily.get(dateKey(batch.created_at) || '')
    if (bucket) bucket.uploaded += batch.total
  }
  const photos = batches.flatMap((batch) => (batch.images || [])
    .filter((photo) => photo.status === 'done' || photo.status === 'error')
    .map((photo) => ({ photo, batch })))
  const samples = await pooled(photos, async ({ photo, batch }) => {
    const signature = [photo.status, batch.association?.revision || 0, (eventVersions.get(photo.id) || []).sort().join('|')].join(':')
    const cached = imagesCache.get(photo.id)
    if (cached?.signature === signature) return { sample: cached.sample, batch }
    const detail = await api<Detail & { completed_at?: string }>('/images/' + pathId(photo.id))
    const sample: Sample = {
      status: detail.status, prediction: detail.prediction, truth: detail.truth, completed_at: detail.completed_at,
      people: detail.analysis?.person_count || 0,
      events: (detail.events || []).map((event) => ({ status: event.status, matched: event.identity?.status === 'matched',
        demo: event.identity?.status === 'matched' && event.identity.method === 'demo' })),
    }
    if (detail.status === photo.status) imagesCache.set(photo.id, { signature, sample })
    return { sample, batch }
  })
  for (const { sample, batch } of samples) {
    const bucket = daily.get(dateKey(sample.completed_at) || dateKey(batch.created_at) || '')
    if (!bucket || (sample.status !== 'done' && sample.status !== 'error')) continue
    bucket.processed++
    if (sample.status === 'error') { bucket.failed++; continue }
    bucket.done++
    if (sample.prediction) bucket[sample.prediction]++
    if (sample.truth != null) { bucket.scored++; bucket.correct += Number(sample.prediction === sample.truth) }
    bucket.people += sample.people
    for (const event of sample.events) {
      bucket[event.status === 'violation' ? 'violations' : event.status === 'review' ? 'reviews' : 'clear']++
      bucket[event.matched ? 'matched' : 'unmatched']++
      bucket.demo += Number(event.demo)
    }
  }
  const summary = empty()
  for (const bucket of daily.values()) for (const key of counters) summary[key] += bucket[key]
  return { batch_id: scope || null, span, generated_at: new Date().toISOString(), summary: withRates(summary),
    days: dates.map((date) => ({ date, ...withRates(daily.get(date)!) })) }
}

export async function getWorkAnalytics(scope: string, span: number, index?: Index): Promise<WorkAnalytics> {
  const response = await fetch('/api/analytics?days=' + span + (scope ? '&batch_id=' + pathId(scope) : ''), { cache: 'no-store' })
  if (response.status === 404) return compatibleAnalytics(scope, span, index)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || body.detail || '统计读取失败，请重试。')
  return body
}
