import { useEffect, useState } from 'react'
import { ArrowUpRight, CalendarDays, ChevronRight, Layers, LoaderCircle, Play, Upload } from 'lucide-react'
import { api, go, message, pathId, post, useRemote, type AnalyticsCounts, type Index } from './data'
import { BatchCard } from './Batches'
import { Empty, Fault } from './ui'
import { FilterSelect } from './FilterSelect'
import { TrendChart, type TrendLine } from './TrendChart'
import { getWorkAnalytics } from './workAnalytics'

const metrics: { key: keyof AnalyticsCounts; label: string; unit: string; percent?: boolean; help: string }[] = [
  { key: 'processed', label: '处理图片', unit: '张', help: '所选时段内已处理的图片，包含识别完成和识别失败。' },
  { key: 'violations', label: '确认违章', unit: '条', help: '所选时段内识别的目标，当前仍被确认为违章的事件数。' },
  { key: 'reviews', label: '待人工复核', unit: '条', help: '所选时段内识别的目标，目前仍待人工复核的事件数。' },
  { key: 'matched', label: '已关联目标', unit: '个', help: '已识别且关联到有姓名资料的目标数，含演示配对。' },
  { key: 'people', label: '检出骑乘人次', unit: '人次', help: '单张图片内去重、合并后的骑乘人数之和，同一人跨图片可能重复计入。' },
  { key: 'failure_rate', label: '识别失败率', unit: '%', percent: true, help: '识别失败张数 / 已处理图片张数。' },
  { key: 'score_rate', label: '图像识别率', unit: '%', percent: true, help: '判断正确张数 / 已完成且有人工标签的张数；无标签时不显示比率。' },
  { key: 'match_rate', label: '人员关联率', unit: '%', percent: true, help: '已关联目标数 / 已识别目标总数，含演示配对。' },
]

function calendar(span: number) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const end = Date.parse(today + 'T00:00:00Z')
  return Array.from({ length: span }, (_, index) => new Date(end - (span - index - 1) * 86400000).toISOString().slice(0, 10))
}

