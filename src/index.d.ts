/**
 * Shroom SDK 类型定义。
 * 串口产品取数、WS快速接入、产品展示与服务端标签录制，以及已有后端客户端。
 */

export { BackendSdkClient } from './backend/client.js';
export type { BackendClientOptions, BackendFrame, BackendContract, BackendRequestOptions } from './backend/client.js';

/** 串口/模拟设备错误；已有后端客户端的错误约定不变。 */
export type ErrorCode =
  | 'INVALID_CONFIG' | 'DEPENDENCY_MISSING' | 'PORT_NOT_FOUND' | 'PORT_AMBIGUOUS'
  | 'PERMISSION_DENIED' | 'PORT_BUSY' | 'CONNECTION_FAILED' | 'UNSUPPORTED_ENVIRONMENT'
  | 'USER_CANCELLED' | 'DISCONNECTED' | 'READ_FAILED' | 'WRITE_FAILED' | 'CLOSE_FAILED'
  | 'PARSE_FAILED' | 'CALLBACK_FAILED' | 'SERVER_CLOSED' | 'SERVER_ERROR' | 'SERVER_START_FAILED'
  | 'INVALID_REQUEST' | 'ORIGIN_DENIED' | 'REQUEST_FAILED' | 'REQUEST_TIMEOUT'
  | 'RECORDING_ACTIVE' | 'RECORDING_NOT_ACTIVE' | 'RECORDING_NOT_FOUND'
  | 'RECORDING_INTERRUPTED' | 'RECORDING_OVERFLOW' | 'RECORDING_WRITE_FAILED'
  | 'LICENSE_REQUIRED' | 'LICENSE_INVALID' | 'LICENSE_EXPIRED' | 'LICENSE_UNAVAILABLE'
  | 'LICENSE_REJECTED' | 'LICENSE_PRODUCT_MISMATCH' | 'LICENSE_SCOPE_DENIED' | 'LICENSE_FEATURE_DENIED' | 'LICENSE_DEVICE_REQUIRED';
export type ErrorStage = 'query' | 'configure' | 'connect' | 'read' | 'write' | 'parse' | 'close' | 'callback' | 'serve' | 'stream' | 'recording' | 'render' | 'license';
export interface ShroomErrorOptions {
  /** 错误发生阶段，便于界面区分连接前配置失败与运行期断线。 */
  stage?: ErrorStage;
  /** 面向调用方的处理建议；用于展示，不参与程序分支判断。 */
  suggestion?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}
export interface SerialErrorInfo {
  name: string;
  code: ErrorCode;
  stage: ErrorStage;
  message: string;
  suggestion: string;
  details: Record<string, unknown>;
}
/** 统一 SDK 错误：程序按 code 分支，页面展示 message 和 suggestion。 */
export class ShroomError extends Error {
  constructor(code: ErrorCode, message: string, options?: ShroomErrorOptions);
  code: ErrorCode;
  stage: ErrorStage;
  suggestion: string;
  details: Record<string, unknown>;
  cause?: unknown;
  toJSON(): SerialErrorInfo;
}
export const ERROR_CODES: Readonly<{ [Code in ErrorCode]: Code }>;
export function asShroomError(error: unknown, options?: ShroomErrorOptions & { code?: ErrorCode; message?: string }): ShroomError;
export const SDK_PRODUCT_TYPE: 'shroom-sdk';
/** 授权校验选项；客户密钥与安装标识由宿主应用负责提供和保管。 */
export interface LicenseOptions {
  /** online 向后台校验；offline 本地验签，限定电脑数量的离线码仍必须联网校验并续验。 */
  mode?: 'online' | 'offline';
  /** 默认 https://shroom.jq-industries.com；仅接受 HTTPS 或本机回环 HTTP。 */
  serverUrl?: string;
  /** 宿主提供的稳定安装标识，须为 64 个小写十六进制字符；有电脑名额限制时必填。 */
  deviceId?: string;
  /** 离线码签发方的可信 RSA 公钥 PEM，不能从待校验的密钥内容中读取公钥。 */
  publicKey?: string;
}
export type LicenseStatus = {
  valid: true; productType: 'shroom-sdk'; mode: 'online' | 'offline-local' | 'offline-device';
  expiresAt: number; leaseExpiresAt: number;
  /** 兼容元数据：SDK 授权不限制传感器型号，此数组为空。 */
  products: string[];
  /** 有效 SDK 授权始终为 true；能否解析设备还取决于是否已支持它的协议。 */
  allProducts: boolean;
  features: string[];
} | { valid: false; productType: 'shroom-sdk'; code: ErrorCode; message: string };
/** 打开真实硬件前激活；替换或清除授权会使现有受授权保护的会话关闭。 */
export function activateLicense(key: string, options?: LicenseOptions): Promise<LicenseStatus>;
/** 查询当前授权快照，不执行新的激活请求；无效时返回错误码与原因。 */
export function getLicenseStatus(): LicenseStatus;
/** 清除当前进程内授权并通知受保护会话停止，不删除宿主持久保存的安装标识。 */
export function clearLicense(): void;
export type DeviceState = 'open' | 'closed' | 'error';
export interface SerialDiagnostics {
  source: DeviceInfo['source'];
  state: DeviceState;
  status: 'waiting-data' | 'waiting-frame' | 'streaming' | 'closed' | 'error';
  bytesReceived: number;
  frameCount: number;
  droppedCount: number;
  frameLength: number;
  lastError: SerialErrorInfo | null;
  hint: string;
}

