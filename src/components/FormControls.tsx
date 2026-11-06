import { useEffect, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { formatTime, parseTimecode } from '../lib/project'

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
  disabled?: boolean
}

export function SliderRow({ label, value, min, max, step, onChange, format, disabled }: SliderRowProps) {
  return (
    <label className={`slider-row${disabled ? ' is-disabled' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-value">{format ? format(value) : value.toFixed(step < 1 ? 1 : 0)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

interface ToggleRowProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  description?: string
}

export function ToggleRow({ label, checked, onChange, description }: ToggleRowProps) {
  return (
    <button type="button" className="toggle-row" onClick={() => onChange(!checked)}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <span className={`toggle${checked ? ' is-on' : ''}`} aria-checked={checked} role="switch">
        <span>{checked && <Check size={11} strokeWidth={3} />}</span>
      </span>
    </button>
  )
}

interface TimecodeInputProps {
  value: number
  max?: number
  onCommit: (value: number) => void
  label?: ReactNode
}

export function TimecodeInput({ value, max, onCommit, label }: TimecodeInputProps) {
  const [draft, setDraft] = useState(formatTime(value))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(formatTime(value))
  }, [value, editing])

  const commit = () => {
    const parsed = parseTimecode(draft)
    if (parsed !== null) onCommit(Math.max(0, max === undefined ? parsed : Math.min(max, parsed)))
    else setDraft(formatTime(value))
    setEditing(false)
  }

  return (
    <label className="timecode-field">
      {label && <span className="field-label">{label}</span>}
      <input
        value={draft}
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(formatTime(value))
            setEditing(false)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

interface SegmentedProps<T extends string | number> {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  compact?: boolean
}

export function Segmented<T extends string | number>({ value, options, onChange, compact }: SegmentedProps<T>) {
  return (
    <div className={`segmented${compact ? ' is-compact' : ''}`}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
