import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'

type Option = { value: string; label: string }

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  icon: Icon,
  className = '',
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  icon?: LucideIcon
  className?: string
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const search = useRef({ text: '', time: 0 })
  const revealActive = useRef(false)
  const selected = options.findIndex((option) => option.value === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [popup, setPopup] = useState({ above: false, height: 260, width: 240, left: 0, top: 0, bottom: 0 })

  function expand(index = Math.max(0, selected)) {
    const rect = trigger.current!.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const upwards = below < Math.min(260, options.length * 38 + 12) && above > below
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24)
    setPopup({
      above: upwards,
      height: Math.max(64, Math.min(260, (upwards ? above : below) - 6)),
      width,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: rect.bottom + 6,
      bottom: window.innerHeight - rect.top + 6,
    })
    revealActive.current = true
    setActive(Math.min(index, options.length - 1))
    search.current = { text: '', time: 0 }
    setOpen(true)
  }

  function choose(index: number) {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('scroll', outside, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('scroll', outside, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !revealActive.current) return
    const menu = list.current
    const option = menu?.children[active] as HTMLElement | undefined
    if (!menu || !option) return
    // Scroll this list only. scrollIntoView also moves dialog/page ancestors,
    // whose scroll listener closes the popup immediately after it opens.
    const viewport = menu.getBoundingClientRect()
    const item = option.getBoundingClientRect()
    const top = viewport.top + menu.clientTop
    const bottom = top + menu.clientHeight
    if (item.top < top) menu.scrollTop += item.top - top
    else if (item.bottom > bottom) menu.scrollTop += item.bottom - bottom
  }, [open, active])

  function activate(index: number) {
    revealActive.current = true
    setActive(index)
  }

  function keydown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) expand()
      else activate((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const index = event.key === 'Home' ? 0 : options.length - 1
      if (!open) expand(index)
      else activate(index)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(active)
      else expand()
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
      const now = Date.now()
      const text = (now - search.current.time < 700 ? search.current.text : '') + event.key.toLowerCase()
      search.current = { text, time: now }
      const index = options.findIndex((option) => option.label.toLowerCase().startsWith(text))
      if (index >= 0) {
        event.preventDefault()
        if (!open) expand(index)
        else activate(index)
        search.current = { text, time: now }
      }
    }
  }

  const selectedLabel = options[selected]?.label || (value ? '所选项不可用' : '请选择')
  return (
    <div className={'filter-select ' + className} ref={root}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="filter-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && options[active] ? id + '-' + active : undefined}
        disabled={!options.length}
        title={selectedLabel}
        onClick={() => open ? setOpen(false) : expand()}
        onKeyDown={keydown}
      >
        {Icon && <Icon size={15} aria-hidden="true" />}
        <span>{selectedLabel}</span>
        <ChevronDown size={15} className="filter-select-arrow" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          className="filter-select-popup"
          style={{
            left: popup.left,
            width: popup.width,
            maxHeight: popup.height,
            top: popup.above ? undefined : popup.top,
            bottom: popup.above ? popup.bottom : undefined,
          }}
        >
          {options.map((option, index) => (
            <div
              id={id + '-' + index}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active ? 'true' : undefined}
              className="filter-select-option"
              title={option.label}
              onPointerMove={() => { revealActive.current = false; setActive(index) }}
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse') event.preventDefault()
              }}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              <span className="filter-select-check" aria-hidden="true">
                {option.value === value && <Check size={15} />}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
