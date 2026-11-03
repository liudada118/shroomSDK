/** 主项目后端原始帧，字段与结构以该后端的契约为准。 */
export interface BackendFrame {
  channelId?: string;
  portId?: string;
  value?: unknown;
  timestamp?: number;
  /** 保留后端自定义字段；此结构不等同于串口 SDK 的 Frame。 */
  [key: string]: unknown;
}

/** 后端公开的接口契约，可覆盖 HTTP 路由和 WS 订阅消息类型。 */
export interface BackendContract {
  http?: { routes?: Record<string, string> };
  websocket?: { messageTypes?: { SUBSCRIBE?: string; UNSUBSCRIBE?: string } };
  [key: string]: unknown;
}

/** 客户端配置；构造时只保存配置，不发起网络连接。 */
export interface BackendClientOptions {
  /** 后端 HTTP 根地址，默认 http://127.0.0.1:19245。 */
  httpBaseUrl?: string;
  /** 主项目实时通道地址，默认 ws://127.0.0.1:19999；需与后端协议匹配。 */
  wsUrl?: string;
  /** 可注入 fetch，用于宿主环境适配或测试。 */
  fetchImpl?: typeof fetch;
  /** 兼容浏览器事件属性的 WebSocket 构造器；Node 入口可回退到 ws。 */
  WebSocketImpl?: typeof WebSocket;
  /** 已知契约可直接传入；也可之后调用 getContract 获取并缓存。 */
  contract?: BackendContract | null;
  /** 显式路由覆盖，优先级高于后端契约与 SDK 默认接口表。 */
  routes?: Record<string, string>;
  /** 仅用于 HTTP 请求的默认头，不会自动作为浏览器 WS 请求头发送。 */
  headers?: HeadersInit;
  /** HTTP 请求与 WS 建连的超时毫秒数，默认 10000。 */
  timeoutMs?: number;
}

/** 单次 HTTP 请求选项；方法默认 GET，body 存在时使用 JSON 编码。 */
export interface BackendRequestOptions {
  method?: string;
  body?: unknown;
  /** 查询参数；null 和 undefined 不写入 URL。 */
  query?: Record<string, string | number | boolean | null | undefined>;
  /** 保留完整响应包装；即使为 true，非零业务 code 仍会抛错。 */
  raw?: boolean;
  /** 替换命名路由中的 :id 等占位符，值会做路径编码。 */
  routeParams?: Record<string, string | number>;
  /** 本次请求头覆盖同名默认头。 */
  headers?: HeadersInit;
  /** 主动取消本次请求；超时结束后会移除相应监听。 */
  signal?: AbortSignal;
  /** 覆盖客户端默认超时，单位毫秒。 */
  timeoutMs?: number;
}

/** 事件参数表；message 是完整消息，frame 是从其中取出的后端帧，raw 是无法解析的文本。 */
export interface BackendClientEvents {
  open: [];
  close: [event: unknown];
  error: [error: Error];
  message: [message: unknown];
  frame: [frame: BackendFrame];
  raw: [message: unknown];
}

export const DEFAULT_HTTP_BASE_URL: string;
export const DEFAULT_WS_URL: string;
export const DEFAULT_ROUTES: Readonly<Record<string, string>>;
/** 解开 code=0 的 data；非零 code 抛错，没有 code 的响应按原样返回。 */
export function normalizeHttpResult(payload: unknown): unknown;

/** 已有后端的查询、控制与通道订阅客户端；控制操作必须显式调用。 */
export class BackendSdkClient {
  constructor(options?: BackendClientOptions);
  readonly httpBaseUrl: string;
  readonly wsUrl: string;
  readonly timeoutMs: number;
  readonly contract: BackendContract | null;
  readonly routes: Record<string, string>;
  readonly ws: WebSocket | null;
  /** 注册持续监听，返回自身以支持链式调用；应至少处理 error 事件。 */
  on<K extends keyof BackendClientEvents>(event: K, handler: (...args: BackendClientEvents[K]) => void): this;
  /** 取消指定处理函数，兼容原函数注册的 once 监听。 */
  off<K extends keyof BackendClientEvents>(event: K, handler: (...args: BackendClientEvents[K]) => void): this;
  /** 事件首次触发后自动取消监听。 */
  once<K extends keyof BackendClientEvents>(event: K, handler: (...args: BackendClientEvents[K]) => void): this;
  /** 传入事件名只清理该事件；省略时清理全部监听。 */
  removeAllListeners(event?: keyof BackendClientEvents): this;
  /** 展开命名路由模板，返回根相对路径。 */
  route(name: string, params?: Record<string, string | number>): string;
  /** 发起带超时与取消支持的 HTTP 请求，默认返回解包后的 data。 */
  request<T = unknown>(routeOrName: string, options?: BackendRequestOptions): Promise<T>;
  /** 默认复用缓存，refresh=true 强制重新读取契约。 */
  getContract(options?: { refresh?: boolean }): Promise<BackendContract>;
  /** 通道、WS 状态和展示系统查询保留后端完整响应包装。 */
  getChannels(): Promise<unknown>;
  getWsStatus(): Promise<unknown>;
  listDisplaySystems(): Promise<unknown>;
  getDisplaySystem(id: string): Promise<unknown>;
  /** 查询后端所在电脑的串口。 */
  listSerialPorts(): Promise<unknown>;
  /** 按角色查询串口状态；省略角色时由后端决定范围。 */
  getSerialStatus(role?: string): Promise<unknown>;
  /** 查询后端当前传感器类型。 */
  getCurrentSensor(): Promise<unknown>;
  /** 请求后端切换传感器，会改变后端配置。 */
  setSensorType(type: string): Promise<unknown>;
  /** 请求后端打开串口；port/path/portPath 至少提供一个，role 默认 sit。 */
  openSerial(options: { role?: string; port?: string; path?: string; portPath?: string }): Promise<unknown>;
  /** 请求后端关闭对应角色的串口。 */
  closeSerial(options?: { role?: string }): Promise<unknown>;
  /** 调用主项目采集接口，参数和返回值由其契约定义。 */
  startCollection(options?: Record<string, unknown>): Promise<unknown>;
  /** 停止主项目采集，不等同于独立产品流的 stopRecording。 */
  stopCollection(): Promise<unknown>;
  /** 返回 WS 对象；用 open/error 事件观察异步建连结果，成功后订阅 channels。 */
  connectRealtime(options?: { channels?: string | string[]; timeoutMs?: number; protocols?: string | string[] }): WebSocket;
  /** 仅关闭当前订阅连接，不自动关闭后端串口或停止采集。 */
  disconnectRealtime(): void;
  /** 已连接时新增通道订阅，重复通道标识先去重。 */
  subscribe(channels: string | string[]): void;
  /** 已连接时取消指定通道订阅。 */
  unsubscribe(channels: string | string[]): void;
  /** 将消息编码为 JSON 发送，连接未打开时同步抛错。 */
  sendRealtime(message: unknown): void;
  /** 分派原始消息及逐帧事件，不重排或归一化后端数据。 */
  handleRealtimeMessage(message: unknown): void;
}
