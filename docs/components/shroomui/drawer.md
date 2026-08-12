# Drawer

通过 Portal 渲染到 `document.body` 的侧边抽屉，支持从左侧或右侧展开。

## 实时示例

<UiComponentDemo name="Drawer" />

## 用法

```jsx
import { Drawer } from 'shroom-backend-sdk/UI/shroomui'

<Drawer
  show={show}
  setShow={setShow}
  title="串口设置"
  direction="right"
>
  <SerialSettings />
</Drawer>
```

## Props

| prop | 说明 |
| :--- | :--- |
| `show` / `setShow` | 受控显示状态及更新函数 |
| `direction` | `left` 或 `right`，默认 `right` |
| `close` | 点击关闭按钮时的附加回调 |
| `asideClose` | 是否显示抽屉外侧快捷开关 |
| `zindex` | 业务层级，内部换算为基础 z-index |
