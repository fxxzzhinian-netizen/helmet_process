import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, Clock3, ClipboardCheck, ImageOff, Link2, ListTodo, LoaderCircle, Play, RefreshCw, Search, Upload, X } from 'lucide-react'
import { api, canReview, eventScope, go, imgUrl, message, pathId, post, useRemote, type Batch, type Detail, type EventRow, type Index } from './data'
import { Badge, Dialog, Empty, Fault } from './ui'
import { Evidence } from './Evidence'
import { AssociationDialog, IdentityFacts } from './Association'
import { EventDetail } from './Records'
import { FilterSelect } from './FilterSelect'
import { Capsule } from './Capsule'
import { normalizeTask, taskQueues, taskRows, initialQueue, filterTasks, imageQueue, taskRuns, taskTime, taskProgress, type TaskImage, type TaskQueue, type TaskRow } from './workTasks'

const labels: Record<TaskQueue, string> = { pending: '待处理', processing: '处理中', reviews: '待人工复核', done: '已完成', error: '处理异常' }

function TaskStatus({ queue, queued }: { queue: TaskQueue; queued?: boolean | number }) {
  return <span className={'task-status task-status-' + queue}><i aria-hidden="true" />{queue === 'processing' && queued ? '排队中' : labels[queue]}</span>
}

function TaskPhoto({ row, open }: { row: TaskRow; open: () => void }) {
  const [failed, setFailed] = useState(false)
  return <button className="task-photo" onClick={open} aria-label={'查看图片 ' + row.image.filename}>
    <span className="task-thumbnail">{failed ? <ImageOff size={21} aria-hidden="true" /> : <img src={imgUrl(row.image.id)} alt="" loading="lazy" onError={() => setFailed(true)} />}</span>
    <span className="task-photo-name"><b title={row.image.filename}>{row.image.filename}</b>{row.event && <small>{eventScope(row.event)}</small>}</span>
  </button>
}

function TaskImageDialog({ id, task, close, openEvent, associate, run, busy, refreshKey }: {
  id: string; task?: TaskImage; close: () => void; openEvent: (event: EventRow) => void
  associate: (batch: string, reload: () => void, filename: string) => void
  run: (images: TaskImage[]) => Promise<void>; busy: boolean; refreshKey: number
}) {
  const photo = useRemote('task-image:' + id, () => api<Detail>('/images/' + pathId(id)), 2500)
  useEffect(() => { photo.refresh() }, [refreshKey, photo.refresh])
  const raw = photo.data
  const item = raw ? normalizeTask({ ...raw, uploaded_at: task?.uploaded_at, events: raw.events || [] }) : task
  const queue = item ? imageQueue(item) : 'pending'
  return <Dialog title="现场证据" onClose={close} large className="task-image-dialog" locked={busy}>
    {photo.error && <Fault text={photo.error} retry={photo.refresh} />}
    {raw && item ? <>
      <div className="task-image-heading"><h3>{raw.filename}</h3><TaskStatus queue={queue} queued={raw.queued} /></div>
      <div className="task-image-grid">
        <div className="task-image-evidence"><Evidence key={raw.id} photo={{ ...raw, events: item.events }} showSummary={false} showIdentities={false} /></div>
        <aside className="task-image-aside">
          <div className="task-person-heading"><h3>关联资料</h3><button className="link" onClick={() => associate(raw.batch_id, photo.refresh, raw.filename)}><Link2 size={14} />关联资料</button></div>
          <IdentityFacts identity={item.identity} />
          {item.events.length > 0 && <section className="task-image-events"><h3>事件判定</h3>{item.events.map(event => <div key={event.id}>
            <span><b>{eventScope(event)}</b><Badge value={event.status} /></span>
            <button className="link" onClick={() => openEvent(event)}>{event.status === 'review' && canReview(event) ? '开始复核' : '查看事件'}<ChevronRight size={13} /></button>
          </div>)}</section>}
          {raw.error && <Fault text={raw.error} />}
        </aside>
      </div>
      <div className="dialog-foot">
        <button className="secondary" onClick={close} disabled={busy}>关闭</button>
        {(queue === 'pending' || queue === 'error') && <button className="primary" disabled={busy} onClick={() => run([item])}>
          {busy ? <LoaderCircle size={15} className="spin" /> : queue === 'error' ? <RefreshCw size={15} /> : <Play size={15} />}{queue === 'error' ? '重试处理' : '开始处理'}
        </button>}
      </div>
    </> : !photo.error && <Empty title="正在读取现场证据" />}
  </Dialog>
}

