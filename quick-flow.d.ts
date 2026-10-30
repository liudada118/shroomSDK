/** 五步入口的公开类型；调用方只处理产品参数、连接句柄和采集结果。 */
import type { Frame, DeviceProductName, ProductOptionsFor, ProductFrameFor,
  ProductDevice, FrameSource, StreamOptions, StreamDevice, RecordingSession, RecordingFormat } from './index.js';
import type { DeviceServer, DeviceServerOptions } from './node/index.js';

/** 网页通过 WS 接收产品帧；不能同时传入 Node 串口参数。 */
export type ReadStreamOptions<T extends Frame = Frame> = StreamOptions<T> & {
  url: string; product?: never; path?: never; side?: never;
};
/** 服务关闭会等待录制完成并释放 createWS 接管的设备。 */
export interface QuickServer extends DeviceServer {
  close(): Promise<void>;
}
export type RecordingTarget = QuickServer | StreamDevice;

/** ① Node 取数；参数和返回帧从产品类型注册表推导，新增产品无需修改此函数。 */
export function readProduct<Name extends DeviceProductName>(options: { product: Name; url?: never } & ProductOptionsFor<Name, 'node'>): Promise<ProductDevice<ProductFrameFor<Name>>>;
/** ① 网页接收 Node WS 数据；连接前失败会拒绝 Promise。 */
export function readProduct<T extends Frame = Frame>(options: ReadStreamOptions<T>): Promise<StreamDevice<T>>;
/** ② 创建本地 WS/HTTP 服务；创建失败会释放设备，成功后由 server.close() 统一释放。 */
export function createWS<T extends Frame>(device: FrameSource<T> & { close(): Promise<void> }, options?: DeviceServerOptions): Promise<QuickServer>;
/** ③ 开始采集，默认标签为“本次采集”；同一目标的起停操作不能并发。 */
export function startRecording(target: RecordingTarget, options?: { label: string }): Promise<RecordingSession>;
/** ④ 停止并等待文件写完，内部保留本次记录 ID；实时取数继续。 */
export function stopRecording(target: RecordingTarget): Promise<RecordingSession>;
/** ⑤ 下载此目标最近一次成功停止的记录；网页触发下载，Node 仅返回 URL，不代表文件已保存。 */
export function downloadRecording(target: RecordingTarget, options?: { format?: RecordingFormat }): string;
