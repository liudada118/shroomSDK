import React from 'react'
import { ConfigProvider, InputNumber, Popover, Slider, Switch } from 'antd'
import './index.scss'

const inputTheme = {
    components: {
        InputNumber: {
            token: {
                hoverBg: '#000',
            },
        },
    },
}

export default function SettingControlRow({
    label,
    description,
    meta,
    value,
    sliderValue = value,
    min,
    max,
    step,
    sliderMin = min,
    sliderMax = max,
    sliderStep = step,
    precision,
    disabled = false,
    onChange,
    onSliderChange = onChange,
    switchLabel,
    switchChecked,
    onSwitchChange,
    className = '',
}) {
    const labelNode = (
        <div className="ui-setting-control__label">
            <span>{label}</span>
            {meta ? <em>{meta}</em> : null}
        </div>
    )

    return (
        <div className={`ui-setting-control ${switchLabel ? 'ui-setting-control--with-switch' : ''} ${className}`.trim()}>
            {description ? (
                <Popover color="#32373E" placement="bottomLeft" content={description}>
                    {labelNode}
                </Popover>
            ) : labelNode}
            <Slider
                min={sliderMin}
                max={sliderMax}
                step={sliderStep}
                disabled={disabled}
                onChange={onSliderChange}
                className="ui-setting-control__slider"
                value={sliderValue}
            />
            <ConfigProvider theme={inputTheme}>
                <InputNumber
                    min={min}
                    max={max}
                    step={step}
                    precision={precision}
                    disabled={disabled}
                    value={value}
                    onChange={onChange}
                    className="ui-setting-control__input"
                />
            </ConfigProvider>
            {switchLabel ? (
                <div className="ui-setting-control__switch">
                    <Switch size="small" checked={Boolean(switchChecked)} onChange={onSwitchChange} />
                    <span>{switchLabel}</span>
                </div>
            ) : null}
        </div>
    )
}
