import React from 'react'
import { Button, Checkbox, Input, Modal, Radio } from 'antd'
import './index.scss'

const DEFAULT_FORMATS = [
    { label: 'CSV', value: 'csv' },
    { label: 'XLSX', value: 'xlsx' },
]

export default function ExportDialog({
    open,
    title,
    path,
    pathHint,
    inputPlaceholder,
    browseLabel,
    openLabel,
    onPathChange,
    onPathBlur,
    onBrowse,
    onOpenFolder,
    format,
    formatLabel,
    formats = DEFAULT_FORMATS,
    onFormatChange,
    fieldOptions,
    selectedFields = [],
    onFieldsChange,
    fieldsLabel,
    fieldsLoading = false,
    selectAllLabel,
    clearLabel,
    loadingLabel,
    emptyLabel,
    footerNote,
    confirmText,
    cancelText,
    confirmLoading = false,
    onConfirm,
    onCancel,
    width = 720,
}) {
    const hasFields = Array.isArray(fieldOptions)

    return (
        <Modal
            title={title}
            open={open}
            onOk={onConfirm}
            onCancel={onCancel}
            okText={confirmText}
            cancelText={cancelText}
            confirmLoading={confirmLoading}
            width={width}
        >
            {pathHint ? <div className="ui-export-dialog__hint">{pathHint}</div> : null}
            <div className="ui-export-dialog__path-row">
                <Input
                    value={path}
                    onChange={(event) => onPathChange?.(event.target.value)}
                    onBlur={onPathBlur}
                    placeholder={inputPlaceholder}
                />
                {onBrowse ? <Button onClick={onBrowse}>{browseLabel}</Button> : null}
                {onOpenFolder ? <Button onClick={onOpenFolder}>{openLabel}</Button> : null}
            </div>
            {formats?.length ? (
                <div className="ui-export-dialog__section">
                    <div className="ui-export-dialog__section-title">{formatLabel}</div>
                    <Radio.Group
                        value={format}
                        onChange={(event) => onFormatChange?.(event.target.value)}
                        options={formats}
                    />
                </div>
            ) : null}
            {hasFields ? (
                <div className="ui-export-dialog__section">
                    <div className="ui-export-dialog__fields-header">
                        <div className="ui-export-dialog__section-title">
                            {fieldsLabel}
                            <span>{selectedFields.length}/{fieldOptions.length}</span>
                        </div>
                        <div className="ui-export-dialog__field-actions">
                            <Button
                                size="small"
                                onClick={() => onFieldsChange?.(fieldOptions.map((item) => item.value))}
                                disabled={fieldsLoading || !fieldOptions.length}
                            >
                                {selectAllLabel}
                            </Button>
                            <Button
                                size="small"
                                onClick={() => onFieldsChange?.([])}
                                disabled={fieldsLoading || !fieldOptions.length}
                            >
                                {clearLabel}
                            </Button>
                        </div>
                    </div>
                    <div className="ui-export-dialog__fields">
                        {fieldsLoading ? (
                            <div className="ui-export-dialog__muted">{loadingLabel}</div>
                        ) : fieldOptions.length ? (
                            <Checkbox.Group value={selectedFields} onChange={onFieldsChange}>
                                {fieldOptions.map((field) => (
                                    <Checkbox key={field.value} value={field.value}>
                                        <span title={field.label}>{field.label}</span>
                                    </Checkbox>
                                ))}
                            </Checkbox.Group>
                        ) : (
                            <div className="ui-export-dialog__muted">{emptyLabel}</div>
                        )}
                    </div>
                </div>
            ) : null}
            {footerNote ? <div className="ui-export-dialog__footer-note">{footerNote}</div> : null}
        </Modal>
    )
}