export function Work({ index, params, upload, refresh }: { index?: Index; params: URLSearchParams; upload: () => void; refresh: () => void }) {
  const tasks = useRemote('work-tasks', () => api<TaskImage[]>('/tasks').then(images => images.map(normalizeTask)), 2500)
  const images = useMemo(() => tasks.data || [], [tasks.data])
  const progress = taskProgress(images)
  const runningImage = images.find(image => image.status === 'running')
  const requestedQueue = params.get('queue')
  const queue: TaskQueue = taskQueues.some(item => item.id === requestedQueue) ? requestedQueue as TaskQueue : initialQueue(images)
  const activeImage = params.get('image') || ''
  const activeEvent = params.get('event') || ''
  const [query, setQuery] = useState('')
  const [identity, setIdentity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [selection, setSelection] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [association, setAssociation] = useState<{ batch: Batch; reload: () => void; filename: string }>()
  const [associationBusy, setAssociationBusy] = useState(false)
  const [associationError, setAssociationError] = useState('')
  const signature = index?.batches.map(batch => [batch.id, batch.processed, batch.running, batch.queued, batch.association?.revision].join(':')).join('|')
  useEffect(() => { tasks.refresh() }, [signature, tasks.refresh])
  useEffect(() => { setSelection([]); setPage(1) }, [queue, query, identity, from, to])
  const queues = useMemo(() => Object.fromEntries(taskQueues.map(item => [item.id, taskRows(images, item.id)])) as Record<TaskQueue, TaskRow[]>, [images])
  const rows = filterTasks(queues[queue], queue, query, from, to, queue === 'done' ? identity : '')
  const pageSize = 20, pages = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pages)
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const actionable = queue === 'pending' || queue === 'error'
  const runnable = rows.map(row => row.image).filter(image => taskRuns([image]).length)
  const selected = runnable.filter(image => selection.includes(image.id))
  const allChecked = visible.length > 0 && visible.every(row => selection.includes(row.image.id))
  const filtered = !!(query || queue === 'done' && (identity || from || to))
  const changeQueue = (next: TaskQueue) => { setQuery(''); setIdentity(''); setNotice(''); setError(''); go('work', { queue: next }) }
  const route = (extra: Record<string, string> = {}) => go('work', { queue, ...extra })
  const changed = () => { tasks.refresh(); refresh(); setRevision(value => value + 1) }
  const openEvent = (event: EventRow) => route({ ...(activeImage ? { image: activeImage } : {}), event: event.id })
  async function associate(batchId: string, reload: () => void, filename: string) {
    if (associationBusy) return
    setAssociationBusy(true)
    setAssociationError('')
    try {
      const batch = index?.batches.find(item => item.id === batchId) || await api<Batch>('/batches/' + pathId(batchId))
      setAssociation({ batch, reload, filename })
    } catch (cause) { setAssociationError(message(cause)) }
    finally { setAssociationBusy(false) }
  }
  async function run(selectedImages: TaskImage[]) {
    const groups = taskRuns(selectedImages)
    if (!groups.length || busy || tasks.error) return
    setBusy(true); setError(''); setNotice('')
    let accepted = 0
    const failures: string[] = []
    try {
      for (const group of groups) {
        try { const result = await api<{ accepted: number }>('/batches/' + pathId(group.batch) + '/run', post({ image_ids: group.ids })); accepted += result.accepted }
        catch (cause) { failures.push(message(cause)) }
      }
      setSelection([])
      if (accepted) { setQuery(''); route({ queue: 'processing' }); setNotice(`已提交 ${accepted} 张图片。`) }
      else if (!failures.length) setNotice('任务状态已更新，请查看当前队列。')
      if (failures.length) setError(failures.join('；'))
      changed()
    } finally { setBusy(false) }
  }
  return <div className="task-workbench">
    <div className="page-intro"><h1>识别工作台</h1></div>
    <section className="task-progress-band" aria-label="图片处理进度">
      <Capsule value={tasks.data ? progress.percent : undefined}
        title={!tasks.data ? '正在读取' : progress.running || progress.queued ? '正在处理' : progress.pending ? '待处理' : progress.failed ? '存在异常' : progress.total ? '已完成' : '等待上传'}
        subtitle={runningImage ? '正在处理 ' + runningImage.filename : `已处理 ${progress.handled} / ${progress.total} 张`}
        label="图片处理进度" valueText={`已处理 ${progress.handled} / ${progress.total} 张`} />
      <div className="task-progress-info"><h2>图片处理</h2><ul className="batch-facts">
        <li><CircleCheck size={14} aria-hidden="true" />已完成<b className="num">{tasks.data ? progress.done : '—'}</b></li>
        <li><CircleX size={14} aria-hidden="true" />异常<b className="num">{tasks.data ? progress.failed : '—'}</b></li>
        <li><LoaderCircle size={14} className={progress.running ? 'spin' : ''} aria-hidden="true" />处理中<b className="num">{tasks.data ? progress.running : '—'}</b></li>
        <li><ListTodo size={14} aria-hidden="true" />排队中<b className="num">{tasks.data ? progress.queued : '—'}</b></li>
        <li><Clock3 size={14} aria-hidden="true" />待处理<b className="num">{tasks.data ? progress.pending : '—'}</b></li>
      </ul></div>
      <button className="primary task-upload" onClick={upload}><Upload size={17} />上传图片</button>
    </section>
    <section className="kpis task-kpis" aria-label="任务状态">{taskQueues.map(item => <button className="kpi" key={item.id} aria-pressed={queue === item.id} onClick={() => changeQueue(item.id)}>
      <span className="kpi-num num">{tasks.data ? queues[item.id].length : '—'}<small>{item.unit}</small></span><span className="kpi-label">{item.label}</span>
    </button>)}</section>
    {tasks.error && <Fault text={tasks.error} retry={tasks.refresh} />}
    {error && <Fault text={error} retry={() => { setError(''); tasks.refresh() }} />}
    {notice && <p className="feedback task-notice" role="status">{notice}</p>}
    <div className="task-toolbar">
      <label className="queue-search task-search"><Search size={16} aria-hidden="true" /><input aria-label="搜索任务" placeholder="搜索文件名、人员、车牌或地点" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {queue === 'done' && <>
        <div className="task-date-filter"><input type="date" aria-label="历史开始日期" value={from} onChange={event => setFrom(event.target.value)} /><span>至</span><input type="date" aria-label="历史结束日期" value={to} onChange={event => setTo(event.target.value)} /></div>
        <FilterSelect label="人员关联状态" value={identity} onChange={setIdentity} options={[
          { value: '', label: '全部关联状态' }, { value: 'matched', label: '已关联人员' }, { value: 'unmatched', label: '待关联人员' },
        ]} />
      </>}
      {filtered && <button className="link" onClick={() => { setQuery(''); setIdentity(''); setFrom(''); setTo('') }}><X size={13} />重置</button>}
      <button className="icon-btn task-refresh" aria-label="刷新任务" onClick={tasks.refresh} disabled={busy}><RefreshCw size={15} /></button>
    </div>
    {queue === 'done' && from && to && from > to && <p className="record-date-error" role="alert">结束日期不能早于开始日期。</p>}
    <div className="task-list-head"><h2>{labels[queue]}<small className="num">{tasks.data ? rows.length : '—'} {queue === 'reviews' ? '条' : '张'}</small></h2>
      {actionable && <div className="task-list-actions">
        {selection.length > 0 && <span className="num">已选 {selected.length} 张</span>}
        <button className="secondary" disabled={!selected.length || busy || !!tasks.error} onClick={() => run(selected)}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{queue === 'error' ? '重试已选' : '处理已选'}</button>
        <button className="primary" disabled={!runnable.length || busy || !!tasks.error} onClick={() => run(runnable)}>{busy ? <LoaderCircle size={14} className="spin" /> : queue === 'error' ? <RefreshCw size={14} /> : <Play size={14} />}{queue === 'error' ? '重试全部' : '处理全部'}</button>
      </div>}
    </div>
    {rows.length ? <>
      <div className="task-table-scroll" role="region" aria-label={labels[queue] + '任务列表，可横向滚动'} tabIndex={0}><table className={'task-table' + (actionable ? ' task-table-selectable' : '')}><thead><tr>
        {actionable && <th className="task-check"><input type="checkbox" aria-label="选择本页全部图片" checked={allChecked} disabled={busy} onChange={event => setSelection(current => event.target.checked ? [...new Set([...current, ...visible.map(row => row.image.id)])] : current.filter(id => !visible.some(row => row.image.id === id)))} /></th>}
        <th>现场图片</th><th>抓拍时间</th><th>地点</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>{visible.map(row => {
        const person = row.event?.identity || row.image.identity
        const [day, clock] = taskTime(person?.captured_at)
        return <tr key={row.id}>
          {actionable && <td className="task-check"><input type="checkbox" aria-label={'选择图片 ' + row.image.filename} checked={selection.includes(row.image.id)} disabled={busy} onChange={event => setSelection(current => event.target.checked ? [...current, row.image.id] : current.filter(id => id !== row.image.id))} /></td>}
          <td><TaskPhoto row={row} open={() => route({ image: row.image.id })} /></td>
          <td className="num task-time"><span>{day}</span><small>{clock}</small></td>
          <td><span className="task-address" title={person?.address}>{person?.address || '—'}</span></td>
          <td><TaskStatus queue={queue} queued={row.image.queued} />{queue === 'error' && row.image.error && <span className="task-error-reason" title={row.image.error}>{row.image.error}</span>}</td>
          <td><div className="task-row-actions">{actionable ? <button className="link" disabled={busy || !!tasks.error} onClick={() => run([row.image])}>{queue === 'error' ? '重试处理' : '开始处理'}</button> : row.event ? <button className="link" onClick={() => openEvent(row.event!)}>开始复核</button> : <button className="link" onClick={() => route({ image: row.image.id })}>{queue === 'processing' ? '查看图片' : '查看结果'}</button>}
            {queue === 'done' && <button className="link" onClick={() => associate(row.image.batch_id, () => {}, row.image.filename)} disabled={associationBusy}>关联资料</button>}
          </div></td>
        </tr>
      })}</tbody></table></div>
      <div className="task-pagination"><span className="num">共 {rows.length} {queue === 'reviews' ? '条' : '张'}</span><div><span className="num">{currentPage} / {pages}</span><button className="icon-btn" aria-label="上一页任务" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={15} /></button><button className="icon-btn" aria-label="下一页任务" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={15} /></button></div></div>
    </> : <Empty icon={queue === 'reviews' ? ClipboardCheck : undefined} title={!tasks.data ? tasks.error ? '任务暂时不可用' : '正在读取任务' : filtered ? '没有匹配的任务' : `暂无${labels[queue]}任务`}
      action={tasks.data && !filtered && (queue === 'pending' ? <button className="secondary" onClick={upload}><Upload size={15} />上传图片</button> : queue === 'processing' && queues.done.length ? <button className="link" onClick={() => changeQueue('done')}>查看已完成</button> : undefined)} />}
    {associationError && <Fault text={associationError} />}
    {activeEvent ? <EventDetail key={activeEvent} id={activeEvent} close={() => route(activeImage ? { image: activeImage } : {})} changed={changed} taskContext
      onAssociate={(event, reload) => associate(event.batch_id, reload, event.filename)} /> : activeImage && <TaskImageDialog key={activeImage} id={activeImage} task={images.find(image => image.id === activeImage)} close={() => route()} openEvent={openEvent}
      associate={associate} run={run} busy={busy} refreshKey={revision} />}
    {association && <AssociationDialog batch={association.batch} taskFilename={association.filename} close={() => setAssociation(undefined)} saved={() => {
      association.reload(); setAssociation(undefined); changed(); setNotice('关联资料已更新。')
    }} />}
  </div>
}
