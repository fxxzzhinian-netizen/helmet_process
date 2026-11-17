import { useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Link2,
  Play,
  Search,
  Upload,
} from 'lucide-react'
import {
  api,
  go,
  message,
  pathId,
  post,
  useRemote,
  type Batch,
  type Detail,
  type Index,
} from './data'
import { Badge, Empty, Fault } from './ui'
import { Evidence } from './Evidence'
import { BatchCard, Crumbs } from './Batches'
import { AssociationDialog } from './Association'
import { BatchAssociationRecords } from './AssociationRecords'
import { WorkDashboard } from './WorkDashboard'

type WorkProps = { index?: Index; params: URLSearchParams; upload: () => void; refresh: () => void }

// 首页展示汇总与趋势，逐张原图、人员资料和台账集中在批次详情。
export function Work(props: WorkProps) {
  return props.params.get('batch') ? <BatchWork {...props} /> :
    <WorkDashboard index={props.index} params={props.params} upload={props.upload} refresh={props.refresh} />
}

function BatchWork({
  index,
  params,
  upload,
  refresh,
}: {
  index?: Index
  params: URLSearchParams
  upload: () => void
  refresh: () => void
}) {
  const detail = Boolean(params.get('batch'))
  const current = params.get('batch') || index?.batches[0]?.id || ''
  const requested = params.get('image') || ''
  const batch = useRemote(
    current,
    () => api<Batch>('/batches/' + pathId(current)),
    current ? 2500 : 0
  )
  const data = batch.data
  const photos = useMemo(() => data?.images || [], [data])
  const active = photos.find((i) => i.id === requested) || photos[0]
  const photo = useRemote(
    active ? active.id + '-' + active.status : '',
    () => api<Detail>('/images/' + pathId(active!.id)),
    5000
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [associating, setAssociating] = useState(false)
  // 手动展开或收起过的文件夹；没动过的按默认规则（见下方 folders）
  const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setBusy(false)
    setError('')
    setNotice('')
    setQuery('')
    setOpen({})
    setAssociating(false)
  }, [current])
  // 还有未开始或失败的图片时，才能运行整批识别
  const runnable = photos.some(
    (p) => p.status === 'pending' || p.status === 'error'
  )
  const visible = photos.filter((p) =>
    p.filename.toLowerCase().includes(query.trim().toLowerCase())
  )
  // 左栏的两个文件夹。已处理：识别完成或失败；待处理：未开始、排队中、识别中
  const processed = visible.filter(
    (p) => p.status === 'done' || p.status === 'error'
  )
  const folders = [
    { key: 'processed', name: '已处理', rows: processed },
    {
      key: 'waiting',
      name: '待处理',
      rows: visible.filter((p) => !processed.includes(p)),
    },
  ].map((f) => ({
    ...f,
    // 搜索时都展开；否则以手动操作为准，没动过的只展开当前图片所在的那个
    shown:
      Boolean(query.trim()) ||
      (open[f.key] ?? f.rows.some((p) => p.id === active?.id)),
  }))
  const running =
    data?.status === 'running' || photos.some((p) => p.status === 'running')
  async function run() {
    if (!current || busy || running) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ accepted?: number }>(
        '/batches/' + pathId(current) + '/run',
        post({ image_ids: [] })
      )
      setNotice(
        result.accepted === undefined
          ? '已提交识别。'
          : '本次已加入队列 ' + result.accepted + ' 张。'
      )
      batch.refresh()
      refresh()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  // 详情接口还没返回时，先用批次列表里的同一批数据填卡片
  const info = data || index?.batches.find((b) => b.id === current)
  const item = photo.data
  return (
    <>
      <div className="page-intro">
        {detail ? (
          <div>
            <Crumbs
              trail={[
                ['识别工作台', '#/work'],
                ['历史批次', '#/batches'],
                [info?.name || '批次详情'],
              ]}
            />
            <h1>批次详情</h1>
          </div>
        ) : (
          <div>
            <h1>识别工作台</h1>
            <p>运行最近一批的识别，按已处理和待处理逐张查看图片。</p>
          </div>
        )}
        <button className="primary" onClick={upload}>
          <Upload size={17} />
          上传批次
        </button>
      </div>
      {batch.error && <Fault text={batch.error} retry={batch.refresh} />}
      {!current ? (
        <section className="panel roomy">
          <Empty
            title={index ? '还没有识别批次' : '正在读取批次'}
            // 批次列表读完之前不出现“去上传”的引导，免得已有批次时闪一下
            body={index ? '选择现场原图即可开始，人工标签可稍后随新批次提供。' : undefined}
            action={
              index && (
                <button className="primary" onClick={upload}>
                  <Upload size={16} />
                  选择现场照片
                </button>
              )
            }
          />
        </section>
      ) : batch.error && !info ? (
        <section className="panel roomy">
          <Empty
            title="未能读取该批次"
            body="批次可能已不存在，可回到历史批次重新选择。"
            action={
              <a className="secondary" href="#/batches">
                返回历史批次
              </a>
            }
          />
        </section>
      ) : (
        <>
          <BatchCard
            label={detail ? '当前批次' : '最近一批'}
            batch={info}
            history={!detail}
            now={photos.find((p) => p.status === 'running')?.filename}
            action={
              <>
              <button className="secondary" disabled={!info} onClick={() => setAssociating(true)}>
                <Link2 size={16} />关联违章
              </button>
              <button
                className="primary"
                disabled={!runnable || busy || running}
                onClick={run}
              >
                {busy || running ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}{' '}
                {running ? '正在识别' : '运行整批识别'}
              </button>
              </>
            }
          >
            {info?.association && <div className="batch-association-state" role="status">
              <Link2 size={15} /><span>已关联人员资料 <b>{info.association.filename}</b></span>
              <span>{info.association.record_count} 条资料 · 版本 {info.association.revision}</span>
              <button className="link" onClick={() => document.getElementById('batch-associations')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>查看关联结果<ChevronRight size={14} /></button>
            </div>}
            {error && <Fault text={error} />}
            {notice && (
              <span className="feedback" role="status">
                {notice}
              </span>
            )}
          </BatchCard>
          <div className="work-grid">
            {/* 左栏不画卡片：顶部搜索栏，下面是“已处理”“待处理”两个文件夹 */}
            <section className="queue" aria-label="本批图片">
              <label className="queue-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="搜索图片文件名"
                  placeholder="搜索文件名"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="picture-list">
                {data ? (
                  folders.map((f) => (
                    <div className="folder" key={f.key}>
                      <button
                        className="folder-head"
                        aria-expanded={f.shown}
                        onClick={() => setOpen({ ...open, [f.key]: !f.shown })}
                      >
                        <ChevronRight className="folder-arrow" size={16} />
                        {f.shown ? (
                          <FolderOpen size={17} />
                        ) : (
                          <Folder size={17} />
                        )}
                        <b>{f.name}</b>
                        <span className="count num">{f.rows.length}</span>
                      </button>
                      {f.shown &&
                        (f.rows.length ? (
                          f.rows.map((p) => (
                            <div
                              key={p.id}
                              className={
                                'picture-row ' +
                                (p.id === active?.id ? 'active' : '')
                              }
                            >
                              <button
                                onClick={() =>
                                  // 工作台不带 batch 参数，始终跟着最近一批
                                  go(
                                    'work',
                                    detail
                                      ? { batch: current, image: p.id }
                                      : { image: p.id }
                                  )
                                }
                                aria-current={
                                  p.id === active?.id ? 'true' : undefined
                                }
                              >
                                <span>{p.filename}</span>
                                <Badge value={p.queued ? 'queued' : p.status} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="hint">
                            {query ? '没有匹配的文件' : '暂无图片'}
                          </p>
                        ))}
                    </div>
                  ))
                ) : (
                  <p className="hint">正在读取图片…</p>
                )}
              </div>
            </section>
            <section className="viewer" aria-label="原图与识别结果">
              {photo.error && (
                <Fault text={photo.error} retry={photo.refresh} />
              )}
              {item ? (
                <Evidence key={item.id} photo={item} showSummary={false} associated={Boolean(info?.association)} />
              ) : (
                !photo.error && (
                  <Empty title="正在读取原图信息" icon={ImageIcon} />
                )
              )}
            </section>
          </div>
          {info && <BatchAssociationRecords key={current} batch={info} onImport={() => setAssociating(true)} />}
          {associating && info && <AssociationDialog key={current} batch={info} close={() => setAssociating(false)} saved={(state) => {
            setAssociating(false)
            setNotice(`已保存关联：${state.summary.matched} 个目标已配对，${state.summary.unrecognized} 个未识别。`)
            batch.refresh()
            photo.refresh()
            refresh()
          }} />}
        </>
      )}
    </>
  )
}
