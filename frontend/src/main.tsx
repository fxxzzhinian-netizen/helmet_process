import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ChevronUp,
  Cpu,
  LayoutDashboard,
  ScanLine,
  UserRound,
} from 'lucide-react'
import {
  getIndex,
  getModel,
  go,
  modelName,
  readRoute,
  useRemote,
} from './data'
import { Fault } from './ui'
import { Overview } from './Overview'
import { Work } from './Work'
import { Batches } from './Batches'
import { UploadDialog } from './Upload'
import './style.css'
const pages = [
  { id: 'overview', name: '项目总览', icon: LayoutDashboard },
  { id: 'work', name: '识别工作台', icon: ScanLine },
]
// 没有悬停能力的屏幕（触屏）且侧栏处于图标导轨形态；宽度与 style.css 的断点一致
const tapRail = window.matchMedia('(hover: none) and (min-width: 651px)')
// 目前没有登录功能，账号固定为管理员
const accountName = '管理员'
// 模型服务状态 → 文案；状态名同时是圆点的配色类
const serviceState: Record<string, string> = {
  ready: '运行中',
  loading: '加载中',
  error: '异常',
  offline: '未连接',
}
// 账号信息在侧栏底部直接展开，不单独弹出卡片。
function Account() {
  const [show, setShow] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const model = useRemote('model', getModel, 10000)
  useEffect(() => {
    if (!show) return
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setShow(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [show])
  // 接口请求本身失败也按未连接显示；第一次结果回来之前显示“检查中”
  const status = model.error ? 'offline' : model.data?.status
  const tone = status ? (serviceState[status] ? status : 'offline') : ''
  const text = status ? serviceState[tone] : '检查中'
  const reason =
    model.error ||
    (status === 'error' || status === 'offline' ? model.data?.error : null)
  const who = (
    <span className="account-name">
      <span>{accountName}</span>
      <small>默认账号</small>
    </span>
  )
  return (
    <div
      ref={box}
      className={'account' + (show ? ' show' : '')}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setShow(true)}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && !e.currentTarget.querySelector(':focus-visible')) {
          setShow(false)
        }
      }}
      onFocus={(e) => e.target.matches(':focus-visible') && setShow(true)}
      onBlur={() => !box.current?.matches(':hover') && setShow(false)}
    >
      <button
        type="button"
        aria-label={'账号：' + accountName}
        aria-expanded={show}
        aria-controls="account-info"
        // 鼠标点击不抢焦点，否则之后按任意键会被当成键盘聚焦，侧栏和卡片又弹出来
        onMouseDown={(e) => e.preventDefault()}
        // 鼠标靠悬停开合；这里只处理触屏点按和键盘回车
        onClick={(e) =>
          (e.nativeEvent as PointerEvent).pointerType !== 'mouse' &&
          setShow(!show)
        }
      >
        <UserRound size={19} className="account-icon" aria-hidden="true" />
        {who}
        <ChevronUp size={14} className="account-toggle" aria-hidden="true" />
      </button>
      <div className="account-info" id="account-info" hidden={!show}>
        {/* 两行只展示信息，不可点击 */}
        <dl>
          <div>
            <dt>
              <Cpu size={14} aria-hidden="true" />
              识别模型
            </dt>
            <dd>{model.data?.model_version || modelName}</dd>
          </div>
          <div>
            <dt>
              <Activity size={14} aria-hidden="true" />
              模型服务
            </dt>
            <dd>
              <span className={'service ' + tone}>
                <i />
                {text}
              </span>
            </dd>
            {reason && (
              <dd className="account-note" title={reason}>
                {reason}
              </dd>
            )}
          </div>
        </dl>
      </div>
    </div>
  )
}
function App() {
  const [route, setRoute] = useState(readRoute)
  const [upload, setUpload] = useState(false)
  const [open, setOpen] = useState(false)
  const side = useRef<HTMLElement>(null)
  const index = useRemote('index', getIndex, 2000)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (!side.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])
  useEffect(() => {
    const change = () => {
      setRoute(readRoute())
      setUpload(false)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  // 历史批次和批次详情没有自己的导航项，侧栏高亮“识别工作台”
  const section = route.page === 'batches' ? 'work' : route.page
  const title =
    route.page === 'batches'
      ? '历史批次'
      : pages.find((p) => p.id === route.page)!.name
  useEffect(() => {
    document.title = title + ' · 园区骑行治理'
    window.scrollTo(0, 0)
  }, [title])
  return (
    <div className="shell">
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        跳至主要内容
      </a>
      <aside
        ref={side}
        className={'sidebar' + (open ? ' open' : '')}
        onClickCapture={(e) => {
          // 鼠标悬停与键盘聚焦的展开由 CSS 负责，这里只处理指针点击。detail 为 0 是键盘触发
          if (e.detail === 0) return
          const target = e.target as HTMLElement
          // 点过的链接不保留焦点，否则之后按任意键会被当成键盘聚焦，侧栏又弹出来
          target.closest('a')?.blur()
          // 触屏：第一下只展开导轨（不跳转），展开后点链接才跳转并收起。
          // 账号入口不是跳转，点按照常生效（展开导轨的同时显示账号信息）
          if (!tapRail.matches) return
          if (!open) {
            setOpen(true)
            if (!target.closest('.account')) {
              e.preventDefault()
              e.stopPropagation()
            }
          } else if (target.closest('a')) setOpen(false)
        }}
      >
        <a href="#/overview" className="brand">
          <img src="/logo.png" alt="" width="42" height="42" />
          <span>
            <b>园区骑行治理</b>
            <small>非机动车管理平台</small>
          </span>
        </a>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <a
              key={p.id}
              href={'#/' + p.id}
              aria-current={p.id === section ? 'page' : undefined}
              aria-label={p.name}
            >
              <p.icon size={19} aria-hidden="true" />
              <span className="nav-label">{p.name}</span>
            </a>
          ))}
        </nav>
        <Account />
      </aside>
      <div className="content">
        <main id="main" tabIndex={-1}>
          {index.error && <Fault text={index.error} retry={index.refresh} />}
          {route.page === 'work' ? (
            <Work
              index={index.data}
              params={route.params}
              upload={() => setUpload(true)}
              refresh={index.refresh}
            />
          ) : route.page === 'batches' ? (
            <Batches
              index={index.data}
              error={index.error}
              retry={index.refresh}
              upload={() => setUpload(true)}
            />
          ) : (
            // 违章记录的名单排在总览图表下方，不再有单独的页面
            <Overview
              index={index.data}
              params={route.params}
              refresh={index.refresh}
              syncError={index.error}
            />
          )}
        </main>
      </div>
      {upload && (
        <UploadDialog
          close={() => setUpload(false)}
          created={() => {
            setUpload(false)
            index.refresh()
            go('work', { queue: 'pending' })
          }}
          changed={index.refresh}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
