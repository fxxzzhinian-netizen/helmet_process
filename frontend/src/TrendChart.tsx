import { useId, useRef, useState } from 'react'
import {
  CircleCheck, CircleX, ClipboardCheck, Cpu, Image as ImageIcon, Link2, LoaderCircle, UserRoundCheck,
  ScanLine, ShieldCheck, TriangleAlert, Upload, Users, type LucideIcon,
} from 'lucide-react'

export type TrendLine = { key: string; label: string; color: string; values: (number | null)[] }

const seriesIcons: Record<string, LucideIcon> = {
  model: Cpu, human: UserRoundCheck,
  processed: ImageIcon, done: CircleCheck, failed: CircleX, uploaded: Upload,
  violations: TriangleAlert, reviews: ClipboardCheck, clear: ShieldCheck,
  matched: Link2, people: Users, failure_rate: CircleX, score_rate: ScanLine, match_rate: Link2,
}

function SeriesIcon({ line }: { line: TrendLine }) {
  const Icon = seriesIcons[line.key] || ImageIcon
  return <Icon className="work-series-icon" size={13} style={{ color: line.color }} aria-hidden="true" />
}

function limits(values: number[], percent: boolean, target?: number): [number, number] {
  const seen = target == null ? values : [...values, target]
  if (percent) {
    if (!seen.length) return [0, 100]
    const low = Math.min(...seen), high = Math.max(...seen)
    return low >= 80 ? [80, 100] : low >= 60 ? [60, 100] : high <= 20 ? [0, 20] : high <= 40 ? [0, 40] : [0, 100]
  }
  const step = Math.max(...seen, 4) / 4
  const power = 10 ** Math.floor(Math.log10(step))
  return [0, [1, 2, 3, 4, 5, 10].map((value) => value * power).find((value) => value >= step)! * 4]
}

export function TrendChart({ title, subtitle, dates, lines, unit, percent = false, target, loading = false, compact = false, emptyText, onSelectDate }: {
  title: string; subtitle?: string; dates: string[]; lines: TrendLine[]; unit: string
  percent?: boolean; target?: number; loading?: boolean; compact?: boolean; emptyText?: string
  onSelectDate?: (date: string, visibleKeys: string[]) => void
}) {
  const heading = useId()
  const [hidden, setHidden] = useState<string[]>([])
  const [active, setActive] = useState<number>()
  const [focus, setFocus] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const visible = lines.filter((line) => !hidden.includes(line.key))
  const observed = visible.flatMap((line) => line.values.filter((value): value is number => value != null))
  const [low, high] = limits(observed, percent, target)
  const ticks = [4, 3, 2, 1, 0].map((index) => low + (high - low) * index / 4)
  const x = (index: number) => (index + .5) / dates.length * 100
  const y = (value: number) => 100 - (value - low) / (high - low) * 100
  const valueText = (value: number | null | undefined) => value == null ? '无样本' : value.toLocaleString('zh-CN') + (percent ? '%' : ' ' + unit)
  const columns = { gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }
  const labelCount = Math.min(dates.length, compact ? 4 : 7)
  const labels = new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (dates.length - 1) / Math.max(1, labelCount - 1))))
  const focused = Math.min(focus, dates.length - 1)
  const at = active != null && active < dates.length ? active : undefined
  return (
    <section className={'trend work-line-chart' + (compact ? ' compact' : '') + (dates.length > 14 ? ' dense' : '')} aria-labelledby={heading}>
      <div className="trend-head">
        <h2 id={heading}>{title}{subtitle && <small>{subtitle}</small>}</h2>
        {lines.length > 1 && <div className="work-chart-legend" role="group" aria-label={title + '显示数据'}>
          {lines.map((line) => <button key={line.key} type="button" aria-pressed={!hidden.includes(line.key)}
            disabled={visible.length === 1 && !hidden.includes(line.key)} onClick={() => setHidden((previous) => previous.includes(line.key) ? previous.filter((key) => key !== line.key) : [...previous, line.key])}>
            <SeriesIcon line={line} />{line.label}
          </button>)}
        </div>}
      </div>
      <div className="chart">
        <div className="chart-y num" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{tick}{percent ? '%' : ''}</span>)}</div>
        <div className="chart-plot" onPointerLeave={() => setActive(undefined)}>
          {onSelectDate && <div className="chart-grid" aria-hidden="true">{ticks.map(tick => <i key={tick} />)}</div>}
          {!loading && target != null && <div className="chart-target" style={{ top: y(target) + '%' }}><span>目标 {target}%</span></div>}
          {!loading && !emptyText && <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {visible.map((line) => {
              let drawing = '', pen = false
              line.values.forEach((value, index) => {
                if (value != null) drawing += (pen ? 'L' : 'M') + x(index) + ' ' + y(value) + ' '
                pen = value != null
              })
              return <path key={line.key} d={drawing} style={{ stroke: line.color }} />
            })}
          </svg>}
          <ol className="chart-days" style={columns} aria-label={title + '每日数据'}>
            {dates.map((date, index) => <li key={date} className={at === index ? 'active' : ''}>
              {!loading && !emptyText && visible.map((line) => {
                const value = line.values[index]
                return value != null && <i key={line.key} className="dot" aria-hidden="true"
                  style={{ top: y(value) + '%', borderColor: line.color, background: at === index ? line.color : '#fff' }} />
              })}
              <button ref={(element) => { buttons.current[index] = element }} type="button" className="work-chart-hit"
                tabIndex={index === focused ? 0 : -1}
                disabled={loading && !!onSelectDate}
                aria-label={date + '，' + (loading ? '正在读取' : visible.map((line) => line.label + '：' + valueText(line.values[index])).join('，')) + (onSelectDate ? '，查看当日记录' : '')}
                onPointerEnter={() => setActive(index)} onClick={() => { setActive(index); onSelectDate?.(date, visible.map(line => line.key)) }}
                onFocus={() => { setFocus(index); setActive(index) }} onBlur={() => setActive(undefined)}
                onKeyDown={(event) => {
                  const next = event.key === 'ArrowRight' ? Math.min(index + 1, dates.length - 1) : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? dates.length - 1 : undefined
                  if (next != null) { event.preventDefault(); setFocus(next); buttons.current[next]?.focus() }
                }} />
            </li>)}
          </ol>
          {(loading || emptyText) && <div className="work-chart-empty">{loading ? <><LoaderCircle size={17} className="spin" />正在读取统计</> : emptyText}</div>}
          {!loading && at != null && <div className="work-chart-tooltip num" style={{ left: `clamp(96px, ${x(at)}%, calc(100% - 96px))` }}>
            <small>{dates[at]}</small>
            {visible.map((line) => <div key={line.key}><SeriesIcon line={line} /><span>{line.label}</span><b>{valueText(line.values[at])}</b></div>)}
          </div>}
        </div>
        <div className="chart-x num" style={columns} aria-hidden="true">{dates.map((date, index) => <span key={date}>
          {labels.has(index) ? date.slice(5) : ''}
        </span>)}</div>
      </div>
    </section>
  )
}
