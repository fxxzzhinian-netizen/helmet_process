import { useState } from 'react'
import type { TaskImage } from './workTasks'

const categories = [
  { id: 'violation', label: '确认违章', color: '#bd775b' },
  { id: 'review', label: '待人工复核', color: '#b39753' },
  { id: 'clear', label: '已排除', color: '#347b65' },
] as const

export function TaskOutcomes({ images, loading }: { images: TaskImage[]; loading: boolean }) {
  const [hovered, setHovered] = useState<string>()
  const [picked, setPicked] = useState<string>()
  const counts = categories.map(category => ({ ...category, count: images.reduce((sum, image) => sum + image.events.filter(event => event.status === category.id).length, 0) }))
  const total = counts.reduce((sum, category) => sum + category.count, 0)
  let angle = Math.PI
  const point = (radius: number, theta: number) => `${90 + Math.cos(theta) * radius} ${90 + Math.sin(theta) * radius}`
  const slices = counts.filter(category => category.count > 0).map(category => {
    const sweep = category.count / total * Math.PI
    const gap = Math.min(.075, sweep / 6), corner = Math.min(5, sweep * 56 / 4)
    const a = angle + gap / 2, b = angle + sweep - gap / 2
    angle += sweep
    const start = point(76, a + corner / 76)
    const path = `M ${start} A 76 76 0 0 1 ${point(76, b - corner / 76)}
      Q ${point(76, b)} ${point(76 - corner, b)} L ${point(56 + corner, b)}
      Q ${point(56, b)} ${point(56, b - corner / 56)}
      A 56 56 0 0 0 ${point(56, a + corner / 56)}
      Q ${point(56, a)} ${point(56 + corner, a)} L ${point(76 - corner, a)}
      Q ${point(76, a)} ${start} Z`
    return { ...category, path, percent: (category.count / total * 100).toFixed(1).replace(/\.0$/, '') }
  })
  const activeId = hovered || picked
  const active = counts.find(category => category.id === activeId)
  const percent = active && total ? (active.count / total * 100).toFixed(1).replace(/\.0$/, '') + '%' : '0%'
  return <div className="task-outcomes" aria-label="事件判定统计" onPointerLeave={() => setHovered(undefined)}>
    <svg className="task-outcomes-chart" viewBox="0 0 180 104" role="group" aria-label="事件判定半圆图">
      {!total && <path d="M 24 90 A 66 66 0 0 1 156 90" fill="none" stroke="#e9efeb" strokeWidth="20" strokeLinecap="round" />}
      {slices.map(slice => <path key={slice.id} d={slice.path} fill={slice.color} tabIndex={0} role="button"
        className="task-outcomes-slice" style={{ opacity: activeId && activeId !== slice.id ? .48 : 1 }}
        aria-label={`${slice.label} ${slice.count} 条，占 ${slice.percent}%`} aria-pressed={picked === slice.id}
        onPointerEnter={() => setHovered(slice.id)} onFocus={() => setHovered(slice.id)} onBlur={() => setHovered(undefined)}
        onClick={() => setPicked(value => value === slice.id ? undefined : slice.id)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPicked(value => value === slice.id ? undefined : slice.id) } }}>
        <title>{slice.label} · {slice.count} 条 · {slice.percent}%</title>
      </path>)}
      <text x="90" y="73" textAnchor="middle" className="task-outcomes-value num" aria-hidden="true">{loading ? '—' : active ? active.count : total}<tspan> 条</tspan></text>
      <text x="90" y="94" textAnchor="middle" className="task-outcomes-label" aria-hidden="true">{active ? active.label + ' · ' + percent : '判定结果'}</text>
    </svg>
  </div>
}
