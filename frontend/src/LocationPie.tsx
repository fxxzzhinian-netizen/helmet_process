import { useState } from 'react'
import { MapPin } from 'lucide-react'

const palette = ['#347b65', '#c49b53', '#678ba6', '#a17c9d', '#bd7d6b', '#8d9e62', '#649c9c', '#8a89b5']

export function locationSlices(locations: [string, number][], allAddresses: string[]) {
  const addresses = [...new Set(allAddresses)].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const total = locations.reduce((n, [, count]) => n + count, 0)
  let angle = -Math.PI / 2
  return locations.filter(([, count]) => count > 0).map(([address, count]) => {
    const start = angle, sweep = count / total * Math.PI * 2
    angle += sweep
    const point = (radius: number, theta: number) => `${100 + Math.cos(theta) * radius} ${100 + Math.sin(theta) * radius}`
    const gap = Math.min(.045, sweep / 8), corner = Math.min(5, sweep * 52 / 4)
    const a = start + gap / 2, b = angle - gap / 2
    const outerStart = point(84, a + corner / 84), outerEnd = point(84, b - corner / 84)
    const path = count === total
      ? 'M 100 16 A 84 84 0 1 1 100 184 A 84 84 0 1 1 100 16 Z M 100 48 A 52 52 0 1 1 100 152 A 52 52 0 1 1 100 48 Z'
      : `M ${outerStart} A 84 84 0 ${b - a - 2 * corner / 84 > Math.PI ? 1 : 0} 1 ${outerEnd}
          Q ${point(84, b)} ${point(84 - corner, b)} L ${point(52 + corner, b)}
          Q ${point(52, b)} ${point(52, b - corner / 52)}
          A 52 52 0 ${b - a - 2 * corner / 52 > Math.PI ? 1 : 0} 0 ${point(52, a + corner / 52)}
          Q ${point(52, a)} ${point(52 + corner, a)} L ${point(84 - corner, a)}
          Q ${point(84, a)} ${outerStart} Z`
    const colorIndex = Math.max(0, addresses.indexOf(address))
    return {
      address, count, path,
      color: palette[colorIndex] || `hsl(${colorIndex * 137.508 % 360} 35% 53%)`,
      percent: (count / total * 100).toFixed(1).replace(/\.0$/, ''),
      dx: Math.cos(start + sweep / 2) * 5, dy: Math.sin(start + sweep / 2) * 5,
    }
  })
}

export function LocationPie({ locations, allAddresses, loading }: {
  locations: [string, number][]; allAddresses: string[]; loading: boolean
}) {
  const [picked, setPicked] = useState<string>()
  const [hovered, setHovered] = useState<string>()
  const slices = locationSlices(locations, allAddresses)
  const activeAddress = hovered || picked
  const active = slices.find(slice => slice.address === activeAddress)
  const total = slices.reduce((n, slice) => n + slice.count, 0)
  if (!slices.length) return <div className="home-analysis-empty"><MapPin size={23} /><span>{loading ? '正在读取地点分布' : '暂无地点记录'}</span></div>
  return <div className="home-location-pie" onPointerLeave={() => setHovered(undefined)}>
    <div className="home-pie-body">
      <svg className="home-pie-chart" viewBox="0 0 200 200" role="group" aria-label="各地点违章记录占比">
        {slices.map(slice => {
          const selected = slice.address === activeAddress
          return <path key={slice.address} d={slice.path} fill={slice.color} fillRule="evenodd" role="button" tabIndex={0}
            className={'home-pie-slice' + (selected ? ' active' : '')}
            style={{ transform: selected ? `translate(${slice.dx}px, ${slice.dy}px)` : undefined, opacity: activeAddress && !selected ? .72 : 1 }}
            aria-label={`${slice.address}，${slice.count} 条，占 ${slice.percent}%，点按查看详情`} aria-pressed={picked === slice.address}
            onPointerEnter={() => setHovered(slice.address)} onClick={() => setPicked(value => value === slice.address ? undefined : slice.address)}
            onFocus={() => setHovered(slice.address)} onBlur={() => setHovered(undefined)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPicked(slice.address) } }}>
            <title>{slice.address} · {slice.count} 条 · {slice.percent}%</title>
          </path>
        })}
        <text className="home-pie-center-value num" x="100" y="99" textAnchor="middle" aria-hidden="true">{active ? active.count : total}<tspan className="home-pie-center-unit"> 条</tspan></text>
        <text className="home-pie-center-label" x="100" y="120" textAnchor="middle" aria-hidden="true">{active ? active.percent + '%' : '违章记录'}</text>
      </svg>
    </div>
    {active && <div className="home-pie-feedback" aria-live="polite" aria-atomic="true">
      <span className="home-pie-feedback-name" title={active.address}><i style={{ background: active.color }} aria-hidden="true" /><span>{active.address}</span></span>
      <span className="home-pie-feedback-value num">{active.count}<small>条</small><b>{active.percent}%</b></span>
    </div>}
  </div>
}