export function WorkDashboard({ index, params, upload, refresh }: {
  index?: Index; params: URLSearchParams; upload: () => void; refresh: () => void
}) {
  const scope = params.get('scope') || ''
  const span = [7, 14, 30].includes(Number(params.get('days'))) ? Number(params.get('days')) : 7
  const [pick, setPick] = useState<keyof AnalyticsCounts>('processed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const latest = index?.batches[0]
  const stats = useRemote(scope + ':' + span, () => getWorkAnalytics(scope, span, index), 4000)
  const data = stats.data
  const dates = data?.days.map((day) => day.date) || calendar(span)
  const selected = metrics.find((metric) => metric.key === pick)!
  const scopeName = scope ? index?.batches.find((batch) => batch.id === scope)?.name || '所选批次' : '全部批次'
  const running = latest?.status === 'running'
  const runnable = latest && ((latest.failed || 0) > 0 || latest.total > latest.processed + (latest.queued || 0) + (latest.running || 0))
  const signature = index?.batches.map((batch) => batch.id + ':' + batch.processed + ':' + batch.association?.revision).join('|')
  useEffect(() => { stats.refresh() }, [signature, stats.refresh])
  useEffect(() => { setError(''); setNotice('') }, [latest?.id])
  const changeScope = (batch: string, days: number) => go('work', { ...(batch ? { scope: batch } : {}), days: String(days) })
  const values = (key: keyof AnalyticsCounts) => data?.days.map((day) => day[key]) || dates.map(() => null)
  const line = (key: keyof AnalyticsCounts, label: string, color: string): TrendLine => ({ key, label, color, values: values(key) })
  const rangeEmpty = Boolean(data && !data.summary.uploaded && !data.summary.processed)

  async function run() {
    if (!latest || busy || running || !runnable) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api<{ accepted: number }>('/batches/' + pathId(latest.id) + '/run', post({ image_ids: [] }))
      setNotice(`已将 ${result.accepted} 张图片加入识别队列。`)
      refresh()
      stats.refresh()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="work-dashboard">
      <div className="page-intro">
        <div><h1>识别工作台</h1><p>查看识别进度，按批次分析图片处理、违章复核与人员关联趋势。</p></div>
        <button className="primary" onClick={upload}><Upload size={17} />上传批次</button>
      </div>
      {latest ? <BatchCard label="最近一批" batch={latest} history action={<>
        <a className="secondary" href={'#/work?batch=' + pathId(latest.id)}>批次详情<ChevronRight size={15} /></a>
        <button className="primary" disabled={!runnable || busy || running} onClick={run}>
          {busy || running ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}{running ? '正在识别' : '运行本批识别'}
        </button>
      </>}>
        {error && <Fault text={error} />}{notice && <span className="feedback" role="status">{notice}</span>}
      </BatchCard> : index && <div className="work-dashboard-empty"><Empty title="还没有识别批次" body="上传图片后即可开始识别，处理结果会自动汇总到下方趋势图。"
        action={<button className="secondary" onClick={upload}><Upload size={16} />选择现场照片</button>} /></div>}

      <section className="work-analysis" aria-label="识别数据分析">
        <div className="work-analysis-head">
          <div className="work-analysis-controls">
            <FilterSelect label="统计批次" value={scope} onChange={(value) => changeScope(value, span)} icon={Layers} className="work-batch-filter"
              options={[{ value: '', label: '全部批次' }, ...(index?.batches || []).map((batch) => ({ value: batch.id, label: batch.name }))]} />
            <div className="work-date-range" role="group" aria-label="统计日期范围"><CalendarDays size={15} aria-hidden="true" />
              {[7, 14, 30].map((days) => <button key={days} type="button" aria-pressed={span === days} onClick={() => changeScope(scope, days)}>近 {days} 天</button>)}
            </div>
          </div>
        </div>
        <div className="work-analysis-caption"><span title={scopeName}>{scopeName}</span><span className="num">{dates[0]} 至 {dates[dates.length - 1]}</span>
          <a className="link" href={scope ? '#/work?batch=' + pathId(scope) : '#/batches'}>{scope ? '查看批次详情' : '查看历史批次'}<ArrowUpRight size={13} /></a>
        </div>
        {stats.error && <Fault text={stats.error} retry={stats.refresh} />}
        <div className="kpis work-metrics" aria-label="识别统计维度">
          {metrics.map((metric) => {
            const value = data?.summary[metric.key]
            return <button key={metric.key} className="kpi" aria-pressed={pick === metric.key} onClick={() => setPick(metric.key)} title={metric.help}>
              <span className="kpi-num num">{value == null ? '—' : value.toLocaleString('zh-CN')}{metric.percent ? value != null && <small>%</small> : <small>{metric.unit}</small>}</span>
              <span className="kpi-label">{metric.label}</span>
            </button>
          })}
        </div>
        <TrendChart key={pick} title={selected.label + '趋势'} subtitle={'近 ' + span + ' 天'} dates={dates} lines={[line(pick, selected.label, '#105c49')]}
          unit={selected.unit} percent={selected.percent} target={pick === 'score_rate' ? 90 : undefined} loading={!data && !stats.error}
          emptyText={stats.error && !data ? '统计暂时不可用，请重试' : rangeEmpty ? '当前范围内暂无识别数据' : selected.percent && values(pick).every((value) => value == null) ? '当前范围内暂无可统计样本' : undefined} />
        <p className="work-metric-note">{selected.help}{pick === 'score_rate' && data && <span className="num">已评分 {data.summary.scored} 张，正确 {data.summary.correct} 张。</span>}</p>
        <div className="work-secondary-trends">
          <TrendChart title="图片处理结果" dates={dates} lines={[line('done', '识别完成', '#105c49'), line('failed', '识别失败', '#b9684c'), line('uploaded', '上传图片', '#879a8e')]}
            unit="张" compact loading={!data && !stats.error} emptyText={stats.error && !data ? '统计暂时不可用' : rangeEmpty ? '当前范围内暂无数据' : undefined} />
          <TrendChart title="事件判定分布" dates={dates} lines={[line('violations', '确认违章', '#b9684c'), line('reviews', '待人工复核', '#b28b3d'), line('clear', '已排除', '#4b8675')]}
            unit="条" compact loading={!data && !stats.error} emptyText={stats.error && !data ? '统计暂时不可用' : rangeEmpty ? '当前范围内暂无数据' : undefined} />
        </div>
        <div className="work-analysis-foot"><p>按北京时间统计。事件与人员关联按图片识别日期汇总当前状态。</p>
          {!!data?.summary.demo && <span className="num">含 {data.summary.demo} 个演示配对目标</span>}
        </div>
      </section>
    </div>
  )
}
