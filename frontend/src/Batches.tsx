import { Fragment, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock3,
  History,
  ListTodo,
  LoaderCircle,
  Search,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { statusName, type Batch, type Index } from './data'
import { Badge, Empty } from './ui'
import { Capsule } from './Capsule'
import { FilterSelect } from './FilterSelect'
import { createdDay, filterHistory, type HistoryOrder } from './batchHistory'

const clock = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})
const timeText = (iso?: string) => {
  const d = iso ? new Date(iso) : null
  return d && !isNaN(d.getTime()) ? clock.format(d) : '—'
}
const hourClock = new Intl.DateTimeFormat('zh-CN', {
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
})
// 批次里各状态的图片数量；未开始 = 总数减去其余四项
function counts(b?: Batch) {
  const total = b?.total ?? 0
  const failed = b?.failed ?? 0
  const done = b?.done ?? Math.max((b?.processed ?? 0) - failed, 0)
  const running = b?.running ?? 0
  const queued = b?.queued ?? 0
  return {
    total,
    done,
    failed,
    running,
    queued,
    idle: Math.max(total - done - failed - running - queued, 0),
    processed: b?.processed ?? done + failed,
  }
}
const scoreText = (s: Batch['score']) =>
  s && s.total ? Math.round((s.correct / s.total) * 1000) / 10 + '%' : ''

