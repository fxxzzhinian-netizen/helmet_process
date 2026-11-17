import type { EventRow, Identity, Photo } from './data'
import { withDisplayCapture } from './demoCapture'
import { parkTime } from './overviewAnalytics'

export type TaskQueue = 'pending' | 'processing' | 'reviews' | 'done' | 'error'
export type TaskImage = Photo & {
  batch_id: string
  uploaded_at?: string
  completed_at?: string
  identity?: Identity
  events: EventRow[]
}
export type TaskRow = { id: string; image: TaskImage; event?: EventRow }
export const taskQueues: { id: TaskQueue; label: string; unit: string }[] = [
  { id: 'pending', label: '已上传', unit: '张' },
  { id: 'processing', label: '处理中', unit: '张' },
  { id: 'reviews', label: '待人工复核', unit: '条' },
  { id: 'done', label: '已完成', unit: '张' },
  { id: 'error', label: '处理异常', unit: '张' },
]
export const needsReview = (event: EventRow) => event.status === 'review' && (event.review_eligible ?? (event.person_count ?? 0) >= 6)
const captureClock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
export function taskTime(value?: string) {
  const stamp = parkTime(value)
  if (!stamp) return ['—', '']
  if (stamp.hour == null) return [stamp.day, '']
  return captureClock.format(new Date(stamp.timestamp)).split(' ')
}

export function normalizeTask(image: TaskImage): TaskImage {
  const events = image.events.map(withDisplayCapture)
  const identity = withDisplayCapture({
    id: image.id, image_id: image.id, batch_id: image.batch_id, filename: image.filename,
    status: 'clear', reason: '', identity: events[0]?.identity,
  }).identity
  return { ...image, events, identity: identity?.reason === '尚未上传本批人员资料' ? { ...identity, reason: '尚未关联人员资料' } : identity }
}
export function imageQueue(image: TaskImage): TaskQueue {
  if (image.status === 'running' || image.queued) return 'processing'
  if (image.status === 'error') return 'error'
  if (image.status === 'pending') return 'pending'
  return image.events.some(needsReview) ? 'reviews' : 'done'
}
export function taskProgress(images: TaskImage[]) {
  const total = images.length
  const done = images.filter(image => image.status === 'done').length
  const failed = images.filter(image => image.status === 'error').length
  const running = images.filter(image => image.status === 'running').length
  const queued = images.filter(image => image.queued && image.status !== 'running').length
  const pending = images.filter(image => image.status === 'pending' && !image.queued).length
  const handled = done + failed
  return { total, done, failed, running, queued, pending, handled, percent: total ? Math.floor(handled / total * 100) : 0 }
}
export function taskRows(images: TaskImage[], queue: TaskQueue): TaskRow[] {
  if (queue === 'reviews') return images.flatMap(image => image.events.filter(needsReview).map(event => ({ id: event.id, image, event })))
  return images.filter(image => imageQueue(image) === queue).map(image => ({ id: image.id, image }))
}
export function initialQueue(images: TaskImage[]): TaskQueue {
  return (['reviews', 'pending', 'processing', 'error', 'done'] as TaskQueue[]).find(queue => taskRows(images, queue).length) || 'pending'
}
export function filterTasks(rows: TaskRow[], queue: TaskQueue, query: string, from: string, to: string, identity: string) {
  const term = query.trim().toLowerCase()
  return rows.filter(row => {
    const person = row.event?.identity || row.image.identity
    if (term && ![row.image.filename, row.id, person?.name, person?.plate_number, person?.person_id, person?.address]
      .some(value => value?.toLowerCase().includes(term))) return false
    if (identity === 'matched' && !row.image.events.some(event => event.identity?.status === 'matched')) return false
    if (identity === 'unmatched' && row.image.events.length && row.image.events.every(event => event.identity?.status === 'matched')) return false
    if (queue === 'done' && (from || to)) {
      const day = parkTime(person?.captured_at)?.day
      if (!day || from && day < from || to && day > to) return false
    }
    return true
  })
}
// Only explicitly selected, currently runnable photos enter a run request.
export function taskRuns(images: TaskImage[]) {
  const groups = new Map<string, Set<string>>()
  for (const image of images) {
    if (image.queued || !['pending', 'error'].includes(image.status)) continue
    if (!groups.has(image.batch_id)) groups.set(image.batch_id, new Set())
    groups.get(image.batch_id)!.add(image.id)
  }
  return [...groups].map(([batch, ids]) => ({ batch, ids: [...ids] }))
}
