import { describe, expect, it } from 'vitest';

import { toFramePayload } from './framePayload.js';

describe('toFramePayload', () => {
  it('把普通数组包成命令式入口收的载荷', () => {
    const frame = [1, 2, 3];
    expect(toFramePayload(frame)).toEqual({ wsPointData: [1, 2, 3] });
  });

  it('普通数组原样透传不复制（30-100Hz 热路径）', () => {
    const frame = [1, 2, 3];
    expect(toFramePayload(frame).wsPointData).toBe(frame);
  });

  it('把 TypedArray 转成普通数组', () => {
    const frame = new Uint8Array([4, 5, 6]);
    const payload = toFramePayload(frame);

    expect(Array.isArray(payload.wsPointData)).toBe(true);
    expect(payload.wsPointData).toEqual([4, 5, 6]);
  });

  it('支持 Float32Array 这类非整型读数', () => {
    expect(toFramePayload(new Float32Array([1.5, 2.5])).wsPointData).toEqual([1.5, 2.5]);
  });

  it('已经是载荷形态时原样透传，保留额外字段', () => {
    const frame = { wsPointData: [7, 8], local: true, valuelInit: 20 };
    expect(toFramePayload(frame)).toBe(frame);
  });

  it('载荷里的 TypedArray 也会转成普通数组，其余字段保留', () => {
    const payload = toFramePayload({ wsPointData: new Uint8Array([9]), local: true });

    expect(payload.wsPointData).toEqual([9]);
    expect(Array.isArray(payload.wsPointData)).toBe(true);
    expect(payload.local).toBe(true);
  });

  it('空帧与缺帧是两件事：空数组仍然推下去', () => {
    expect(toFramePayload([])).toEqual({ wsPointData: [] });
  });

  it('null 与 undefined 返回 null，调用方据此跳过', () => {
    expect(toFramePayload(null)).toBeNull();
    expect(toFramePayload(undefined)).toBeNull();
  });

  it('识别不了的入参返回 null 而不抛错', () => {
    for (const value of [0, 42, 'abc', true, {}, { wsPointData: 'abc' }, () => {}]) {
      expect(toFramePayload(value)).toBeNull();
    }
  });

  it('DataView 不当帧用（ArrayBuffer.isView 为真但没有 length）', () => {
    expect(toFramePayload(new DataView(new ArrayBuffer(8)))).toBeNull();
  });
});
