import { useCallback, useEffect, useRef, useState } from 'react'
import { withDisplayCapture } from './demoCapture'

export type Status = 'pending' | 'running' | 'done' | 'error'
export type Prediction = 'helmet' | 'no_helmet' | 'unknown'
export type Outcome = 'review' | 'violation' | 'clear'
export type Photo = {
  id: string
  filename: string
  queued?: number | boolean
  status: Status
  prediction?: Prediction | null
  truth?: Prediction | null
  error?: string | null
}
export type Batch = {
  id: string
  name: string
  status: Status
  created_at?: string
  total: number
  processed: number
  // 数量拆分：已完成、识别失败、已排队、识别中
  done?: number
  failed?: number
  queued?: number
  running?: number
  score?: { correct: number; total: number } | null
  association?: AssociationImport | null
  images?: Photo[]
}
export type Detection = {
  id: string
  box: number[]
  label: string
  confidence: number
  panel?: string
  subject_id?: string
  detection_ids?: string[]
  role?: string | null
  decision?: Prediction | null
  role_uncertain?: boolean
  agreement?: string
  reason?: string
}
export type ConsensusAnalysis = {
  version: string
  prediction: Prediction
  cross_view_merged: boolean
  raw_count: number
  person_count: number
  vehicle_count: number
  uncertain_count: number
  subjects: Detection[]
  detections: Detection[]
}
export type Vehicle = {
  id: string
  detection_ids: string[]
  status: Outcome
  reason: string
  note?: string
  source?: string
  vehicle_id?: string
}
export type Detail = Photo & {
  batch_id: string
  width: number
  height: number
  error?: string
  model_version?: string
  detections: Detection[]
  analysis?: ConsensusAnalysis | null
  vehicles: Vehicle[]
  events?: EventRow[]
}
export type EventRow = {
  id: string
  image_id: string
  batch_id: string
  filename: string
  status: Outcome
  reason: string
  source?: string
  vehicle_id?: string
  note?: string
  detection_ids?: string[]
  scope?: string
  position?: number
  updated_at?: string // 最近一次判定（模型或人工）的时间
  recognized_at?: string // 本图识别完成的时间，与人员资料中的抓拍时间分开
  batch_name?: string
  identity?: Identity
  review_eligible?: boolean
  person_count?: number
}
export type AssociationImport = {
  revision: number
  filename: string
  mode: 'demo' | 'filename'
  record_count: number
  named_count: number
  created_at: string
}
// 通用人员资料：对全部图片生效；某次导入单独关联过资料时，那一次用自己的
export type SharedAssociation = {
  revision: number
  imported?: AssociationImport | null
}
export type Identity = {
  status: 'matched' | 'unrecognized' | 'conflict'
  name: string
  person_id?: string
  relationship?: string
  registered_relationship?: string
  plate_number?: string
  rfid_chip?: string
  captured_at?: string
  capture_id?: string
  address?: string
  department?: string
  phone?: string
  jurisdiction?: string
  source_vehicle_id?: string
  source_file?: string
  source_columns?: string[]
  source_record?: Record<string, unknown>
  method: 'none' | 'filename' | 'target' | 'demo'
  is_demo: boolean
  verified: boolean
  reason: string
}
export type AssociationSummary = {
  total: number
  matched: number
  exact: number
  demo: number
  unrecognized: number
  conflicts: number
  pending_images: number
  records: number
  named: number
}
export type AssociationState = {
  revision: number
  imported?: AssociationImport | null
  filename?: string
  mode?: 'demo' | 'filename'
  summary: AssociationSummary
  rows: EventRow[]
  preview: { id?: string; image_id: string; filename: string; vehicle_id?: string; position: number; identity: Identity }[]
  history?: (AssociationImport & { summary: AssociationSummary })[]
}
export type AnalyticsCounts = {
  uploaded: number
  processed: number
  done: number
  failed: number
  helmet: number
  no_helmet: number
  unknown: number
  scored: number
  correct: number
  people: number
  violations: number
  reviews: number
  clear: number
  matched: number
  unmatched: number
  demo: number
  failure_rate: number | null
  score_rate: number | null
  match_rate: number | null
}
export type WorkAnalytics = {
  batch_id: string | null
  span: number
  generated_at: string
  summary: AnalyticsCounts
  days: (AnalyticsCounts & { date: string })[]
}
export const modelName = 'Co-DETR v1 epoch 2'
export const statusName = {
  pending: '待识别',
  queued: '已排队',
  running: '识别中',
  done: '已完成',
  error: '识别失败',
}
export const outcomeName = {
  review: '待人工复核',
  violation: '确认违章',
  clear: '已排除',
}
export const canReview = (event: EventRow) => event.review_eligible ?? ((event.person_count ?? 0) >= 6)
export const eventStatus = (event: EventRow) => event.status
export const eventStatusName = (event: EventRow) => outcomeName[event.status]
export const predName = {
  helmet: '已戴盔',
  no_helmet: '未戴盔',
  unknown: '无法判断',
}
export const sourceName = (s?: string) =>
  s === 'model' ? '模型判定' : s === 'human' ? '人工复核' : '来源待查'
