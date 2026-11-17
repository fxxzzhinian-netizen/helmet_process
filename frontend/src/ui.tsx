import { useEffect, useRef, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardCheck,
  Clock3,
  FolderOpen,
  ListTodo,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  UserRoundX,
  X,
  type LucideIcon,
} from 'lucide-react'
import { outcomeName, predName, statusName } from './data'
const badgeIcons: Record<string, LucideIcon> = {
  pending: Clock3,
  queued: ListTodo,
  running: LoaderCircle,
  done: CircleCheck,
  error: CircleX,
  review: ClipboardCheck,
  awaiting_identity: UserRoundX,
  violation: TriangleAlert,
  clear: CircleCheck,
  helmet: ShieldCheck,
  no_helmet: ShieldAlert,
  unknown: CircleHelp,
}
export function Badge({ value }: { value: string | null | undefined }) {
  const all: Record<string, string> = {
    ...outcomeName,
    ...predName,
    ...statusName,
    awaiting_identity: '待关联人员',
  }
  const Icon = value ? badgeIcons[value] || CircleHelp : CircleHelp
  return (
    <span className={'badge ' + (value || 'pending')}>
      <Icon size={14} aria-hidden="true" className={value === 'running' ? 'spin' : undefined} />
      {value ? all[value] || value : '暂无结论'}
    </span>
  )
}
export function Fault({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="fault" role="alert">
      <AlertCircle size={18} />
      <span>{text}</span>
      {retry && (
        <button className="link" onClick={retry}>
          <RefreshCw size={14} />
          重试
        </button>
      )}
    </div>
  )
}
export function Empty({
  title,
  body,
  action,
  icon: Icon = FolderOpen,
}: {
  title: string
  body?: string
  action?: ReactNode
  icon?: LucideIcon
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <div>
        <strong>{title}</strong>
        {body && <p>{body}</p>}
      </div>
      {action}
    </div>
  )
}
export function SectionHead({
  title,
  icon: Icon,
  action,
}: {
  title: string
  icon?: LucideIcon
  action?: ReactNode
}) {
  return (
    <div className="section-head">
      <h2>
        {Icon && <Icon size={20} />} {title}
      </h2>
      {action}
    </div>
  )
}
export function TextAction({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button className="link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  )
}
export function Dialog({
  title,
  onClose,
  children,
  large = false,
  locked = false,
  className = '',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  large?: boolean
  locked?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const closer = useRef(onClose)
  closer.current = onClose
  useEffect(() => {
    const el = ref.current!
    const before = document.activeElement as HTMLElement | null
    el.showModal()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      el.close()
      document.body.style.overflow = prev
      before?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={[large ? 'wide-dialog' : '', className].filter(Boolean).join(' ')}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault()
        if (!locked) closer.current()
      }}
      onClick={(e) => {
        if (!locked && e.target === ref.current) {
          const r = ref.current.getBoundingClientRect()
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            closer.current()
        }
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          className="icon-btn"
          aria-label="关闭"
          disabled={locked}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
