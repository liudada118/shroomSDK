import React from 'react'
import './index.scss'

export default function ChartPanel({
    title,
    actions,
    legend,
    description,
    children,
    footer,
    className = '',
}) {
    return (
        <section className={`ui-chart-panel ${className}`.trim()}>
            {(title || actions || legend) ? (
                <header className="ui-chart-panel__header">
                    <div className="ui-chart-panel__title-row">
                        {title ? <h3 className="ui-chart-panel__title">{title}</h3> : null}
                        {actions ? <div className="ui-chart-panel__actions">{actions}</div> : null}
                    </div>
                    {legend ? <div className="ui-chart-panel__legend">{legend}</div> : null}
                </header>
            ) : null}
            {description ? <div className="ui-chart-panel__description">{description}</div> : null}
            <div className="ui-chart-panel__body">{children}</div>
            {footer ? <footer className="ui-chart-panel__footer">{footer}</footer> : null}
        </section>
    )
}
