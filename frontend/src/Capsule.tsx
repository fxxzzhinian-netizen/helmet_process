import { useEffect, useRef, type CSSProperties } from 'react'
import { createFluidProgress } from './vendor/luoban25-fluid-progress/fluid-progress.js'

// 流体渲染来自 luoban25.github.io 的 Fluid Progress（见 vendor/luoban25-fluid-progress）。
// 配色是原项目的 Mint Jade 主题：未填充部分近黑，已填充部分墨绿，浪头后面由深翠到薄荷绿，边界是黄绿色亮线
const THEME = {
  baseColor: '#121716',
  fillColor: '#152521',
  deepColor: '#1f5c49',
  midColor: '#21b882',
  brightColor: '#73ffd1',
  foamColor: '#e1fff2',
  rimColor: '#c3ff84',
}
// 浪头停靠处离左端、右端的像素数：0% 时已经往前探出一截；
// 100% 时是负数，浪头走到右端之外（起伏幅度约 18 像素，亮线完全看不到），里面只剩它后面的波纹
const START = 30
const END = -28

// 进度条：左边标题与副标题，右边百分比，进度边界是一道会晃动的浪头
export function Capsule({
  value,
  title,
  subtitle,
  label,
  valueText,
}: {
  value?: number // 0–100；还在读取时不传
  title: string
  subtitle: string
  label: string // 读屏用的名称
  valueText: string // 读屏用的进度描述
}) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const goal = useRef(0)
  goal.current = value ?? 0
  useEffect(() => {
    const el = stage.current!
    const flow = createFluidProgress(canvas.current!, THEME)
    if (!flow) return // 浏览器不支持 WebGL：保留样式表画的静态进度
    el.classList.add('live')
    const calm = matchMedia('(prefers-reduced-motion: reduce)')
    let low = 0 // START、END 折算成的进度范围
    let high = 1
    let last = performance.now()
    const resize = () => {
      const r = el.getBoundingClientRect()
      const width = Math.max(START, r.width)
      low = START / width
      high = 1 - END / width
      flow.resize(r.width, r.height)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()
    // 浪头从最左边起步，由弹簧带到当前进度；进度变化时会略微冲过头再回摆
    const draw = (now: number) => {
      const target = Math.min(Math.max(goal.current / 100, low), high)
      flow.frame((now - last) / 1000, target, calm.matches)
      last = now
    }
    draw(last) // 先画一帧，画布不会在第一帧之前露出空白
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick)
      draw(now)
    })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      flow.dispose()
      el.classList.remove('live')
    }
  }, [])
  return (
    <div
      ref={stage}
      className="capsule"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? 0}
      aria-valuetext={valueText}
      style={{ '--progress': value ?? 0 } as CSSProperties}
    >
      <canvas ref={canvas} aria-hidden="true" />
      <span className="capsule-copy">
        <b>{title}</b>
        <small>{subtitle}</small>
      </span>
      <span className="capsule-value num" aria-hidden="true">
        {value == null ? '—' : value + '%'}
      </span>
    </div>
  )
}
