import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CalendarDays } from 'lucide-react'
import { go, type Index } from './data'
import { TrendChart, type TrendLine } from './TrendChart'
import { LocationPie } from './LocationPie'
import { daysEnding, daysBetween, parkTime, readRecordScope, scopeParams, summarizeOverview, todayInPark, type RecordScope } from './overviewAnalytics'

function Broadcast({ index }: { index?: Index }) {
  const [at, setAt] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const entries = useMemo(() => [...(index?.violations || []), ...(index?.reviews || [])]
    .sort((a, b) => (parkTime(b.updated_at)?.timestamp || 0) - (parkTime(a.updated_at)?.timestamp || 0)).slice(0, 8), [index])
  const row = entries[at % Math.max(entries.length, 1)]
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReduced(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (hovered || focused || reduced || entries.length < 2) return
    const timer = setInterval(() => { if (!document.hidden) setAt(value => (value + 1) % entries.length) }, 6000)
    return () => clearInterval(timer)
  }, [hovered, focused, reduced, entries.length])
  const stamp = row && parkTime(row.updated_at)
  const label = row?.status === 'review' ? '待人工复核' : row?.source === 'human' ? '人工确认违章' : '模型判定违章'
  // 纯文字播报：不设底色、边框和切换按钮；自动轮播，鼠标悬停或键盘聚焦时停住，点文字直达该事件
  return <div className="home-broadcast" aria-label="园区动态滚动播报"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <span className="home-broadcast-label">园区动态</span>
    {row ? <button key={row.id} className="home-broadcast-entry" onClick={() => go('records', { tab: row.status === 'review' ? 'reviews' : 'violations', event: row.id })}
      title={`${row.identity?.address || '地点待补充'} · ${label} · ${row.filename}`}>
      <time className="num" dateTime={row.updated_at}>{stamp ? stamp.day.slice(5) : ''}</time>
      <span>{row.identity?.address || '地点待补充'}</span><b>{label}</b>
    </button> : <span className="home-broadcast-placeholder">{index ? '暂无事件动态' : '正在读取园区动态…'}</span>}
  </div>
}

export function Overview({ index }: { index?: Index }) {
  const today = todayInPark()
  const [range, setRange] = useState(() => {
    const saved = readRecordScope(new URLSearchParams(location.hash.split('?')[1]))
    return saved.from && saved.to && daysBetween(saved.from, saved.to).length ? { from: saved.from, to: saved.to } : { from: daysEnding(today, 7)[0], to: today }
  })
  const [draft, setDraft] = useState(range)
  const validRange = daysBetween(draft.from, draft.to).length > 0
  const summary = useMemo(() => summarizeOverview(index?.violations || [], range.from, range.to), [index, range])
  const openRecords = (scope: RecordScope = {}, extra: Record<string, string> = {}) => go('records', { ...scopeParams({ ...range, ...scope }), return_from: range.from, return_to: range.to, ...extra })
  const lines: TrendLine[] = [
    { key: 'model', label: '模型判定', color: 'var(--green)', values: summary.model },
    { key: 'human', label: '人工确认', color: 'var(--home-human)', values: summary.human },
    ...(summary.other.some(Boolean) ? [{ key: 'other', label: '其他来源', color: 'var(--muted)', values: summary.other }] : []),
  ]
  const kpis = [
    { label: '违章记录', value: summary.selected.length, open: () => openRecords() },
    { label: '模型判定', value: summary.modelCount, open: () => openRecords({}, { source: 'model' }) },
    { label: '人工确认', value: summary.humanCount, open: () => openRecords({}, { source: 'human' }) },
    { label: '待人工复核', value: index?.reviews.length || 0, open: () => go('records', { tab: 'reviews' }) },
  ]
  const maxHour = Math.max(1, ...summary.hourly)
  const changeDate = (key: 'from' | 'to', value: string) => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    if (daysBetween(next.from, next.to).length) setRange(next)
  }
  return <div className="home-overview">
    <section className="hero home-hero" aria-labelledby="home-heading">
      <div className="hero-copy">
        <h1 id="home-heading">头盔识别与复核</h1>
        <p>从现场抓拍到违章记录，逐车核对骑乘人员的头盔佩戴情况。</p>
        <Broadcast index={index} />
      </div>
    </section>

    <section className="kpis home-kpis" aria-label="业务概况">{kpis.map(metric => <button className="kpi" key={metric.label} onClick={metric.open} disabled={!index}
      title={metric.label === '待人工复核' ? '查看全部待复核事件，不限抓拍日期' : '查看所选抓拍日期内的' + metric.label}>
      <span className="kpi-num num">{index ? metric.value : '—'}<small>条</small></span>
      <span className="kpi-label">{metric.label}</span>
    </button>)}</section>

    <div className="home-chart-toolbar">
      <div className="home-date-controls">
        <div className="home-presets" role="group" aria-label="统计日期范围">{[7, 14, 30].map(days => <button key={days}
          aria-pressed={range.to === today && range.from === daysEnding(today, days)[0]}
          onClick={() => { const next = { from: daysEnding(today, days)[0], to: today }; setRange(next); setDraft(next) }}>近{days}天</button>)}</div>
        <div className="home-date-inputs"><CalendarDays size={15} aria-hidden="true" /><input aria-label="统计开始日期" type="date" value={draft.from} onChange={event => changeDate('from', event.target.value)} /><span>至</span><input aria-label="统计结束日期" type="date" value={draft.to} onChange={event => changeDate('to', event.target.value)} /></div>
      </div>
    </div>
    {!validRange && <p className="home-date-error" role="alert">请选择有效的日期范围，最多 366 天。</p>}
    <div className="home-analysis-grid">
      <div className="home-trend-section">
        <TrendChart title="违章趋势" dates={summary.dates} lines={lines} unit="条" loading={!index}
          emptyText={index && !summary.selected.length ? '所选日期暂无违章记录' : undefined}
          onSelectDate={(date, sources) => openRecords({ from: date, to: date }, sources.length === 1 ? { source: sources[0] } : {})} />
      </div>
      <section className="home-location-section" aria-labelledby="home-location-heading">
        <div className="trend-head"><h2 id="home-location-heading">地点分布</h2><button className="link" onClick={() => openRecords()}>查看记录<ArrowUpRight size={14} /></button></div>
        <LocationPie locations={summary.locations} allAddresses={(index?.violations || []).map(row => row.identity?.address?.trim() || '').filter(Boolean)} loading={!index} />
      </section>
    </div>

    <section className="home-hours-section" aria-labelledby="home-hours-heading">
      <div className="trend-head"><h2 id="home-hours-heading">时段分布<small>条 / 小时</small></h2></div>
      <div className="home-hours-chart" aria-label="各小时违章记录分布">{summary.hourly.map((count, hour) => <button key={hour} className={'home-hour' + (count ? ' has-records' : '')}
        disabled={!index} onClick={() => openRecords({ hour })} aria-label={`${hour}:00 至 ${hour + 1}:00，${count} 条违章记录，查看名单`}>
        <span className="home-hour-value num">{index ? count : '—'}</span><span className="home-hour-track" aria-hidden="true"><i style={{ height: `${count / maxHour * 100}%` }} /></span><span className="home-hour-label num">{String(hour).padStart(2, '0')}<small>时</small></span>
      </button>)}</div>
    </section>
  </div>
}
