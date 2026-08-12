import React from 'react'
import { Button, Modal, Progress } from 'antd'
import './index.scss'

export default function ExportProgressDialog({
    open,
    title,
    status = 'downloading',
    percent = 0,
    hint,
    files = [],
    filesLabel,
    openFileLabel,
    openFolderLabel,
    closeLabel,
    onOpenFile,
    onOpenFolder,
    onClose,
    width = 480,
}) {
    const completed = status === 'done'
    const failed = status === 'error'
    const footer = completed
        ? [
            onOpenFolder ? <Button key="openFolder" type="primary" onClick={onOpenFolder}>{openFolderLabel}</Button> : null,
            <Button key="close" onClick={onClose}>{closeLabel}</Button>,
        ].filter(Boolean)
        : failed
            ? [<Button key="close" onClick={onClose}>{closeLabel}</Button>]
            : []

    return (
        <Modal
            title={title}
            open={open}
            footer={footer}
            closable={status !== 'downloading'}
            onCancel={onClose}
            maskClosable={false}
            width={width}
        >
            <div className="ui-export-progress">
                <Progress
                    percent={percent}
                    status={failed ? 'exception' : completed ? 'success' : 'active'}
                    strokeColor={completed ? '#52c41a' : '#1890ff'}
                />
                {hint ? <div className="ui-export-progress__hint">{hint}</div> : null}
                {completed && files.length ? (
                    <div className="ui-export-progress__files">
                        {filesLabel ? <div className="ui-export-progress__files-title">{filesLabel}</div> : null}
                        {files.map((file, index) => (
                            <div className="ui-export-progress__file" key={file.filePath || file.fileName || index}>
                                <span title={file.fileName}>{file.fileName}</span>
                                {file.filePath && onOpenFile ? (
                                    <button type="button" onClick={() => onOpenFile(file.filePath)}>{openFileLabel}</button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </Modal>
    )
}
