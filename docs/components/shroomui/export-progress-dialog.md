# ExportProgressDialog

展示导出过程、完成结果或失败状态，并在完成后提供结果文件操作。

## 实时示例

<UiComponentDemo name="ExportProgressDialog" />

## 用法

```jsx
import { ExportProgressDialog } from 'shroom-backend-sdk/UI/shroomui'

<ExportProgressDialog
  open={open}
  status="downloading"
  percent={72}
  files={files}
  onOpenFile={openFile}
  onOpenFolder={openFolder}
  onClose={close}
/>
```

`status` 支持 `downloading`、`done` 和 `error`。下载中不可关闭，完成后可展示 `files`。
