import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { DownOutlined } from '@ant-design/icons'
import './index.scss'

export default function Select(props) {
  const {
    options = [],
    defaultValue,
    onChange = () => {},
    icon,
    popupClassName = '',
    dropdownStyle = {},
    getPopupContainer,
    styles,
  } = props

  const [show, setShow] = useState(false)
  const [value, setValue] = useState(defaultValue)
  const [popupPosition, setPopupPosition] = useState({ left: 0, top: 0, width: 0 })
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)
  const closeTimerRef = useRef(null)
  const usePortal = typeof getPopupContainer === 'function'
  const popupRootStyle = styles?.popup?.root || {}
  const topLayerZIndex = popupRootStyle.zIndex || dropdownStyle.zIndex || 2147483647

  const updatePopupPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setPopupPosition({
      left: rect.left,
      top: rect.bottom + 4,
      width: rect.width,
    })
  }, [])

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const openDropdown = () => {
    clearCloseTimer()
    if (usePortal) updatePopupPosition()
    setShow(true)
  }

  const closeDropdown = (delay = usePortal ? 120 : 0) => {
    clearCloseTimer()
    if (delay > 0) {
      closeTimerRef.current = setTimeout(() => {
        setShow(false)
        closeTimerRef.current = null
      }, delay)
      return
    }
    setShow(false)
  }

  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  useEffect(() => {
    return () => clearCloseTimer()
  }, [])

  useEffect(() => {
    if (!show || !usePortal) return
    updatePopupPosition()
    window.addEventListener('resize', updatePopupPosition)
    window.addEventListener('scroll', updatePopupPosition, true)
    return () => {
      window.removeEventListener('resize', updatePopupPosition)
      window.removeEventListener('scroll', updatePopupPosition, true)
    }
  }, [show, usePortal, updatePopupPosition])

  useEffect(() => {
    if (!show || !usePortal) return
    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return
      if (dropdownRef.current?.contains(event.target)) return
      closeDropdown(0)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [show, usePortal])

  const dropdownNode = options.length ? (
    <div
      ref={dropdownRef}
      className={`dropDown ${popupClassName}`.trim()}
      onMouseEnter={openDropdown}
      onMouseLeave={() => closeDropdown()}
      style={{
        opacity: show ? 1 : 0,
        visibility: show ? 'unset' : 'hidden',
        ...dropdownStyle,
        ...popupRootStyle,
        ...(usePortal ? {
          position: 'fixed',
          left: popupPosition.left,
          top: popupPosition.top,
          width: popupPosition.width,
          zIndex: topLayerZIndex,
        } : null),
      }}
    >
      <div className='dropDownAni' style={{ left: show ? 0 : '-100%' }}></div>
      {options.map((a, index) => (
        <div
          className='dropItem'
          key={a.value || index}
          onClick={() => {
            setValue(a.label)
            closeDropdown(0)
            onChange(a.value)
          }}
        >
          {a.label}
        </div>
      ))}
    </div>
  ) : null

  const popupContainer = usePortal && typeof document !== 'undefined'
    ? (getPopupContainer() || document.body)
    : null

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={openDropdown}
        onMouseLeave={() => closeDropdown()}
        onClick={() => {
          if (!options.length) return
          openDropdown()
        }}
        className="systemSelect cursor fs16"
        style={{ minWidth: '5.5rem' }}
      >
        {icon ? icon : ''} {value || defaultValue}
        <div style={{ marginLeft: '1rem' }}>
          {options.length ? <DownOutlined style={{ color: '#0072EF' }} /> : ''}
        </div>
        {!usePortal ? dropdownNode : ''}
      </div>
      {usePortal && popupContainer ? createPortal(dropdownNode, popupContainer) : null}
    </>
  )
}
