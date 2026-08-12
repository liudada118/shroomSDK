import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReloadOutlined } from '@ant-design/icons'
import './index.scss'

const PANEL_Z_INDEX_BASE = 120
const PANEL_Z_INDEX_TOP = 180
let globalMaxZIndex = PANEL_Z_INDEX_BASE

function nextPanelZIndex() {
    if (globalMaxZIndex >= PANEL_Z_INDEX_TOP) {
        globalMaxZIndex = PANEL_Z_INDEX_BASE
    }
    globalMaxZIndex += 1
    return globalMaxZIndex
}

function resolvePanelPosition(position = {}, panelSize = {}, viewportSize = {}) {
    const viewportWidth = viewportSize.width || 0
    const viewportHeight = viewportSize.height || 0
    const panelWidth = panelSize.width || 0
    const panelHeight = panelSize.height || 0

    if (position.right != null || position.bottom != null) {
        return {
            x: position.right != null
                ? Math.max(0, viewportWidth - panelWidth - position.right)
                : (position.x || 0),
            y: position.bottom != null
                ? Math.max(0, viewportHeight - panelHeight - position.bottom)
                : (position.y || 0),
        }
    }

    return {
        x: position.x || 0,
        y: position.y || 0,
    }
}

/**
 * 可拖拽、可缩放、置顶的面板组件
 * - 不可关闭
 * - 鼠标拖拽移动
 * - 可放大/缩小
 * - 在浮窗层内置顶，但保持低于历史/调节抽屉
 */
export default function DraggablePanel({ children, defaultPosition, title, className = '' }) {
    const { t } = useTranslation()
    const panelRef = useRef(null)
    const [position, setPosition] = useState(() => ({
        x: defaultPosition?.x || 0,
        y: defaultPosition?.y || 0,
    }))
    const [zoomPercent, setZoomPercent] = useState(100)
    const [zIndex, setZIndex] = useState(nextPanelZIndex)
    const [isDragging, setIsDragging] = useState(false)
    const dragOffset = useRef({ x: 0, y: 0 })
    const userMovedRef = useRef(false)
    const usesEdgeAnchor = defaultPosition?.right != null || defaultPosition?.bottom != null

    // 点击面板时置顶
    const bringToFront = useCallback(() => {
        setZIndex(nextPanelZIndex())
    }, [])

    // 拖拽开始
    const onMouseDown = useCallback((e) => {
        // 只在标题栏区域拖拽
        if (!e.target.closest('.draggable-panel-header')) return
        e.preventDefault()
        bringToFront()
        userMovedRef.current = true
        setIsDragging(true)
        const rect = panelRef.current.getBoundingClientRect()
        dragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        }
    }, [bringToFront])

    const syncAnchoredPosition = useCallback(() => {
        if (!usesEdgeAnchor || userMovedRef.current || !panelRef.current) return
        const rect = panelRef.current.getBoundingClientRect()
        setPosition(resolvePanelPosition(defaultPosition, {
            width: rect.width,
            height: rect.height,
        }, {
            width: window.innerWidth,
            height: window.innerHeight,
        }))
    }, [defaultPosition, usesEdgeAnchor])

    useLayoutEffect(() => {
        syncAnchoredPosition()
    }, [syncAnchoredPosition])

    useEffect(() => {
        if (!usesEdgeAnchor) return undefined
        window.addEventListener('resize', syncAnchoredPosition)
        return () => window.removeEventListener('resize', syncAnchoredPosition)
    }, [syncAnchoredPosition, usesEdgeAnchor])

    useEffect(() => {
        if (!isDragging) return

        const onMouseMove = (e) => {
            setPosition({
                x: e.clientX - dragOffset.current.x,
                y: e.clientY - dragOffset.current.y
            })
        }

        const onMouseUp = () => {
            setIsDragging(false)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
        return () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
        }
    }, [isDragging])

    // 缩放（10%~1000%），固定 10% 步长，只保留 10 的倍数
    const ZOOM_MIN = 50
    const ZOOM_MAX = 150
    const ZOOM_STEP = 10

    const zoomIn = useCallback((e) => {
        e.stopPropagation()
        setZoomPercent(percent => Math.min(percent + ZOOM_STEP, ZOOM_MAX))
    }, [])

    const zoomOut = useCallback((e) => {
        e.stopPropagation()
        setZoomPercent(percent => Math.max(percent - ZOOM_STEP, ZOOM_MIN))
    }, [])

    const resetZoom = useCallback((e) => {
        e.stopPropagation()
        setZoomPercent(100)
    }, [])

    const scale = zoomPercent / 100

    return (
        <div
            ref={panelRef}
            className={`draggable-panel ${className}`}
            style={{
                position: 'fixed',
                left: position.x + 'px',
                top: position.y + 'px',
                zIndex: zIndex,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                cursor: isDragging ? 'grabbing' : 'default',
            }}
            onMouseDown={(e) => {
                bringToFront()
            }}
        >
            <div className='draggable-panel-header' onMouseDown={onMouseDown}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
                <span className='draggable-panel-title'>{title}</span>
                <div className='draggable-panel-controls'>
                    <span className='panel-ctrl-btn' onClick={zoomOut} title={t('zoomOut')}>-</span>
                    <span className='panel-zoom-value'>{zoomPercent}%</span>
                    <span className='panel-ctrl-btn' onClick={resetZoom} title={t('resetZoom')}>
                        <ReloadOutlined />
                    </span>
                    <span className='panel-ctrl-btn' onClick={zoomIn} title={t('zoomIn')}>+</span>
                </div>
            </div>
            <div className='draggable-panel-body'>
                {children}
            </div>
        </div>
    )
}