export const eventScope = (e: EventRow) =>
  e.scope === 'unresolved'
    ? '归属待核实'
    : e.scope === 'image'
      ? '整图事件'
      : e.vehicle_id
        ? '车辆组 ' + ((e.position ?? 0) + 1)
        : '整图事件'
export const imgUrl = (id: string) =>
  '/api/images/' + encodeURIComponent(id) + '/original'
export const pathId = (id: string) => encodeURIComponent(id)
export function go(page: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString()
  location.hash = '/' + page + (q ? '?' + q : '')
}
export function readRoute() {
  const [page, q] = location.hash.slice(1).replace(/^\//, '').split('?')
  return {
    // The work route is the task queue; legacy image links remain supported.
    // Records now sit below the overview charts: old #/records links open the overview with the same filters.
    page: page === 'work' || page === 'batches' ? page : 'overview',
    params: new URLSearchParams(q),
  }
}
export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch('/api' + path, { cache: 'no-store', ...opts })
  let body
  try {
    body = await r.json()
  } catch {
    throw new Error(
      '接口未返回有效数据（HTTP ' + r.status + '），请检查后台服务。'
    )
  }
  if (!r.ok)
    throw new Error(
      typeof body.error === 'string'
        ? body.error
        : typeof body.detail === 'string'
          ? body.detail
          : body.message || '请求失败（HTTP ' + r.status + '）'
    )
  return body
}
export function uploadBatch(
  form: FormData,
  onProgress: (fraction: number | null) => void
): Promise<Batch> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/batches')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) =>
      onProgress(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null)
    xhr.upload.onload = () => onProgress(1)
    xhr.onerror = () => reject(new Error('传输中断，请检查连接后重新上传。'))
    xhr.onload = () => {
      const result = xhr.response
      if (xhr.status >= 200 && xhr.status < 300 && result?.id) resolve(result)
      else
        reject(
          new Error(
            result?.error ||
              result?.detail ||
              '上传失败（HTTP ' + xhr.status + '）'
          )
        )
    }
    xhr.send(form)
  })
}
export const post = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})
export const message = (e: unknown) =>
  e instanceof Error ? e.message : '请求失败，请重试。'
export function useRemote<T>(
  key: string,
  fetcher: () => Promise<T>,
  interval = 0
) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: '' }
  )
  const [revision, setRevision] = useState(0)
  const latest = useRef(fetcher)
  latest.current = fetcher
  const refresh = useCallback(() => setRevision((n) => n + 1), [])
  useEffect(() => {
    if (!key) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const data = await latest.current()
        if (live) setState({ key, data })
      } catch (e) {
        if (live)
          setState((prev) => ({
            key,
            data: prev.key === key ? prev.data : undefined,
            error: message(e),
          }))
      } finally {
        if (live && interval) timer = setTimeout(load, interval)
      }
    }
    void load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key, revision, interval])
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    refresh,
  }
}
export const getIndex = async () => {
  const [batches, reviews, violations] = await Promise.all([
    api<Batch[]>('/batches'),
    api<EventRow[]>('/reviews'),
    api<EventRow[]>('/violations'),
  ])
  return { batches, reviews: reviews.filter(canReview).map(withDisplayCapture), violations: violations.map(withDisplayCapture) }
}
export type Index = Awaited<ReturnType<typeof getIndex>>
export type ModelInfo = {
  status: 'ready' | 'loading' | 'error' | 'offline'
  error?: string | null
  model_version?: string | null
  device?: string | null
}
export const getModel = () => api<ModelInfo>('/model')
export function labelInfo(label: string) {
  if (label === 'motorbike')
    return { name: '整车', group: 'vehicle', tone: 'blue' }
  const m = /^(D|P[012])(NoHelmet|Helmet)$/i.exec(label)
  if (!m) return { name: label, group: 'other', tone: 'blue' }
  const person = m[1] === 'D' ? '驾驶人' : '乘客 ' + m[1].toUpperCase()
  const missing = m[2].toLowerCase() === 'nohelmet'
  return {
    name: person + ' · ' + (missing ? '未戴盔' : '已戴盔'),
    group: 'rider',
    tone: missing ? 'orange' : 'mint',
  }
}
