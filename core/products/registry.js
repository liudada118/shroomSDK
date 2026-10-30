/**
 * 已支持产品的唯一静态注册表：登记规范 ID、连接别名及适配器。
 * 新产品实现独立适配器后在此登记；不会根据参数、数据长度或设备名猜测产品。
 */
import { gloveProductAdapter } from './glove.js';
import { padProductAdapter } from './pad.js';

export const deviceProductAdapters = Object.freeze([gloveProductAdapter, padProductAdapter]);
const deviceProductCanonicalRegistry = new Map();
const deviceProductConnectionRegistry = new Map();

for (const adapter of deviceProductAdapters) {
  const canonical = adapter.profile.product;
  for (const name of [canonical, ...adapter.aliases]) {
    if (typeof name !== 'string' || !name || deviceProductConnectionRegistry.has(name)) {
      throw new Error(`产品注册表包含无效或重复 ID：${String(name)}`);
    }
    deviceProductConnectionRegistry.set(name, adapter);
  }
  deviceProductCanonicalRegistry.set(canonical, adapter);
}

/** 连接可接受别名；网络帧必须使用规范 ID，避免扩大已有 WS 协议的接受范围。 */
export function getDeviceProductAdapter(product, { allowAliases = true } = {}) {
  if (typeof product !== 'string') return undefined;
  return (allowAliases ? deviceProductConnectionRegistry : deviceProductCanonicalRegistry).get(product);
}
