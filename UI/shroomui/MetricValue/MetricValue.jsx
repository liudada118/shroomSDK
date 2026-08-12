import React from 'react'
import './index.scss'

function formatValue(value, precision, emptyValue) {
    if (value === null || value === undefined || value === '') return emptyValue
    if (precision === null || precision === undefined) return value
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue.toFixed(precision) : value
}

export default function MetricValue({
    label,
    value,
    unit,
    precision,
    emptyValue = '-',
    indicatorColor,
    layout = 'inline',
    align = 'start',
    className = '',
    valueClassName = '',
    unitClassName = '',
}) {
    const displayValue = formatValue(value, precision, emptyValue)

    return (
        <div className={`ui-metric-value ui-metric-value--${layout} ui-metric-value--${align} ${className}`.trim()}>
            {label ? <span className="ui-metric-value__label">{label}</span> : null}
            <div className="ui-metric-value__content">
                {indicatorColor ? (
                    <span
                        className="ui-metric-value__indicator"
                        style={{ backgroundColor: indicatorColor }}
                        aria-hidden="true"
                    />
                ) : null}
                <span className={`ui-metric-value__number ${valueClassName}`.trim()}>{displayValue}</span>
                {unit ? <span className={`ui-metric-value__unit ${unitClassName}`.trim()}>{unit}</span> : null}
            </div>
        </div>
    )
}
