/** Node 入口类型：复用共享帧/产品定义，追加本机串口和 WS 采集服务。 */
export type * from '../index.js';
export {
  ShroomError, ERROR_CODES, asShroomError, listDeviceProducts,
  activateLicense, getLicenseStatus, clearLicense, SDK_PRODUCT_TYPE,
  createMockDevice, createFramer, DEFAULT_DELIMITER, decodeFrame, resolveShape,
  shroom, jet, jetWhite, grey, COLORMAPS, getColormap,
  LAYOUTS, getLayout, listLayouts, PRODUCTS, getProduct, listProducts,
  encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA,
} from '../index.js';
export { BackendSdkClient } from './backend.js';
import type { NodeConnectOptions, Device, MockOptions, Frame, AsciiOptions, PortInfo, ShroomError, ERROR_CODES, asShroomError } from '../index.js';
import type { NodeProductOptions, NodeGloveOptions, NodeHandPadOptions, ProductDevice, GloveFrame, HandPadFrame, ProductFrameFor, DeviceProductName, ProductOptionsFor, listDeviceProducts } from '../index.js';
import type { FrameSource, RecordingSession, encodeStreamFrame, decodeStreamFrame, STREAM_SCHEMA } from '../index.js';
import type { activateLicense, getLicenseStatus, clearLicense } from '../index.js';

/** 创建独立产品流服务的配置；不会自动打开或关闭传入设备。 */
export interface DeviceServerOptions {
  /** 默认19999；0让系统分配空闲端口，适用于测试。 */
  port?: number;
  /** 默认127.0.0.1；跨机访问须显式提供允许的Origin列表。 */
  host?: string;
  /** SQLite 采集库保存目录，默认当前工作目录下的 .shroom-recordings；同目录只运行一个服务。 */
  recordingsDir?: string;
  /** 明确的网页 Origin（含协议和端口），不支持通配符；跨机监听时必填。 */
  allowedOrigins?: string[];
  /** 单个 WS 客户端待发送字节上限，默认 1 MiB；超过时断开该慢客户端。 */
  maxBufferedBytes?: number;
  /** 录制队列待写帧数上限，默认 1000；写入跟不上时以错误结束记录。 */
  maxQueueFrames?: number;
}
/** 独立产品流服务句柄；一台服务同时最多保存一条带标签的活动记录。 */
export interface DeviceServer {
  /** 实际监听端口；传入 port=0 时为系统分配值。 */
  readonly port: number;
  readonly host: string;
  /** WS 连接地址，例如 ws://127.0.0.1:19999。 */
  readonly url: string;
  /** 同端口 HTTP 根地址；按 /recordings/<id>.csv 或 .jsonl 下载。 */
  readonly httpUrl: string;
  /** 开始一条标签固定的记录，返回含 id 的会话；已有活动记录时拒绝。 */
  startRecording(options: { label: string }): Promise<RecordingSession>;
  /** 停止保存并等待 SQLite 入库队列排空，返回记录；设备取数和实时广播继续运行。 */
  stopRecording(): Promise<RecordingSession | null>;
  /** 返回最近一次记录的快照；首次开始前为 null。 */
  getRecordingStatus(): RecordingSession | null;
  /** 查询历史与当前记录，按开始时间倒序排列。 */
  listRecordings(): Promise<RecordingSession[]>;
  /** 返回同源 HTTP 下载地址；ID 必须为记录 UUID，默认 CSV，不访问文件或触发下载。 */
  getRecordingUrl(recordingId: string, options?: { format?: 'csv' | 'jsonl' }): string;
  /** 停止服务并等待录制写完，不关闭调用者拥有的设备。 */
  close(): Promise<void>;
}
/** 订阅 device 的帧并启动 WS/HTTP 服务；真实源需读取和 stream 授权，录制还需 recording。 */
export function serveDevice<T extends Frame>(device: FrameSource<T>, options?: DeviceServerOptions): Promise<DeviceServer>;

/** 通用串口连接，按传入协议配置拆帧；多端口时建议明确 path。 */
export function connectSerial(options?: NodeConnectOptions): Promise<Device>;
/** 连接整包手套，side 必须明确；onData 返回手指、手掌和原始 IMU。 */
export function connectGlove(options: NodeGloveOptions): Promise<ProductDevice<GloveFrame>>;
/** 连接手部检测垫，使用内置 32×32 矩阵协议，无需填写 side。 */
export function connectHandPad(options?: NodeHandPadOptions): Promise<ProductDevice<HandPadFrame>>;
/** 产品类型由统一类型注册表推导，支持别名；未指定 path 且有多个串口时拒绝猜测。 */
export function connectProduct<Name extends DeviceProductName>(options: { product: Name } & ProductOptionsFor<Name, 'node'>): Promise<ProductDevice<ProductFrameFor<Name>>>;
/** 具名导出的便捷集合；connect 为通用串口入口，mock 为通用矩阵模拟源。 */
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
  serveDevice: typeof serveDevice;
  encodeStreamFrame: typeof encodeStreamFrame;
  decodeStreamFrame: typeof decodeStreamFrame;
  STREAM_SCHEMA: typeof STREAM_SCHEMA;
  connect(options?: NodeConnectOptions): Promise<Device>;
  mock(options?: MockOptions): Device;
  listPorts(): Promise<PortInfo[]>;
  renderAscii(frame: Frame, options?: AsciiOptions): string;
  version: string;
};
export default Shroom;
