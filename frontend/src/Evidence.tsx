import { useEffect, useRef, useState, type PointerEvent } from 'react'
import {
  Aperture,
  AlertCircle,
  Bike,
  Eye,
  ImageOff,
  Layers,
  ZoomIn,
  ScanLine,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  imgUrl,
  labelInfo,
  modelName,
  predName,
  type Detail,
  type Detection,
  type EventRow,
} from './data'
import { Badge, Empty } from './ui'
import { ImageIdentities } from './Association'
import { inlineMagnifierGeometry, type MagnifierPoint } from './magnifier'
type Mode = 'all' | 'original' | 'vehicle' | 'rider'
const modes: { id: Mode; text: string; icon: LucideIcon }[] = [
  { id: 'original', text: '原图', icon: Eye },
  { id: 'vehicle', text: '整车框', icon: Bike },
  { id: 'rider', text: '骑乘人员框', icon: Users },
  { id: 'all', text: '全部框', icon: Layers },
]
const magnification = 3
const focusSteps: Record<string, [number, number]> = {
  ArrowLeft: [-.04, 0], ArrowRight: [.04, 0], ArrowUp: [0, -.04], ArrowDown: [0, .04],
}
function personName(d: Detection) {
  return d.role_uncertain ? '骑乘人员' : d.role === 'D' ? '驾驶人' : '乘客 ' + d.role
}
function decisionInfo(d: Detection) {
  const original = labelInfo(d.label)
  if (!d.role || !d.decision) return original
  const state = d.decision === 'unknown' ? '待确认' : predName[d.decision]
  return {
    name: personName(d) + ' · ' + state + (d.role_uncertain ? '（角色待确认）' : ''),
    group: 'rider',
    tone: d.decision === 'unknown' || d.role_uncertain ? 'amber' : d.decision === 'helmet' ? 'mint' : 'orange',
  }
}
function matchesFocus(d: Detection, only?: string[]) {
  return !only || only.includes(d.id) || Boolean(d.detection_ids?.some((id) => only.includes(id)))
}
function Frame({
  photo,
  mode,
  only,
  detections,
  raw,
  identities,
}: {
  photo: Detail
  mode: Mode
  only?: string[]
  detections: Detection[]
  raw: boolean
  identities: EventRow[]
}) {
  const [natural, setNatural] = useState<[number, number]>()
  const [failed, setFailed] = useState(false)
  const [focus, setFocus] = useState<MagnifierPoint>()
  const [hovering, setHovering] = useState(false)
  const [sizes, setSizes] = useState({ imageWidth: 0, imageHeight: 0, viewportWidth: 0, viewportHeight: 0, scrollLeft: 0, scrollTop: 0 })
  const planeRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<MagnifierPoint | undefined>(undefined)
  useEffect(() => {
    setFocus(undefined)
    setHovering(false)
    pointerRef.current = undefined
  }, [mode, photo.id, raw])
  function measure() {
    const plane = planeRef.current
    const stage = stageRef.current
    if (!plane || !stage) return
    const image = plane.getBoundingClientRect()
    setSizes({ imageWidth: image.width, imageHeight: image.height,
      viewportWidth: stage.clientWidth, viewportHeight: stage.clientHeight,
      scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop })
  }
  useEffect(() => {
    if (!natural || failed) return
    const plane = planeRef.current
    const stage = stageRef.current
    if (!plane || !stage) return
    const resize = () => {
      measure()
      if (pointerRef.current) updateFocus(pointerRef.current.x, pointerRef.current.y)
    }
    const dismiss = () => { setHovering(false); pointerRef.current = undefined }
    const observer = new ResizeObserver(resize)
    observer.observe(plane)
    observer.observe(stage)
    window.addEventListener('blur', dismiss)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('blur', dismiss)
    }
  }, [natural, failed])
  function updateFocus(x: number, y: number) {
    const image = planeRef.current?.getBoundingClientRect()
    if (!image?.width || !image.height) return
    setFocus({ x: Math.max(0, Math.min(1, (x - image.left) / image.width)),
      y: Math.max(0, Math.min(1, (y - image.top) / image.height)) })
  }
  function magnify(e: PointerEvent<HTMLDivElement>) {
    if (!natural || failed || e.pointerType === 'touch') return
    pointerRef.current = { x: e.clientX, y: e.clientY }
    setHovering(true)
    updateFocus(e.clientX, e.clientY)
  }
  const w = photo.width,
    h = photo.height
  const validSize = w > 0 && h > 0
  const aligned = natural && validSize && natural[0] === w && natural[1] === h
  const realBoxes = detections.filter(
    (d) =>
      matchesFocus(d, only) &&
      (mode === 'all' || mode === decisionInfo(d).group)
  )
  const candidates = detections.filter((d) => matchesFocus(d, only))
  const initialTarget = candidates.find((d) => d.role && d.decision === 'unknown')
    || candidates.find((d) => d.role) || candidates.find((d) => labelInfo(d.label).group === 'rider')
    || candidates[0]
  const initialPoint = aligned && initialTarget?.box.length === 4
    ? { x: (initialTarget.box[0] + initialTarget.box[2]) / (2 * w),
        y: (initialTarget.box[1] + (initialTarget.box[3] - initialTarget.box[1]) * .25) / h }
    : { x: .5, y: .5 }
  const magnifier = inlineMagnifierGeometry(sizes.imageWidth, sizes.imageHeight, sizes.viewportWidth, sizes.viewportHeight,
    sizes.scrollLeft, sizes.scrollTop, focus || initialPoint, magnification)
  function box(d: Detection) {
    const [x1, y1, x2, y2] = d.box || []
    if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1)
      return null
    const info = decisionInfo(d)
    const x = Math.max(0, Math.min(w, x1)),
      y = Math.max(0, Math.min(h, y1))
    const width = Math.min(x2, w) - x,
      height = Math.min(y2, h) - y
    if (width <= 0 || height <= 0) return null
    return (
      <div
        key={d.id}
        className={'bbox ' + info.tone}
        style={{
          left: (x / w) * 100 + '%',
          top: (y / h) * 100 + '%',
          width: (width / w) * 100 + '%',
          height: (height / h) * 100 + '%',
        }}
        title={raw
          ? info.name + ' · 原始模型分数 ' + Math.round(d.confidence * 100) + '%'
          : info.name + (d.reason ? '：' + d.reason : '')}
      >
        <span
          className={
            (y / h < 0.1 ? 'inside ' : '') + (x / w > 0.68 ? 'align-end' : '')
          }
        >
          {info.name}
        </span>
      </div>
    )
  }
  return (
    <div className={'evidence-workspace' + (identities.length ? '' : ' image-only')}>
      <div className="evidence-original">
      <div
        ref={stageRef}
        className="image-stage"
        tabIndex={0}
        aria-label="现场图片，可滚动查看，悬停或点击查看图内方形放大窗口，方向键移动放大区域"
        onScroll={() => {
          measure()
          if (pointerRef.current) updateFocus(pointerRef.current.x, pointerRef.current.y)
          else setHovering(false)
        }}
        onKeyDown={(event) => {
          const step = focusSteps[event.key]
          if (!step || !natural || failed) return
          event.preventDefault()
          const point = focus || initialPoint
          setFocus({ x: Math.max(0, Math.min(1, point.x + step[0])), y: Math.max(0, Math.min(1, point.y + step[1])) })
          setHovering(true)
        }}
        onBlur={() => setHovering(false)}
      >
        {failed ? (
          <Empty
            title="原图读取失败"
            icon={ImageOff}
            action={
              <button className="secondary" onClick={() => setFailed(false)}>
                重新读取
              </button>
            }
          />
        ) : (
          <div
            ref={planeRef}
            className={'image-plane' + (natural ? ' magnifiable' : '')}
            onPointerEnter={magnify}
            onPointerMove={magnify}
            onPointerDown={(event) => { if (natural && !failed) { updateFocus(event.clientX, event.clientY); setHovering(true) } }}
            onPointerLeave={(event) => { if (event.pointerType !== 'touch') setHovering(false); pointerRef.current = undefined }}
            onPointerCancel={() => { setHovering(false); pointerRef.current = undefined }}
            style={{ width: '100%' }}
          >
            <img
              src={imgUrl(photo.id)}
              alt={'现场原图：' + photo.filename}
              draggable={false}
              onError={() => setFailed(true)}
              onLoad={(e) =>
                setNatural([
                  e.currentTarget.naturalWidth,
                  e.currentTarget.naturalHeight,
                ])
              }
            />
            {aligned && mode !== 'original' && realBoxes.map((d) => box(d))}
            {magnifier && hovering && (
              <>
              <div className="magnifier-selection" aria-hidden="true" style={{
                left: magnifier.x, top: magnifier.y, width: magnifier.sourceWidth, height: magnifier.sourceHeight,
              }} />
              <div className="magnifier-inline" aria-hidden="true"
                style={{ left: magnifier.left, top: magnifier.top, width: magnifier.size, height: magnifier.size }}>
                <div className="magnifier-plane" style={{ width: magnifier.width, height: magnifier.height,
                  transform: `translate(${magnifier.translateX}px, ${magnifier.translateY}px)` }}>
                  <img src={imgUrl(photo.id)} alt="" draggable={false} />
                  {aligned && mode !== 'original' && realBoxes.map((d) => box(d))}
                </div>
                <span className="magnifier-badge">{magnification} 倍放大</span>
              </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="image-foot">
        <span>
          <Aperture size={14} />
          {validSize
            ? w + ' × ' + h + ' px'
            : natural
              ? natural.join(' × ') + ' px'
              : '原始分辨率'}
        </span>
        {!failed && (
          <span className="magnifier-hint">
            <ZoomIn size={14} />
            悬停或点击图内放大
          </span>
        )}
        <span>
          {mode === 'original'
            ? '原始画面'
            : !aligned && natural
              ? '缺少匹配的原图坐标'
              : realBoxes.length + (raw ? ' 个原始框' : ' 个显示框')}
        </span>
      </div>
      </div>
      {identities.length > 0 && <aside className="evidence-inspector" aria-label="违章关联人员">
        <ImageIdentities events={identities} />
      </aside>}
    </div>
  )
}
export function Evidence({
  photo,
  focusIds,
  showSummary = true,
  associated = false,
  showIdentities = true,
}: {
  photo: Detail
  focusIds?: string[]
  showSummary?: boolean
  associated?: boolean
  showIdentities?: boolean
}) {
  const [mode, setMode] = useState<Mode>('all')
  const [raw, setRaw] = useState(false)
  const [limit, setLimit] = useState(Boolean(focusIds?.length))
  const controls = (
    <div className="mode-switch" aria-label="证据图层">
      {modes.map((m) => (
        <button
          key={m.id}
          aria-pressed={mode === m.id}
          onClick={() => setMode(m.id)}
        >
          <m.icon size={15} />
          {m.text}
        </button>
      ))}
    </div>
  )
  const only = limit && focusIds?.length ? focusIds : undefined
  const analysis = photo.analysis
  const showRaw = raw || !analysis
  const displayed = showRaw ? photo.detections : analysis!.detections
  const people = (analysis?.subjects || []).filter((d) => d.role && matchesFocus(d, only))
  const det = (photo.detections || []).filter(
    (d) => matchesFocus(d, only)
  )
  const hasAssociation = associated || photo.events?.some((event) =>
    event.identity?.status === 'matched' || event.identity?.is_demo || event.identity?.source_file)
  const identities = showIdentities && hasAssociation ? (photo.events || []).filter((event) =>
    !only || event.detection_ids?.some((id) => only.includes(id))) : []
  return (
    <section className="evidence">
      <div className="evidence-top">
        {controls}
        {analysis && (
          <div className="mode-switch evidence-source" aria-label="判断来源">
            <button aria-pressed={!raw} onClick={() => setRaw(false)}>合并判断</button>
            <button aria-pressed={raw} onClick={() => setRaw(true)}>原始输出</button>
          </div>
        )}
      </div>
      {analysis && (
        <div className="consensus-summary" aria-label="合并判断结果">
          <span className="consensus-label">整图判断</span>
          <strong className={'consensus-verdict ' + analysis.prediction}>
            {analysis.prediction === 'no_helmet' ? '检出未戴盔'
              : analysis.prediction === 'helmet' ? '检出人员均戴盔'
                : analysis.person_count ? '戴盔状态待确认' : '未检出可判断人员'}
          </strong>
          <span className="consensus-count num">{analysis.vehicle_count} 辆车 · {analysis.person_count} 名人员</span>
          <span className="consensus-scope">{analysis.cross_view_merged ? '上下图已合并' : '按画面核对'}</span>
          {analysis.uncertain_count > 0 && <span className="consensus-pending"><AlertCircle size={14} />{analysis.uncertain_count} 人待确认</span>}
        </div>
      )}
      {showRaw && analysis ? (
        <p className="evidence-source-note">原始输出保留各画面的独立检测，可能包含同一人员的相反类别。</p>
      ) : people.length > 0 && (
        <div className="subject-results" aria-label="逐人判断">
          {people.map((d, index) => (
            <div className="subject-result" key={d.id} title={d.reason || undefined}>
              <span className="subject-number num">{String(index + 1).padStart(2, '0')}</span>
              <b>{personName(d)}</b>
              <span className={'subject-state ' + (d.decision || 'unknown')}>
                {d.decision === 'unknown' ? '待确认' : d.decision ? predName[d.decision] : '待确认'}
              </span>
              <small>{d.role_uncertain ? '角色待确认' : d.decision === 'unknown' ? '判断存在冲突'
                : d.agreement === 'agree' ? '上下图一致'
                  : d.agreement === 'top_only' ? '仅上图检出'
                    : d.agreement === 'bottom_only' ? '仅下图检出' : '单画面判断'}</small>
            </div>
          ))}
        </div>
      )}
      {focusIds?.length ? (
        <label className="check-inline focus-check">
          <input
            type="checkbox"
            checked={limit}
            onChange={(e) => setLimit(e.target.checked)}
          />
          仅看本事件关联检测框
        </label>
      ) : null}
      <Frame key={photo.id} photo={photo} mode={mode} only={only} detections={displayed || []} raw={showRaw} identities={identities} />
      {showSummary && <div className="readouts">
        <div>
          <small>模型图级结论</small>
          <Badge value={photo.status === 'done' ? analysis?.prediction || photo.prediction : null} />
        </div>
        <div>
          <small>独立人工标签</small>
          <b>{photo.truth ? predName[photo.truth] : '未提供'}</b>
        </div>
        <div>
          <small>识别模型</small>
          <b>{photo.model_version || modelName}</b>
        </div>
      </div>}
      {photo.error && (
        <p className="inline-error" role="alert">
          {photo.error}
        </p>
      )}
      {det.length > 0 && (
        <details className="detections">
          <summary>
            <ScanLine size={16} /> 原始检测明细（{det.length}）
          </summary>
          <div className="detection-list">
            {det.map((d) => (
              <div key={d.id}>
                <b>{labelInfo(d.label).name}</b>
                <span>
                  {Number.isFinite(d.confidence)
                    ? Math.round(d.confidence * 100) + '%'
                    : '—'}
                </span>
                <small>
                  {d.panel === 'top' ? '上图 · ' : d.panel === 'bottom' ? '下图 · ' : ''}
                  {d.label} · [{d.box.map((v) => Math.round(v)).join(', ')}]
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
