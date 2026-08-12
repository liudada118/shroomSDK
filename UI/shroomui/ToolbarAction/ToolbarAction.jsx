import React from 'react'
import './index.scss'

export default function ToolbarAction(props) {
  const {
    text,
    label,
    show,
    expanded,
    icon,
    onClick,
    disable,
    disabled,
    onClickStatus,
    active,
    className = '',
    title,
  } = props
  const isDisabled = disabled ?? disable ?? false
  const isActive = active ?? onClickStatus ?? false
  const isExpanded = expanded ?? show ?? true
  const actionLabel = label ?? text
  const isInteractive = typeof onClick === 'function'

  const trigger = () => {
    if (!isDisabled) onClick?.()
  }

  return (
    <div
      className={`${isDisabled ? 'disable' : isActive ? 'onclickContent' : 'unclickContent'} iconContent cursor ${className}`.trim()}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? (isDisabled ? -1 : 0) : undefined}
      aria-disabled={isInteractive ? isDisabled : undefined}
      aria-pressed={isInteractive ? isActive : undefined}
      aria-label={actionLabel}
      title={title}
      onClick={trigger}
      onKeyDown={isInteractive ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          trigger()
        }
      } : undefined}
    >
      {icon}
      {actionLabel ? (
        <div className='fs14 iconInfo' style={{ opacity: isExpanded ? 1 : 0 }}>
          {actionLabel}
        </div>
      ) : null}
    </div>
  )
}
