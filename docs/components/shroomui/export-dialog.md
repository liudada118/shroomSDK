# ExportDialog

采集数据导出配置弹窗，集中处理输出路径、文件格式和导出字段。

## 实时示例

<UiComponentDemo name="ExportDialog" />

## 用法

```jsx
import { ExportDialog } from 'shroom-backend-sdk/UI/shroomui'

<ExportDialog
  open={open}
  title="导出采集数据"
  path={path}
  format={format}
  fieldOptions={fields}
  selectedFields={selectedFields}
  onPathChange={setPath}
  onFormatChange={setFormat}
  onFieldsChange={setSelectedFields}
  onConfirm={exportData}
  onCancel={close}
/>
```

组件不执行文件写入，只收集受控配置并通过回调交给业务层。
