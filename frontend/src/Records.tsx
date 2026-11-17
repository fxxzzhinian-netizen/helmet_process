import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  CornerUpRight,
  FileImage,
  FileSearch,
  Filter,
  Layers,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  api,
  canReview,
  eventScope,
  eventStatus,
  go,
  message,
  modelName,
  outcomeName,
  pathId,
  post,
  predName,
  sourceName,
  useRemote,
  type Detail,
  type EventRow,
  type Index,
  type Outcome,
} from './data'
import { Badge, Dialog, Empty, Fault } from './ui'
import { Evidence } from './Evidence'
import { FilterSelect } from './FilterSelect'
import { AssociationTable, ExportAssociations } from './AssociationRecords'
import { IdentityName } from './Association'
import { withDisplayCapture } from './demoCapture'
import { captureTime, inRecordScope, readRecordScope, scopeParams, type RecordScope } from './overviewAnalytics'
type History = {
  revision: number
  previous_status: Outcome
  decision: Outcome
  note: string
  created_at: string
}
type Audit = EventRow & {
  history: History[]
  revision?: number
  model_status?: Outcome
  batch_name?: string
}
const time = (s?: string) =>
  s
    ? new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(s))
    : '—'
export function EventDetail({
  id,
  close,
  changed,
  taskContext = false,
  onAssociate,
}: {
  id: string
  close: () => void
  changed: () => void
  taskContext?: boolean
  onAssociate?: (row: EventRow, reload: () => void) => void
}) {
  const event = useRemote(id, () => api<Audit>('/events/' + pathId(id)).then(withDisplayCapture))
  const row = event.data
  const image = useRemote(row?.image_id || '', () =>
    api<Detail>('/images/' + pathId(row!.image_id))
  )
  const [decision, setDecision] = useState<'' | 'clear' | 'violation'>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [edit, setEdit] = useState(false)
  const group = image.data?.vehicles?.find((v) => v.id === row?.vehicle_id)
  const eligible = row ? canReview(row) : false
  const reviewing = eligible && (row?.status === 'review' || edit)
  const identity = taskContext && row?.identity?.reason === '尚未上传本批人员资料'
    ? { ...row.identity, reason: '尚未关联人员资料' } : row?.identity
  const personFields: { label: string; value?: string; wide?: boolean }[] = [
    { label: '车牌号', value: identity?.plate_number },
    { label: '手机号', value: identity?.phone },
    { label: '辖区 / 部门', value: [identity?.jurisdiction, identity?.department].filter(Boolean).join(' / ') },
    { label: '抓拍编号', value: identity?.capture_id },
    { label: '抓拍时间', value: identity?.captured_at, wide: true },
    { label: '芯片编号', value: identity?.rfid_chip, wide: true },
    { label: '抓拍地点', value: identity?.address, wide: true },
    { label: '园区车辆编号', value: identity?.source_vehicle_id, wide: true },
  ]
  async function save() {
    if (!row || !eligible || !decision || busy) return
    setBusy(true)
    setError('')
    try {
      await api(
        '/reviews/' + pathId(id),
        post({ decision, note, revision: row.revision })
      )
      setSaved('复核已保存 · ' + outcomeName[decision])
      setDecision('')
      setNote('')
      setEdit(false)
      event.refresh()
      changed()
    } catch (e) {
      setError(message(e))
      event.refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={row?.status === 'review' && eligible ? '人工复核' : '事件追溯'}
      large
      className="event-dialog"
      onClose={close}
      locked={busy}
    >
      {event.error && <div className="event-load-error"><Fault text={event.error} retry={event.refresh} /></div>}
      {row ? (
        <>
          <div className="event-dialog-body">
            <div className="event-heading">
              <div className="event-file-info">
                <div className="event-file-title"><FileImage size={18} aria-hidden="true" /><h3>{row.filename}</h3></div>
                <p className="event-file-meta">{!taskContext && <><span title={row.batch_name}>{row.batch_name || '来源批次'}</span><i aria-hidden="true" /></>}<span>{eventScope(row)}</span></p>
              </div>
              <Badge value={eventStatus(row)} />
            </div>
            <div className="audit-grid">
              <div className="audit-evidence">
                {image.error && <Fault text={image.error} retry={image.refresh} />}
                {image.data ? <Evidence key={image.data.id} photo={image.data}
                  focusIds={row.detection_ids || group?.detection_ids} showSummary={false} showIdentities={false} /> :
                  <Empty title="正在读取现场证据" icon={FileImage} />}
              </div>
              <aside className="audit-aside" aria-label="关联资料与事件判定">
                {reviewing && <section className="review-form audit-section">
                  <h3>人工结论</h3>
                  <div className="decision-options" role="group" aria-label="选择人工结论">
                    <button disabled={busy} aria-pressed={decision === 'violation'} onClick={() => setDecision('violation')}><ClipboardCheck size={16} />确认违章</button>
                    <button disabled={busy} aria-pressed={decision === 'clear'} onClick={() => setDecision('clear')}><ShieldCheck size={16} />排除违章</button>
                  </div>
                  <label htmlFor="note">复核说明 <small>选填</small></label>
                  <textarea id="note" value={note} maxLength={4000} disabled={busy} placeholder="填写核对依据或补充说明"
                    onChange={(e) => setNote(e.target.value)} />
                </section>}
                <section className="audit-section audit-person">
                  <div className="audit-section-heading"><h3>关联人员</h3>
                    {onAssociate && <button className="link" onClick={() => onAssociate(row, event.refresh)}>关联资料</button>}
                  </div>
                  <IdentityName identity={identity} />
                  {personFields.some((field) => field.value) && <dl className="audit-facts">
                    {personFields.filter((field) => field.value).map((field) => <div key={field.label} className={field.wide ? 'wide' : ''}>
                      <dt>{field.label}</dt><dd>{field.value}</dd>
                    </div>)}
                  </dl>}
                </section>
                <section className="audit-section audit-event-info">
                  <h3>事件信息</h3>
                  <dl className="audit-facts">
                    <div><dt>关联目标</dt><dd>{eventScope(row)}</dd></div>
                    <div><dt>结论来源</dt><dd>{sourceName(row.source)}</dd></div>
                    <div><dt>模型初判</dt><dd>{row.model_status === 'review' && !eligible ? '证据待确认' : row.model_status ? outcomeName[row.model_status] : '—'}</dd></div>
                    <div><dt>最近更新</dt><dd className="num">{time(row.updated_at)}</dd></div>
                    {row.source === 'human' && row.note && <div className="wide"><dt>复核说明</dt><dd className="audit-reason">{row.note}</dd></div>}
                    <div className="wide"><dt>事件编号</dt><dd className="audit-event-id num">{row.id}</dd></div>
                  </dl>
                  <button className="link audit-batch-link" onClick={() => go('work', { batch: row.batch_id, image: row.image_id })}>
                    {taskContext ? '查看图片任务' : '在批次中查看'}<CornerUpRight size={14} />
                  </button>
                </section>
                {row.history?.length > 0 && <details className="audit-log audit-section">
                  <summary>人工复核历史<span className="num">{row.history.length}</span></summary>
                  {row.history.map((item) => <div className="audit-history-entry" key={item.revision}>
                    <b>{outcomeName[item.previous_status]} → {outcomeName[item.decision]}</b>
                    <time className="num" dateTime={item.created_at}>{time(item.created_at)}</time>
                    {item.note && <p>{item.note}</p>}
                  </div>)}
                </details>}
                {image.data && <details className="audit-model-details audit-section">
                  <summary>识别模型与标签</summary>
                  <dl className="audit-facts">
                    <div className="wide"><dt>识别模型</dt><dd>{image.data.model_version || modelName}</dd></div>
                    <div><dt>模型图级结论</dt><dd>{image.data.prediction ? predName[image.data.prediction] : '—'}</dd></div>
                    <div><dt>独立人工标签</dt><dd>{image.data.truth ? predName[image.data.truth] : '未提供'}</dd></div>
                  </dl>
                </details>}
              </aside>
            </div>
          </div>
          <div className="event-dialog-footer">
            <div className="audit-footer-message">
              {error ? <Fault text={error} /> : saved ? <p className="feedback" role="status">{saved}</p> :
                <span>{!eligible ? `本图识别到 ${row.person_count ?? 0} 名骑乘人员，未达到 6 人复核条件。` : reviewing ? decision ? '将保存为：' + outcomeName[decision] : '核对现场证据后，选择人工结论。' : '可切换图层核对现场证据，或重新复核。'}</span>}
            </div>
            <div className="audit-footer-actions">
              {reviewing ? <>
                <button className="secondary" disabled={busy} onClick={() => edit ? setEdit(false) : close()}>{edit ? '取消修改' : '关闭'}</button>
                <button className="primary" disabled={!decision || busy || !image.data} onClick={save}><Check size={16} />{busy ? '正在保存' : '保存复核结论'}</button>
              </> : <>
                {eligible && <button className="secondary" onClick={() => { setEdit(true); setSaved(''); setNote(row.note || '') }}><ClipboardCheck size={15} />重新复核</button>}
                <button className="secondary" onClick={close}>关闭</button>
              </>}
            </div>
          </div>
        </>
      ) : (
        !event.error && <div className="event-dialog-loading"><Empty title="正在读取事件" icon={FileSearch} /></div>
      )}
    </Dialog>
  )
}
export function Records({
  index,
  params,
  refresh,
  syncError,
}: {
  index?: Index
  params: URLSearchParams
  refresh: () => void
  syncError?: string
}) {
  const reviews = params.get('tab') === 'reviews'
  const active = params.get('event')
  const [source, setSource] = useState(params.get('source') || '')
  // 从识别工作台跳来时地址里带 batch，作为批次筛选的初始值
  const [batch, setBatch] = useState(params.get('batch') || '')
  const [query, setQuery] = useState(params.get('q') || '')
  const [identity, setIdentity] = useState(params.get('identity') || '')
  const scope = readRecordScope(params)
  const scoped = Boolean(scope.from || scope.to || scope.address || scope.hour != null)
  const sourceParam = params.get('source') || ''
  const batchParam = params.get('batch') || ''
  const queryParam = params.get('q') || ''
  const identityParam = params.get('identity') || ''
  useEffect(() => setSource(sourceParam), [sourceParam])
  useEffect(() => setBatch(batchParam), [batchParam])
  useEffect(() => setQuery(queryParam), [queryParam])
  useEffect(() => setIdentity(identityParam), [identityParam])
  const origin = {
    ...(params.get('return_from') ? { return_from: params.get('return_from')! } : {}),
    ...(params.get('return_to') ? { return_to: params.get('return_to')! } : {}),
  }
  const routeParams = (extra: Record<string, string> = {}) => ({
    tab: reviews ? 'reviews' : 'violations', ...scopeParams(scope), ...origin,
    ...(source ? { source } : {}), ...(batch ? { batch } : {}),
    ...(query ? { q: query } : {}), ...(identity ? { identity } : {}), ...extra,
  })
  const changeScope = (next: RecordScope) => {
    const retained: Record<string, string> = routeParams()
    for (const key of ['from', 'to', 'address', 'hour']) delete retained[key]
    go('records', { ...retained, ...scopeParams(next) })
  }
  const base = (reviews ? index?.reviews : index?.violations) || []
  const rows = base.filter(
    (e) =>
      (!source || (source === 'other' ? e.source !== 'model' && e.source !== 'human' : source === e.source)) &&
      inRecordScope(e, scope) &&
      (!batch || batch === e.batch_id) &&
      (!identity || (identity === 'demo' ? e.identity?.method === 'demo' : identity === 'matched' ? e.identity?.status === 'matched' : e.identity?.status !== 'matched')) &&
      [e.filename, e.id, e.reason, e.vehicle_id, e.identity?.name, e.identity?.person_id, e.identity?.plate_number, e.identity?.rfid_chip, e.identity?.phone, e.identity?.address].some((t) =>
        t?.toLowerCase().includes(query.trim().toLowerCase())
      )
  ).sort((a, b) => (captureTime(b)?.timestamp || 0) - (captureTime(a)?.timestamp || 0))
  const filtered = Boolean(query || source || batch || identity || scoped)
  const open = (id: string) =>
    go('records', routeParams({ event: id }))
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>违章记录</h1>
          <p>按抓拍日期和判定来源查找事件，核对原图、模型初判与人工复核历史。</p>
        </div>
        <ExportAssociations rows={rows} title={reviews ? '待复核关联记录' : '违章关联记录'} disabled={!index || !!syncError} />
      </div>
      {(origin.return_from || origin.return_to) && <button className="link record-overview-back" onClick={() => go('overview', {
        ...(origin.return_from ? { from: origin.return_from } : {}), ...(origin.return_to ? { to: origin.return_to } : {}),
      })}>← 返回项目总览</button>}
      <section className="records-panel" aria-label="违章与复核记录">
        <div className="records-toolbar">
          <div className="records-tabs" role="group" aria-label="记录类型">
          {[
            {
              label: '违章记录',
              icon: Layers,
              n: index?.violations.length,
              isReview: false,
            },
            {
              label: '待人工复核',
              icon: ClipboardCheck,
              n: index?.reviews.length,
              isReview: true,
            },
          ].map((t) => (
            <button
              key={t.label}
              aria-pressed={reviews === t.isReview}
              onClick={() =>
                go('records', routeParams({ tab: t.isReview ? 'reviews' : 'violations' }))
              }
            >
              <t.icon size={17} />
              {t.label}
              <span>{t.n ?? '—'}</span>
            </button>
          ))}
          </div>
          <div className="records-toolbar-meta">
          <span className={'association-live' + (syncError ? ' disconnected' : '')}><i />{syncError ? '同步中断' : index ? '实时更新' : '正在读取'}</span>
          <span className="records-count num" role="status">
            {filtered ? '筛选到 ' : '共 '}{index ? rows.length : '—'} 条{reviews ? '待复核事件' : '违章记录'}
          </span>
          </div>
        </div>
        <div className="record-capture-scope" aria-label="抓拍日期与图表筛选条件">
          <span>抓拍日期</span>
          <input type="date" aria-label="记录开始日期" value={scope.from || ''} onChange={event => changeScope({ ...scope, from: event.target.value || undefined })} />
          <span>至</span>
          <input type="date" aria-label="记录结束日期" value={scope.to || ''} onChange={event => changeScope({ ...scope, to: event.target.value || undefined })} />
          {scope.address && <button className="record-scope-tag active" onClick={() => changeScope({ ...scope, address: undefined })} aria-label={'取消地点筛选：' + scope.address}><span>{scope.address}</span><X size={13} /></button>}
          {scope.hour != null && <button className="record-scope-tag active" onClick={() => changeScope({ ...scope, hour: undefined })} aria-label="取消时段筛选">{String(scope.hour).padStart(2, '0')}:00—{String(scope.hour + 1).padStart(2, '0')}:00<X size={13} /></button>}
          {scoped && <button className="link" onClick={() => changeScope({})}>清除日期与图表条件</button>}
        </div>
        {scope.from && scope.to && scope.from > scope.to && <p className="record-date-error" role="alert">结束日期不能早于开始日期。</p>}
        <div className="filters">
          <label className="queue-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜索记录"
              placeholder="搜索姓名、人员编号、车牌或文件名"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <FilterSelect
            label="判定来源"
            value={source}
            onChange={setSource}
            icon={Filter}
            options={[
              { value: '', label: '全部来源' },
              { value: 'model', label: '模型判定' },
              { value: 'human', label: '人工复核' },
              ...(source === 'other' || base.some(row => row.source !== 'human' && row.source !== 'model') ? [{ value: 'other', label: '其他来源' }] : []),
            ]}
          />
          <FilterSelect label="关联身份" value={identity} onChange={setIdentity} options={[
            { value: '', label: '全部身份' }, { value: 'matched', label: '已关联人员' },
            { value: 'unrecognized', label: '未识别' }, { value: 'demo', label: '演示配对' },
          ]} />
          <FilterSelect
            label="来源批次"
            value={batch}
            onChange={setBatch}
            className="record-batch-filter"
            options={[
              { value: '', label: '全部批次' },
              ...(index?.batches || []).map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          {filtered && (
            <button
              className="link records-reset"
              onClick={() => {
                setQuery('')
                setBatch('')
                setSource('')
                setIdentity('')
                go('records', { tab: reviews ? 'reviews' : 'violations', ...origin })
              }}
            >
              <X size={14} />
              重置
            </button>
          )}
        </div>
        {rows.length ? (
          <AssociationTable rows={rows} open={(row) => open(row.id)}
            resetKey={[reviews, query, source, batch, identity, JSON.stringify(scope)].join(':')} label={reviews ? '待复核关联记录' : '违章关联记录'} />
        ) : (
          <Empty
            icon={FileSearch}
            title={
              !index
                ? '正在读取记录'
                : filtered
                  ? '没有匹配的事件'
                  : reviews
                    ? '暂无待复核事件'
                    : '暂无违章记录'
            }
            body={
              filtered
                ? '调整筛选条件或搜索其他文件名。'
                : reviews
                    ? '单张图片识别到 6 名及以上骑乘人员时进入此清单。'
                  : '批次识别或人工复核确认违章后，可在这里查回证据。'
            }
            action={
              !filtered && (
                <button className="secondary" onClick={() => go('work')}>
                  进入识别工作台 <ArrowRight size={15} />
                </button>
              )
            }
          />
        )}
      </section>
      {active && (
        <EventDetail
          key={active}
          id={active}
          close={() =>
            go('records', routeParams())
          }
          changed={refresh}
        />
      )}
    </>
  )
}
