import React from 'react'
import { Button, Empty, Spin } from 'antd'
import './index.scss'

export default function AsyncState({
    status = 'loading',
    message,
    actionLabel,
    onAction,
    className = '',
}) {
    return (
        <div className={`ui-async-state ui-async-state--${status} ${className}`.trim()}>
            {status === 'loading' ? (
                <>
                    <Spin />
                    {message ? <span className="ui-async-state__message">{message}</span> : null}
                </>
            ) : <Empty description={message} />}
            {status !== 'loading' && actionLabel && onAction ? (
                <Button type="primary" onClick={onAction}>{actionLabel}</Button>
            ) : null}
        </div>
    )
}