/** 基础矩阵帧；产品层在此之上增加产品标识、分区和原始协议字段。 */
export interface Frame {
  /** 原始 ADC 值，0~255，一个点一个字节 */
  raw: Uint8Array;
  /** 按 fullScale 归一化，长度 = rows * cols；默认满量程 255 时为 0~1，不自动裁剪。 */
  values: Float32Array;
  rows: number;
  cols: number;
  /** 归一化后的最小值 */
  min: number;
  /** 归一化后的最大值 */
  max: number;
  /** 归一化后的平均值 */
  avg: number;
  /** 超过阈值的点数 */
  area: number;
  /** 压力重心，x/y 都是 0~1 */
  center: { x: number; y: number };
  /** 毫秒时间戳 */
  timestamp: number;
}

/**
 * 点位排列（线序）名。串口里的字节是采集板的扫描顺序，不等于垫子上的位置，
 * 按产品选一个就能对上。'raw' 是不转换，原样铺。
 */
export type LayoutName =
  | 'raw'
  | 'mat32'
  | 'sit'
  | 'bed1'
  | 'carSeat'
  | 'carBack'
  | 'car10'
  | 'car10Back'
  | 'sit10'
  | 'yanfeng10'
  | 'yanfeng10Back'
  | 'volvo'
  | 'volvoBack'
  | 'volvoHead'
  | 'smallM'
  | 'rect'
  | 'short'
  | 'matCol'
  | 'sitCol'
  | 'xiyue'
  | 'carCol'
  | 'sit100'
  | 'endiSit'
  | 'sofa'
  | 'handSinglePoint'
  | 'wholeChair'
  | 'wholeChairBack'
  | 'wholeChairHead'
  | 'tempFullBed'
  | 'smallSample'
  | 'footInsole';

export interface DecodeOptions {
  /** 指定行数，不填按方阵推断；给了 layout 就以 layout 的行数为准 */
  rows?: number;
  /** 指定列数 */
  cols?: number;
  /** 只取前 N 个字节 */
  points?: number;
  /** 满量程，默认 255 */
  fullScale?: number;
  /** 有效点阈值（归一化后），默认 0.02 */
  threshold?: number;
  /** 点位排列，默认 'raw'。选了它就不用再传 rows / cols */
  layout?: LayoutName;
}

export interface FramerOptions {
  /** 帧分隔符，默认 [0xAA, 0x55, 0x03, 0x99] */
  delimiter?: number[];
  /** 小于这个长度的帧丢弃，默认 8 */
  minLength?: number;
  /** 大于这个长度的帧丢弃，默认 8192 */
  maxLength?: number;
  /**
   * 锁定帧长，默认 true。连着几帧长度一致就把它锁死，之后长度对不上的一律当脏帧丢掉。
   * 分隔符只有 4 个字节，数据里迟早会撞出一模一样的一串，切出来的短帧解码后会退化成
   * 1×N 一条横线，画面就在方阵和横线之间闪。关掉它就是老行为：长度只要在
   * minLength~maxLength 之间就收下。
   */
  lockLength?: boolean;
}

