# 渲染 API

浏览器使用 Canvas 热力图渲染基础 Frame，Node.js / Python 使用终端渲染。显示参数不做数据标定，也不增加三维模型、IMU 或手势算法。

## 导入 {#import}

网页模块从浏览器入口导入：

```js
import { Shroom, createHeatmap, getColormap, COLORMAPS,
  shroom, jet, jetWhite, grey } from './web/index.js';
```

网页示例假定放在 SDK 根目录，与 web/ 同级，通过 HTTP 服务打开。

## Canvas 热力图 {#canvas}

### Shroom.createHeatmap(target, options) {#create-heatmap}

**用途**：在 canvas 上创建热力图；具名 createHeatmap() 相同。

| 参数 | 类型 | 必填 / 说明 |
| --- | --- | --- |
| target | HTMLCanvasElement / string | 必填 canvas 或 CSS 选择器，元素须已存在 |
| options | HeatmapOptions | 可选，见下表 |

**返回值**：Heatmap，提供 render / setOptions / resize / clear / canvas。选择器不存在或目标不是 canvas 时抛 Error。

**示例**：

```js
const heatmap = Shroom.createHeatmap('#view', { mode: 'grid', colormap: 'jetWhite' });
```

**注意事项**：在客户端 DOM 就绪后创建，不能在 Node.js / 服务端渲染过程中创建。canvas 应有明确 CSS 宽高。

### HeatmapOptions {#heatmap-options}

所有选项可用于构造与 setOptions()。

| 参数 | 类型 | 默认值 / 作用 |
| --- | --- | --- |
| mode | 'dots' / 'heat' / 'grid' | dots，点阵 / 圆斑 / 方格；未知值回退 dots |
| colormap | 名称 / (t) => [r,g,b] | jet，见调色板 API |
| smooth | boolean | true，heat/grid 缩放平滑；dots 不受此开关控制 |
| background | string / null | null，heat/grid 底色，透明为默认；如 '#666' |
| gain | number | 1，仅显示增益 |
| dotSize | number | 1，点 / 圆斑大小倍数 |
| relief | number | 1，dots 起伏倍数，0 为平面 |
| tilt | number | 70 度，限制在 5～89，仅 dots |
| flipY | boolean | true，dots 第一行显示在近处；false 翻转方向 |

**注意事项**：显示增益与平滑不改变 Frame 原始统计或物理单位。dots 的显示处理由渲染器实现，smooth 不会关闭其内部显示柔化。

### heatmap.render(frame) {#render}

**用途**：提交最新帧，在下一个屏幕刷新周期绘制。

**参数**：必填 Frame，核心绘制使用 values/rows/cols。**返回值**：void。

**示例**：`const unsubscribe = device.onFrame((frame) => heatmap.render(frame))`。

**注意事项**：同一刷新周期多个提交只绘制最新一帧，不能用绘制次数当采集帧数。没有 requestAnimationFrame 时直接绘制。缺少 frame/values 时忽略；不会自行将任意网络 JSON 转成 Frame。

### heatmap.setOptions(options) {#set-options}

**用途**：局部更新显示参数，未提供项保持原值。

**参数**：可选 HeatmapOptions，默认 {}。**返回值**：void。

**示例**：

```js
heatmap.setOptions({ mode: 'dots', colormap: 'shroom', gain: 2, flipY: false });
```

**注意事项**：不会立即重新提交最后一帧；下一次 render() 生效。换模式重建相应缓冲，色图变化重建颜色表。background 用 null 或空字符串恢复透明。

### heatmap.resize() {#resize}

**用途**：按 canvas 的 CSS 尺寸和 devicePixelRatio 更新实际画布分辨率。

**参数**：无。**返回值**：void。

**示例**：`heatmap.resize()`；需要恢复画面时再 `heatmap.render(frame)`。

**注意事项**：render() 内部也会检查尺寸；resize() 不注册窗口监听、不自动重新提交数据。

### heatmap.clear() {#clear}

**用途**：取消待绘制帧、清空画布和显示缓存。

**参数**：无。**返回值**：void。**示例**：`heatmap.clear()`。

**注意事项**：不取消设备帧订阅，也不关闭串口。应先取消订阅 / 关闭设备，再清屏，否则新帧会重新绘制。当前没有 heatmap.destroy() 方法。

### heatmap.canvas {#canvas-property}

**用途**：获取创建时的 canvas。**类型**：只读 HTMLCanvasElement 引用。

**示例**：`console.log(heatmap.canvas.width, heatmap.canvas.height)`。不代表自动提供图片下载或录制接口。

## 调色板 {#colormap}

### getColormap(nameOrFunction) {#get-colormap}

**用途**：按名字查颜色映射，或使用应用给定的函数。

| 参数 | 类型 | 默认值 / 说明 |
| --- | --- | --- |
| nameOrFunction | string / ColormapFn | 可选；未提供或未知名回退 jet，函数则原样返回 |

**返回值**：`(t: number) => [number, number, number]`，RGB 通道为 0～255。

**示例**：

```js
const color = getColormap('shroom');
console.log(color(0.5));
```

**注意事项**：内置函数把输入限制在 0～1，自定义函数由应用保证范围和性能。此函数在 Node.js 与浏览器入口都可用，Python 没有相同色图 API。

### shroom / jet / jetWhite / grey / COLORMAPS {#builtin-colormaps}

**用途**：内置颜色函数与名称查找表。

| 导出 | 用途 |
| --- | --- |
| shroom(t) | 深紫底 → 蓝紫 → 青 → 绿 → 黄 → 红 |
| jet(t) | 蓝 → 青 → 绿 → 黄 → 红 |
| jetWhite(t) | 近零值白底的 jet |
| grey(t) | 黑到白 |
| COLORMAPS | 名称到以上函数的映射 |

**参数**：各函数必填 t:number；建议 0～1。**返回值**：RGB 三元数组。

**示例**：`console.log(jet(0.5), COLORMAPS.grey(0.5))`。

**注意事项**：这些是具名导出，不是 ES 模块 Shroom 对象上的方法；经典脚本入口与 ES 模块使用方式有差别。

## 点位与其他显示 {#data}

### 点位排列与产品 {#layouts}

先在 connect / mock / decodeFrame 中设置 layout 和矩阵尺寸，再提交 Frame。产品与排列函数见 [后端点位 API](BACKEND-GUIDE.md#node-layout)。位置错误优先检查协议与线序，而非修改色图。

### 终端热力图 {#ascii}

Node.js `Shroom.renderAscii()` 返回 ANSI 彩色字符串；Python `Shroom.render_ascii()` 返回纯字符。参数、返回值与示例均在 [后端 API](BACKEND-GUIDE.md#serial)，Python 可在该页面切换语言。

## 完整运行示例 {#example}

以下网页使用 Mock，不请求设备权限：

```html
<canvas id="view" style="width:100%;height:420px"></canvas>
<script type="module">
  import { Shroom } from './web/index.js';
  const heatmap = Shroom.createHeatmap('#view', { mode: 'grid', colormap: 'jetWhite' });
  const device = Shroom.mock({ rows: 32, cols: 32, fps: 30 });
  const unsubscribe = device.onFrame((frame) => heatmap.render(frame));
  window.addEventListener('pagehide', () => {
    unsubscribe();
    device.close();
    heatmap.clear();
  });
</script>
```

框架应用挂载后创建，卸载时执行同样的释放；真实串口创建必须在用户手势中调用。不要每次组件 render 都新建渲染器。