// 位置导航：前面几项是链接，最后一项是当前页
export function Crumbs({ trail }: { trail: [name: string, href?: string][] }) {
  return (
    <nav className="crumbs" aria-label="当前位置">
      {trail.map(([name, href], i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={14} aria-hidden="true" />}
          {href ? (
            <a href={href}>{name}</a>
          ) : (
            <span aria-current="page">{name}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

// 批次进度卡片：识别工作台（最近一批）和批次详情共用
export function BatchCard({
  label,
  batch,
  history = false,
  now,
  action,
  children,
}: {
  label: string
  batch?: Batch
  history?: boolean // 是否在操作区显示“历史批次”入口
  now?: string // 正在识别的图片文件名
  action?: ReactNode
  children?: ReactNode
}) {
  const c = counts(batch)
  // 向下取整：只有全部处理完才显示 100%
  const percent = c.total ? Math.floor((c.processed / c.total) * 100) : 0
  const score = scoreText(batch?.score)
  const facts: [tone: string, name: string, value: number, icon: LucideIcon][] = [
    ['done', '已完成', c.done, CircleCheck],
    ['failed', '失败', c.failed, CircleX],
    ['running', '识别中', c.running, LoaderCircle],
    ['queued', '排队中', c.queued, ListTodo],
    ['idle', '未开始', c.idle, Clock3],
  ]
  const handled = '已处理 ' + c.processed + ' / ' + c.total + ' 张'
  return (
    <section className="panel batch-card" aria-label={label}>
      {/* 左边是胶囊进度条：状态、已处理数量（识别中时是当前文件名）和百分比。换批次时重建，进度不从上一批滑过来 */}
      <Capsule
        key={batch?.id}
        value={batch ? percent : undefined}
        title={batch ? statusName[batch.status] : '正在读取'}
        subtitle={now ? '正在识别 ' + now : batch ? handled : '—'}
        label="批次处理进度"
        valueText={handled}
      />
      <div className="batch-side">
        <div className="batch-top">
          <div className="batch-title">
            <h2>{batch?.name || '正在读取…'}</h2>
            <p className="batch-meta num">
              创建于 {timeText(batch?.created_at)} · 共 {batch ? c.total : '—'} 张
            </p>
          </div>
          <div className="batch-actions">
            {history && (
              <a className="secondary" href="#/batches">
                <History size={16} />
                历史批次
              </a>
            )}
            {action}
          </div>
        </div>
        <div className="batch-bottom">
          <ul className="batch-facts">
            {facts.map(([tone, name, value, Icon]) => (
              <li key={tone} className={batch && value ? '' : 'zero'}>
                <Icon size={14} className={tone + (tone === 'running' && value ? ' spin' : '')} aria-hidden="true" />
                {name}
                <b className="num">{batch ? value : '—'}</b>
              </li>
            ))}
          </ul>
          <p className="batch-score num">
            图像识别率
            <b className={score ? '' : 'none'}>{score || '—'}</b>
            <small>
              {score
                ? '正确 ' + batch!.score!.correct + ' / ' + batch!.score!.total + ' 张'
                : '暂无可评分样本'}
            </small>
          </p>
        </div>
      </div>
      {score && (
        <p className="hint">
          分母仅含已完成且有独立标签的图片。无法判断计错，人工复核保留原模型得分。
        </p>
      )}
      {children}
    </section>
  )
}

const filters = [
  ['', '全部'],
  ['pending', statusName.pending],
  ['running', statusName.running],
  ['done', statusName.done],
  ['error', statusName.error],
]
// 历史批次页：按创建日期筛选、按实际创建时间排序，点一行进入批次详情。
export function Batches({
  index,
  error,
  retry,
  upload,
}: {
  index?: Index
  error?: string
  retry: () => void
  upload: () => void
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [order, setOrder] = useState<HistoryOrder>('newest')
  const SortIcon = order === 'newest' ? ArrowDownWideNarrow : ArrowUpWideNarrow
  const all = index?.batches
  const rows = filterHistory(all || [], { query, status, from, to, order })
  const invalidRange = !!(from && to && from > to)
  const filtered = !!(query || status || from || to)
  function clearFilters() {
    setQuery('')
    setStatus('')
    setFrom('')
    setTo('')
  }
  return (
    <>
      <div className="page-intro">
        <div>
          <Crumbs trail={[['识别工作台', '#/work'], ['历史批次']]} />
          <h1>历史批次</h1>
        </div>
        <button className="primary" onClick={upload}>
          <Upload size={17} />
          上传批次
        </button>
      </div>
      <section className="history">
        {!all ? (
          error ? (
            <Empty
              title="批次列表读取失败"
              body="请确认后台服务可用后重试。"
              icon={AlertCircle}
              action={
                <button className="secondary" onClick={retry}>
                  重试
                </button>
              }
            />
          ) : (
            <Empty title="正在读取批次" icon={LoaderCircle} />
          )
        ) : !all.length ? (
          <Empty
            title="还没有识别批次"
            body="选择现场原图即可开始，人工标签可稍后随新批次提供。"
            action={
              <button className="primary" onClick={upload}>
                <Upload size={16} />
                选择现场照片
              </button>
            }
          />
        ) : (
          <>
            <div className="history-tools">
              <label className="queue-search">
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="搜索批次名称"
                  placeholder="搜索批次名称"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="mode-switch" role="group" aria-label="按状态筛选">
                {filters.map(([value, name]) => (
                  <button
                    key={value}
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <FilterSelect
                className="history-sort"
                label="按创建时间排序"
                value={order}
                onChange={(value) => setOrder(value as HistoryOrder)}
                icon={SortIcon}
                options={[
                  { value: 'newest', label: '最新创建优先' },
                  { value: 'oldest', label: '最早创建优先' },
                ]}
              />
            </div>
            <div className="history-filters">
              <div className="history-date-filter">
                <span><CalendarDays size={15} aria-hidden="true" />创建时间</span>
                <div className="history-date-range" role="group" aria-label="创建日期范围">
                  <input
                    type="date"
                    aria-label="创建开始日期"
                    aria-invalid={invalidRange || undefined}
                    aria-describedby={invalidRange ? 'history-date-error' : undefined}
                    value={from}
                    max={to || '9999-12-31'}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                  <span aria-hidden="true">至</span>
                  <input
                    type="date"
                    aria-label="创建结束日期"
                    aria-invalid={invalidRange || undefined}
                    aria-describedby={invalidRange ? 'history-date-error' : undefined}
                    value={to}
                    min={from || undefined}
                    max="9999-12-31"
                    onChange={(event) => setTo(event.target.value)}
                  />
                </div>
              </div>
              {filtered && <button className="history-reset" onClick={clearFilters}>清除筛选</button>}
              <span className="history-count num" role="status">
                {rows.length === all.length
                  ? '共 ' + all.length + ' 批'
                  : rows.length + ' / ' + all.length + ' 批'}
              </span>
            </div>
            {invalidRange && (
              <p className="history-date-error" id="history-date-error" role="alert">
                开始日期不能晚于结束日期，请调整日期范围。
              </p>
            )}
            {rows.length ? (
              <div className="history-table" role="table" aria-label="历史批次">
                <div className="history-head" role="row">
                  <span role="columnheader">批次名称</span>
                  <span role="columnheader" className="head-time" aria-sort={order === 'newest' ? 'descending' : 'ascending'}>
                    <button
                      type="button"
                      className="history-sort-button"
                      aria-label={order === 'newest'
                        ? '创建时间：当前最新优先，点击切换为最早优先'
                        : '创建时间：当前最早优先，点击切换为最新优先'}
                      title={order === 'newest' ? '点击按创建时间从早到晚排列' : '点击按创建时间从晚到早排列'}
                      onClick={() => setOrder((current) => current === 'newest' ? 'oldest' : 'newest')}
                    >
                      创建时间 <SortIcon size={15} className="history-order-icon" aria-hidden="true" />
                    </button>
                  </span>
                  <span role="columnheader">识别进度</span>
                  <span role="columnheader" className="head-results">处理明细</span>
                  <span role="columnheader">状态</span>
                  <span role="columnheader">图像识别率</span>
                  <span role="columnheader" aria-label="进入" />
                </div>
                {rows.map((b) => {
                  const score = scoreText(b.score)
                  const day = createdDay(b.created_at)
                  const c = counts(b)
                  const details = [
                    { label: '成功', value: c.done, tone: 'done', title: '已成功完成识别的图片' },
                    { label: '失败', value: c.failed, tone: 'failed', title: '处理出错的图片，可进入批次重试' },
                    { label: '识别中', value: c.running, tone: 'running', title: '正在识别的图片' },
                    { label: '待处理', value: c.queued + c.idle, tone: 'idle', title: '排队中和未开始识别的图片' },
                  ]
                  return (
                    <div className="history-row" role="row" key={b.id}>
                      <span role="cell" className="cell-name">
                        {/* 链接的点击范围铺满整行（见 style.css） */}
                        <a
                          href={'#/work?batch=' + encodeURIComponent(b.id)}
                          title={b.name}
                        >
                          {b.name}
                        </a>
                        <small className="history-name-meta num">共 {b.total} 张图片</small>
                      </span>
                      <span role="cell" className="cell-time num">
                        {day ? (
                          <time dateTime={b.created_at}>
                            <span>{day.replaceAll('-', '/')}</span>
                            <small>{hourClock.format(new Date(b.created_at!))}</small>
                          </time>
                        ) : '—'}
                      </span>
                      <div role="cell" className="cell-progress num" aria-label={`已处理 ${c.processed} / ${c.total} 张`}>
                        <span className="history-progress">
                          <b>{c.processed}</b><span className="history-progress-slash">/</span>{c.total}
                        </span>
                      </div>
                      <div role="cell" className="cell-results num">
                        <dl className="history-results">
                          {details.map(({ label, value, tone, title }) => (
                            <div key={tone} className={value ? tone : 'zero'} title={title}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                      <span role="cell" className="cell-status">
                        <Badge value={b.status} />
                      </span>
                      <span role="cell" className="cell-score num" title="识别正确的图片 / 可评分图片，仅统计已完成且提供独立标签的图片">
                        {score ? (
                          <>
                            <b>{score}</b>
                            <small>
                              正确 {b.score!.correct} / {b.score!.total}
                            </small>
                          </>
                        ) : (
                          <span className="none" title="暂无可评分样本">
                            —
                          </span>
                        )}
                      </span>
                      <span role="cell" className="cell-go" aria-hidden="true">
                        <ChevronRight size={16} />
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty">
                <div>
                  <strong>没有符合条件的批次</strong>
                  <p>{invalidRange ? '请先修正上方的日期范围。' : '试试调整名称、状态或创建日期范围。'}</p>
                </div>
                <button
                  className="secondary"
                  onClick={clearFilters}
                >
                  清除筛选
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