export interface DeviceInfo {
  source: 'web-serial' | 'node-serial' | 'mock';
  rows?: number | null;
  cols?: number | null;
  baudRate?: number;
  path?: string;
  fps?: number;
}

export interface Device {
  info: DeviceInfo;
  /** 订阅每一帧，返回取消订阅的函数 */
  onFrame(handler: (frame: Frame) => void): () => void;
  /** 运行时错误订阅；连接前的错误由 connect() 拒绝。返回取消订阅函数。 */
  onError(handler: (error: ShroomError) => void): () => void;
  readonly state: DeviceState;
  /** 诊断快照，不是实时采样率；lastError 保留最近一次错误。 */
  getDiagnostics(): SerialDiagnostics;
  /** 被丢弃的脏帧数；模拟设备为 0 */
  readonly droppedCount: number;
  /** 串口原始字节数；模拟设备为已生成的 payload 字节数 */
  readonly bytesReceived: number;
  /** 串口成功切出的帧数；模拟设备为成功生成的帧数 */
  readonly frameCount: number;
  /** 锁定的帧长（字节），尚未锁定为 0；通用解码对非平方点数默认返回单行，可显式指定行列。 */
  readonly frameLength: number;
  /** 取消读取并释放连接；重复调用可复用关闭过程，关闭失败通过 Promise 报告。 */
  close(): Promise<void>;
}

/** 已核实并封装串口协议的产品；与旧 listProducts() 的展示线序清单不同。 */
/** 新产品的公开类型集中登记于此，与 core/products/registry.js 的运行时注册对应。 */
export interface DeviceProductTypes {
  handGloveFullPacket: { names: 'handGloveFullPacket' | 'glove'; frame: GloveFrame; node: NodeGloveOptions; web: WebGloveOptions };
  hand: { names: 'hand' | 'pad'; frame: HandPadFrame; node: NodeHandPadOptions; web: WebHandPadOptions };
}
export type DeviceProductId = keyof DeviceProductTypes;
export type DeviceProductName = DeviceProductTypes[DeviceProductId]['names'];
export type RegisteredProductFrame = DeviceProductTypes[DeviceProductId]['frame'];
export type ProductFrameFor<Name extends DeviceProductName> = {
  [Id in DeviceProductId]: Name extends DeviceProductTypes[Id]['names'] ? DeviceProductTypes[Id]['frame'] : never;
}[DeviceProductId];
export type ProductOptionsFor<Name extends DeviceProductName, Runtime extends 'node' | 'web'> = {
  [Id in DeviceProductId]: Name extends DeviceProductTypes[Id]['names']
    ? DeviceProductTypes[Id][Runtime] & { product: Name } : never;
}[DeviceProductId];
export interface DeviceProductInfo {
  product: DeviceProductId;
  label: string;
  family: string;
  baudRate: number;
  payloadLength: number;
  sensorPoints: number;
  rows: number;
  cols: number;
}
export interface ProductFrame extends Frame {
  product: DeviceProductId;
  /** 原始扫描顺序 ADC；不是物理压力单位。与 raw 指向同一份帧内快照。 */
  pressure: Uint8Array;
  /** 按产品映射后的 ADC，长度 rows*cols；values 是对应的 0~1 相对值。 */
  pressureMatrix: Uint8Array;
}
/** 用户点位表定义的区域；手掌首行仅12点，不能假定raw.length=rows*cols。 */
export interface GloveRegion {
  name: string;
  rows: number;
  /** 点位表声明的列宽；每行实际点数见rowLengths。 */
  cols: number;
  rowLengths: number[];
  /** 按行展开的原始256点扫描索引，从0开始。 */
  sourceIndices: Uint16Array;
  /** 区域ADC值，0~255，不包含额外补零。 */
  raw: Uint8Array;
  /** 使用同父帧fullScale归一化的区域值。 */
  values: Float32Array;
  /** ADC按点位表逐行排列；手掌行长为12、15、15、15、15。 */
  matrix: number[][];
}
export interface GloveFingerRegion extends GloveRegion {
  /** 单独的指腹传感点，不混入手指12个主体点。 */
  pulp: GloveRegion;
}
export interface GloveFingers {
  thumb: GloveFingerRegion;
  index: GloveFingerRegion;
  middle: GloveFingerRegion;
  ring: GloveFingerRegion;
  little: GloveFingerRegion;
}
export interface GloveFrame extends ProductFrame {
  product: 'handGloveFullPacket';
  side: 'left' | 'right';
  /** 设备单字节帧号，可回绕；不是毫秒时间戳。 */
  sequence: number;
  /** 原始包类型，不用于猜测左右手。 */
  packetType: number;
  /** 按用户最新左右手点位表提取，不是切分旧pressureMatrix。 */
  fingers: GloveFingers;
  palm: GloveRegion;
  /** 只保留 16 字节 IMU，不承诺四元数分量、轴序或单位。 */
  imu: { raw: Uint8Array };
}
export interface HandPadFrame extends ProductFrame { product: 'hand'; }

/** 服务端持久化的一次标签录制；一个会话对应一个不可变标签。 */
export interface RecordingSession {
  /** 服务端分配的 UUID；下载按此 ID 定位，不能用 label 替代。 */
  id: string;
  /** 本次采集的不可变标签，开始时填写。 */
  label: string;
  /** 开始时的 Unix 毫秒时间戳。 */
  startedAt: number;
  /** 结束时的 Unix 毫秒时间戳；进行中为 null。 */
  endedAt: number | null;
  /** 已提交到 SQLite 的帧数，可能短暂落后于实时收到的帧数。旧记录返回原文件统计。 */
  frameCount: number;
  status: 'recording' | 'stopped' | 'error';
  product?: string;
  source?: string;
  side?: 'left' | 'right';
  error?: { code: string; message: string };
}
export type RecordingFormat = 'csv' | 'jsonl';
/** 只要求订阅能力，串口设备与自定义数据源可以复用同一快速链路。 */
export interface FrameSource<T extends Frame = Frame> {
  info?: { source?: string; product?: string; side?: string };
  onFrame?(handler: (frame: T) => void): () => void;
  onData?(handler: (frame: T) => void): () => void;
  onError?(handler: (error: Error) => void): () => void;
}
/** 浏览器 WS 连接选项；服务端来自 Node serveDevice，与已有主项目后端客户端协议不同。 */
export interface StreamOptions<T extends Frame = Frame> {
  /** 同机只填端口；跨机还需主机与服务端的来源授权。 */
  port?: number;
  host?: string;
  /** 完整 ws:// 或 wss:// 地址，优先于 host/port；不会自动把明文服务升级为 TLS。 */
  url?: string;
  /** 握手与每次录制控制请求的超时毫秒数，默认 10000。 */
  timeoutMs?: number;
  onData?: (frame: T) => void;
  onError?: (error: Error) => void;
  /** 注入兼容实现供测试或其他运行端使用；浏览器通常直接使用全局 WebSocket。 */
  WebSocketImpl?: typeof WebSocket;
}
/** 已通过 ready 握手的订阅客户端；同一个对象承接取帧和录制控制。 */
export interface StreamDevice<T extends Frame = Frame> extends FrameSource<T> {
  info: { source?: string; product?: string; side?: string };
  readonly state: DeviceState;
  onFrame(handler: (frame: T) => void): () => void;
  onData(handler: (frame: T) => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  /** 监听服务端后续广播的录制状态；返回取消订阅函数。 */
  onRecording(handler: (recording: RecordingSession | null) => void): () => void;
  /** 开始一段带标签的服务端录制；已有活动录制时失败。 */
  startRecording(options: { label: string }): Promise<RecordingSession>;
  /** 等待写入后返回本次记录，不关闭取数连接；配套服务从未开始时抛错，重复停止返回原记录。 */
  stopRecording(): Promise<RecordingSession | null>;
  /** 主动查询真实状态；操作超时后用它确认结果，避免直接重复开始采集。 */
  getRecordingStatus(): Promise<RecordingSession | null>;
  /** 获取服务端持久记录列表；页面重载后仍可按用户选中的记录 ID 下载。 */
  listRecordings(): Promise<RecordingSession[]>;
  /** recordingId 必填，使用服务端返回的采集记录 id，不是产品 ID、标签或端口。 */
  getRecordingUrl(recordingId: string, options?: { format?: RecordingFormat }): string;
  /** 触发浏览器按记录 ID 下载并同步返回 URL；触发不等于已保存，不把文件堆入 JS 内存。 */
  downloadRecording(recordingId: string, options?: { format?: RecordingFormat }): string;
  /** 断开浏览器，不自动停止后端录制；重连后查询真实状态。 */
  close(): Promise<void>;
  readonly recording: RecordingSession | null;
  readonly url: string;
}
export interface ProductViewOptions<T extends Frame = Frame> extends HeatmapOptions {
  /** 提供时自动订阅 onData/onFrame；不提供时手动调用视图 render。 */
  source?: FrameSource<T>;
  /** 可提前约束产品类型，收到其他产品帧时报错。 */
  product?: DeviceProductId;
}
export interface ProductView {
  /** 提交一帧产品数据，相邻刷新周期内只绘制最新帧。 */
  render(frame: Frame): void;
  /** 容器尺寸变化后重画最近一帧。 */
  resize(): void;
  /** 取消订阅并移除本视图创建的元素，不关闭外部设备或 WS。 */
  destroy(): void;
  readonly element: HTMLElement;
  readonly product: DeviceProductId | null;
}
/** 接收产品帧的普通 JSON 快照；TypedArray 字段在传输中编码为普通数组。 */
export type StreamFrame = Record<string, unknown>;
export const STREAM_SCHEMA: 'shroom.frame.v1';
/** 将产品帧转成可 JSON 序列化的结构；TypedArray 转为普通数组。 */
export function encodeStreamFrame(frame: Frame): StreamFrame;
/** 校验跨 WS 传输的帧并恢复 TypedArray；无效形状抛出结构化错误。 */
export function decodeStreamFrame(frame: unknown): Frame | GloveFrame | HandPadFrame;
/** 建立 WS 连接并等待协议握手；真实串口与录制文件由 Node 服务管理。 */
export function connectStream<T extends Frame = Frame>(options?: StreamOptions<T>): Promise<StreamDevice<T>>;
/** source 存在时自动订阅；手套为二维分区视图，不包含三维模型。 */
export function createProductView<T extends Frame = Frame>(target: HTMLElement | string, options?: ProductViewOptions<T>): ProductView;
export interface ProductDevice<T extends Frame & { product: DeviceProductId } = ProductFrame> extends Omit<Device, 'info' | 'onFrame'> {
  info: DeviceInfo & { product: T['product']; label: string; side?: 'left' | 'right' };
  onFrame(handler: (frame: T) => void): () => void;
  /** onFrame 的产品入口别名。 */
  onData(handler: (frame: T) => void): () => void;
}
export interface ProductCallbacks<T extends Frame & { product: DeviceProductId }> {
  /** 连接前注册，首帧可能早于 await 返回；同步调用，不等待 Promise。 */
  onData?: (frame: T) => void;
  onError?: (error: ShroomError) => void;
}
export interface WebGloveOptions extends ProductCallbacks<GloveFrame> {
  /** 实物左/右手决定点位表，设备不会自动报告或推断此值。 */
  side: 'left' | 'right';
  port?: unknown;
  filters?: WebConnectOptions['filters'];
}
export interface WebHandPadOptions extends ProductCallbacks<HandPadFrame> {
  side?: never;
  port?: unknown;
  filters?: WebConnectOptions['filters'];
}
export interface NodeGloveOptions extends ProductCallbacks<GloveFrame> {
  side: 'left' | 'right';
  /** 未指定时仅一个端口可自动选择；多端口抛 PORT_AMBIGUOUS。 */
  path?: string;
}
export interface NodeHandPadOptions extends ProductCallbacks<HandPadFrame> {
  side?: never;
  path?: string;
}
export type WebProductOptions = {
  [Id in DeviceProductId]: DeviceProductTypes[Id]['web'] & { product: DeviceProductTypes[Id]['names'] };
}[DeviceProductId];
export type NodeProductOptions = {
  [Id in DeviceProductId]: DeviceProductTypes[Id]['node'] & { product: DeviceProductTypes[Id]['names'] };
}[DeviceProductId];
/** 列出已有产品协议封装；不会枚举串口或扫描实物。 */
export function listDeviceProducts(): DeviceProductInfo[];
/** 浏览器整包手套入口：先激活授权，在用户点击中选择串口，按 side 解析分区。 */
export function connectGlove(options: WebGloveOptions): Promise<ProductDevice<GloveFrame>>;
/** 浏览器手部检测垫入口：内置 32×32 协议与映射，不需要 side。 */
export function connectHandPad(options?: WebHandPadOptions): Promise<ProductDevice<HandPadFrame>>;
/** 按 product 选择已适配协议；产品配置决定波特率和解析器，回调接收产品帧。 */
export function connectProduct<Name extends DeviceProductName>(options: { product: Name } & ProductOptionsFor<Name, 'web'>): Promise<ProductDevice<ProductFrameFor<Name>>>;

export type ColormapName = 'shroom' | 'jet' | 'jetWhite' | 'grey';
export type ColormapFn = (t: number) => [number, number, number];

export interface HeatmapOptions {
  /** 画法：'dots' 透视点阵（默认）、'heat' 热力圆斑、'grid' 方格 */
  mode?: 'dots' | 'heat' | 'grid';
  /** 配色，默认 'jet'。'shroom' 是公司桌面端那一套 */
  colormap?: ColormapName | ColormapFn;
  /** 是否平滑，默认 true。只对 'heat' / 'grid' 有效 */
  smooth?: boolean;
  /** 画之前先铺一层底色，如 '#666'。默认透明。热力圆斑带透明度，垫了底色才像桌面端 */
  background?: string | null;
  /** 显示增益，默认 1 */
  gain?: number;
  /** 点 / 圆斑的大小倍数，默认 1 */
  dotSize?: number;
  /** 点阵起伏高度倍数，默认 1；给 0 就是平的俯视点阵。只对 'dots' 有效 */
  relief?: number;
  /** 俯视角（度），5~89，默认 70。越大越像正俯视、方阵看着越方。只对 'dots' 有效 */
  tilt?: number;
  /**
   * 数据第一行画在近处（画面下方），默认 true。
   * 按下面却是上面鼓起来，说明传感器的行序和这里反了，设成 false 即可。只对 'dots' 有效
   */
  flipY?: boolean;
}

export interface Heatmap {
  /** 记下这一帧，在下一个屏幕刷新周期画出来。调得比屏幕快也不会多画 */
  render(frame: Frame): void;
  resize(): void;
  setOptions(options: HeatmapOptions): void;
  clear(): void;
  readonly canvas: HTMLCanvasElement;
}

export interface WebConnectOptions extends DecodeOptions, FramerOptions {
  /** 波特率，默认 1000000 */
  baudRate?: number;
  /** 设备筛选，如 [{ usbVendorId: 0x1a86 }] */
  filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
  /** 已经拿到的 SerialPort，传了就不再弹选择框 */
  port?: unknown;
}

export interface NodeConnectOptions extends DecodeOptions, FramerOptions {
  /** 端口号，如 'COM3' / '/dev/ttyUSB0'；不填时仅单端口可自动选，多端口抛 PORT_AMBIGUOUS。 */
  path?: string;
  /** 波特率，默认 1000000 */
  baudRate?: number;
}

export interface MockOptions extends DecodeOptions {
  rows?: number;
  cols?: number;
  /** 帧率，默认 30；范围 1000/2147483647 至 1000，避免计时器溢出 */
  fps?: number;
}

export interface AsciiOptions {
  /** 输出多少列，默认 32 */
  width?: number;
  colormap?: ColormapName | ColormapFn;
  gain?: number;
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

// ---- 核心数据处理：不负责打开串口或连接网络 ----
/** 解码不含分隔符的一帧 ADC 字节，应用线序和满量程后计算矩阵统计。 */
export function decodeFrame(payload: Uint8Array, options?: DecodeOptions): Frame;
/** 显式行列优先，否则按平方点数推断方阵，非平方点数返回单行形状。 */
export function resolveShape(points: number, options?: DecodeOptions): { rows: number; cols: number };
/** 创建有状态的分帧器；push 可分多次输入半包，也可一次输入多个包。 */
export function createFramer(options?: FramerOptions): {
  push(chunk: Uint8Array): Uint8Array[];
  reset(): void;
  readonly droppedCount: number;
  /** 锁定下来的帧长（字节），还没锁上是 0 */
  readonly frameLength: number;
};
export const DEFAULT_DELIMITER: number[];
/** 按指定帧率生成通用矩阵模拟数据；结束时调用 close 释放定时器。 */
export function createMockDevice(options?: MockOptions): Device;

export interface LayoutInfo {
  name: LayoutName;
  /** 中文名，给下拉框用 */
  label: string;
  rows: number;
  cols: number;
}

/** 通用矩阵线序定义；raw 表示不转换，因此不在此表内。 */
export const LAYOUTS: Record<Exclude<LayoutName, 'raw'>, {
  rows: number;
  cols: number;
  label: string;
  scan?: number;
  build(indices: number[]): number[];
}>;

/**
 * 取排列表。perm[显示位置] = 这个位置在扫描顺序里的下标，-1 表示这里没有传感器。
 * 'raw' 或名字不认识时返回 null，也就是不转换。
 */
export function getLayout(name?: LayoutName): {
  rows: number;
  cols: number;
  perm: Int32Array;
} | null;

/** 列出所有排列。这是按线序列的，界面下拉框请用 listProducts() */
export function listLayouts(): LayoutInfo[];

/** 产品名，和公司桌面端「请选择传感器」菜单里的 value 一致 */
export type ProductName =
  | 'hand'
  | 'smallSample'
  | 'footVideo'
  | 'jqbed'
  | 'smallBedNoAlg'
  | 'tempFullBed'
  | 'petCare'
  | 'petCareMini'
  | 'fast256'
  | 'fast1024'
  | 'handSinglePoint'
  | 'normal'
  | 'humanBody';

export interface ProductInfo {
  name: ProductName;
  /** 产品名，和桌面端菜单一字不差 */
  label: string;
  /** 这款产品该用哪条线序；'raw' 表示不用换，按扫描顺序原样铺 */
  layout: LayoutName | 'raw';
  rows: number;
  cols: number;
}

/** 按产品名取一项，名字不认识返回 null */
export function getProduct(name?: ProductName): ProductInfo | null;

/** 列出所有产品，界面下拉框用这个。顺序是桌面端菜单的顺序 */
export function listProducts(): ProductInfo[];

/** 原始产品菜单；使用线序的产品由 getProduct/listProducts 补全行列。 */
export const PRODUCTS: Array<Omit<ProductInfo, 'rows' | 'cols'> & Partial<Pick<ProductInfo, 'rows' | 'cols'>>>;

export const shroom: ColormapFn;
export const jet: ColormapFn;
export const jetWhite: ColormapFn;
export const grey: ColormapFn;
export const COLORMAPS: Record<ColormapName, ColormapFn>;
export function getColormap(name?: ColormapName | ColormapFn): ColormapFn;

// ---- 浏览器入口：串口选择需要用户手势，绘图需要页面画布 ----
export function connectSerial(options?: WebConnectOptions): Promise<Device>;
export function isSerialSupported(): boolean;
export function createHeatmap(target: HTMLCanvasElement | string, options?: HeatmapOptions): Heatmap;

// ---- Node.js 入口（从 shroom-sdk/node 导入）----
/** 只查询系统串口清单，不打开设备、不自动判断传感器产品。 */
export function listPorts(): Promise<PortInfo[]>;
export function renderAscii(frame: Frame, options?: AsciiOptions): string;

export const Shroom: {
  activateLicense: typeof activateLicense;
  getLicenseStatus: typeof getLicenseStatus;
  clearLicense: typeof clearLicense;
  ShroomError: typeof ShroomError;
  ERROR_CODES: typeof ERROR_CODES;
  asShroomError: typeof asShroomError;
  connectProduct: typeof connectProduct;
  connectGlove: typeof connectGlove;
  connectHandPad: typeof connectHandPad;
  listDeviceProducts: typeof listDeviceProducts;
  connectStream: typeof connectStream;
  createProductView: typeof createProductView;
  encodeStreamFrame: typeof encodeStreamFrame;
  decodeStreamFrame: typeof decodeStreamFrame;
  STREAM_SCHEMA: typeof STREAM_SCHEMA;
  connect(options?: WebConnectOptions): Promise<Device>;
  mock(options?: MockOptions): Device;
  createHeatmap(target: HTMLCanvasElement | string, options?: HeatmapOptions): Heatmap;
  isSupported(): boolean;
  version: string;
};

export default Shroom;
