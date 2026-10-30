import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { createRecordingStore, recordingCsv, recordingJsonl } from '../node/recording.js';

const runFile = promisify(execFile);

/** 每项测试只拥有自己的临时目录，所有数据库连接关闭后才清理。 */
async function fixture(t, options = {}) {
  const temporaryRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(temporaryRoot, 'shroom-sqlite-test-'));
  const stores = [];
  t.after(async () => {
    try {
      for (const store of stores) await store.close();
    } finally {
      const target = resolve(directory);
      assert.ok(target.startsWith(temporaryRoot + sep), '只允许清理本测试创建的临时子目录');
      await rm(target, { recursive: true, force: true });
    }
  });
  return {
    directory,
    path: join(directory, 'recordings.sqlite'),
    async open(overrides = {}) {
      const store = await createRecordingStore({ directory, ...options, ...overrides });
      stores.push(store);
      return store;
    },
  };
}

/** 模拟已通过编码器校验的单点帧，用序号与时间戳辨认顺序和边界。 */
function frame(sequence) {
  const value = sequence % 256;
  return { timestamp: 1700000000000 + sequence, sequence, raw: [value], values: [value / 255],
    rows: 1, cols: 1, min: value / 255, max: value / 255, avg: value / 255,
    area: value > 0 ? 1 : 0, center: { x: 0.5, y: 0.5 } };
}

/** 读取真实 SQLite 数据，连接不会逃出回调。 */
function database(path, callback, options = { readonly: true }) {
  const db = new Database(path, options);
  try { return callback(db); } finally { db.close(); }
}

/** 收集小型测试导出；生产导出仍使用异步迭代与背压。 */
async function exportedText(iterable) {
  let text = '';
  for await (const chunk of iterable) text += chunk;
  return text;
}

/** 将测试 JSONL 解析为独立记录。 */
async function exportedRows(descriptor) {
  const text = await exportedText(recordingJsonl(descriptor));
  return text.trim() ? text.trim().split('\n').map(JSON.parse) : [];
}

test('SQLite stores committed frames and stop drains every accepted batch before returning', async (t) => {
  const context = await fixture(t);
  const store = await context.open();
  const started = await store.start({ label: '排空队列', source: 'test' });
  for (let index = 0; index < 451; index += 1) store.append(frame(index));
  const stopping = store.stop();
  store.append(frame(9999)); // stop 开始后到达的帧不能再属于本次采集。
  const stopped = await stopping;
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.frameCount, 451);
  const descriptor = store.download(started.id);
  assert.equal(descriptor.format, 'sqlite');
  assert.equal(descriptor.path, context.path);
  const rows = await exportedRows(descriptor);
  assert.equal(rows.length, 451);
  assert.deepEqual(rows.map(row => row.index), Array.from({ length: 451 }, (_, index) => index));
  assert.deepEqual(rows.map(row => row.frame.sequence), rows.map(row => row.index));
  assert.ok(rows.every(row => row.sessionId === started.id && row.label === '排空队列'));
  assert.equal(database(context.path, db => db.prepare('SELECT COUNT(*) AS count FROM frames').get().count), stopped.frameCount);
  assert.deepEqual(database(context.path, db => db.prepare('SELECT status, frame_count FROM sessions WHERE id = ?').get(started.id)),
    { status: 'stopped', frame_count: 451 });
  await store.close();
  assert.equal((await readFile(context.path)).subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.ok(!(await readdir(context.directory)).some(name => /\.(jsonl|meta\.json)$/.test(name)), '新记录只保存 SQLite，不另写 JSONL 副本');
  const reopened = await context.open();
  assert.equal(reopened.list().find(record => record.id === started.id).frameCount, 451);
  assert.deepEqual((await exportedRows(reopened.download(started.id))).map(row => row.index), rows.map(row => row.index));
});

test('a frame arriving while a batch settles is flushed on time and also drained by stop', async (t) => {
  const context = await fixture(t);
  const store = await context.open();
  await store.start({ label: '批次收尾窗口' });
  for (let index = 0; index < 200; index += 1) store.append(frame(index));
  // 第一批处理完队列、Promise finally 尚未清理时，仍可能到达下一帧。
  await new Promise(resolve => queueMicrotask(() => { store.append(frame(200)); resolve(); }));
  await delay(600);
  assert.equal(store.status().frameCount, 201, '第 201 帧不能一直等到后续来帧或停止才保存');
  assert.equal(database(context.path, db => db.prepare('SELECT COUNT(*) AS count FROM frames').get().count), 201);
  await store.stop();

  const second = await store.start({ label: '批次收尾立即停止' });
  for (let index = 0; index < 200; index += 1) store.append(frame(index));
  await Promise.resolve();
  store.append(frame(200));
  const stopped = await store.stop();
  assert.equal(stopped.frameCount, 201, '停止必须排空收尾窗口中到达的帧');
  assert.equal((await exportedRows(store.download(second.id))).length, 201);
});

test('a second store cannot recover or overwrite an active owner in the same directory', async (t) => {
  const context = await fixture(t);
  const store = await context.open();
  const started = await store.start({ label: '仍在采集' });
  store.append(frame(1));
  await assert.rejects(context.open(), error => {
    assert.equal(error.code, 'RECORDING_WRITE_FAILED');
    return true;
  });
  assert.equal(store.status().status, 'recording');
  store.append(frame(2));
  const stopped = await store.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.frameCount, 2);
  assert.equal((await exportedRows(store.download(started.id))).length, 2);
});

test('a failed SQLite batch rolls back every new frame and does not inflate committed counts', async (t) => {
  const context = await fixture(t);
  const changes = [];
  const store = await context.open({ onChange: record => changes.push(record) });
  const previous = await store.start({ label: '已提交记录' });
  store.append(frame(10));
  await store.stop();
  // 第一条新帧能进入事务，第二条触发失败；数据库必须回滚整个批次。
  database(context.path, db => db.exec(`
    CREATE TRIGGER fail_second_new_frame BEFORE INSERT ON frames
    WHEN (SELECT COUNT(*) FROM frames) >= 2
    BEGIN SELECT RAISE(ABORT, 'injected batch failure'); END;
  `), {});
  const current = await store.start({ label: '整批回滚' });
  store.append(frame(20));
  store.append(frame(21));
  const result = await store.stop();
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'RECORDING_WRITE_FAILED');
  assert.equal(result.frameCount, 0);
  assert.ok(changes.some(record => record.id === current.id && record.status === 'error'));
  assert.equal(database(context.path, db => db.prepare('SELECT COUNT(*) AS count FROM frames').get().count), 1);
  assert.equal(database(context.path, db => db.prepare('SELECT frame_count FROM sessions WHERE id = ?').get(current.id).frame_count), 0);
  assert.equal((await exportedRows(store.download(previous.id)))[0].frame.sequence, 10);
  assert.deepEqual(await exportedRows(store.download(current.id)), []);
  await store.close();
  const reopened = await context.open();
  const saved = reopened.list().find(record => record.id === current.id);
  assert.equal(saved.status, 'error');
  assert.equal(saved.frameCount, 0);
  assert.equal(saved.error.code, 'RECORDING_WRITE_FAILED');
});

test('restart recovers a process that exited after committing frames but before stopping', async (t) => {
  const context = await fixture(t);
  const moduleUrl = new URL('../node/recording.js', import.meta.url).href;
  const childSource = `
    import { setTimeout as delay } from 'node:timers/promises';
    import { createRecordingStore } from ${JSON.stringify(moduleUrl)};
    const store = await createRecordingStore({ directory: process.argv[1] });
    await store.start({ label: '异常退出前的记录', source: 'crash-test' });
    for (const frame of ${JSON.stringify([frame(7), frame(8)])}) store.append(frame);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (store.status().frameCount === 2) {
        process.stdout.write(JSON.stringify(store.status()), () => process.exit(0));
        break; // 模拟真实进程退出：故意不调用 stop 或 close。
      }
      await delay(20);
    }
    if (store.status().frameCount !== 2) throw new Error('frames were not committed');
  `;
  const { stdout } = await runFile(process.execPath, ['--input-type=module', '--eval', childSource, context.directory], {
    windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024,
  });
  const abandoned = JSON.parse(stdout);
  assert.equal(abandoned.status, 'recording');
  const store = await context.open();
  const recovered = store.list().find(record => record.id === abandoned.id);
  assert.equal(recovered.status, 'error');
  assert.equal(recovered.error.code, 'RECORDING_INTERRUPTED');
  assert.equal(recovered.frameCount, 2);
  assert.ok(recovered.endedAt >= recovered.startedAt);
  assert.deepEqual((await exportedRows(store.download(abandoned.id))).map(row => row.frame.sequence), [7, 8]);
  await store.start({ label: '恢复后新记录' });
  store.append(frame(9));
  assert.equal((await store.stop()).status, 'stopped');
});

test('SQLite exports select the exact UUID and release an interrupted export', async (t) => {
  const context = await fixture(t);
  const store = await context.open();
  const sessions = [];
  for (const sequence of [41, 82]) {
    const started = await store.start({ label: '重复 "标签",中文', source: 'test' });
    store.append(frame(sequence));
    store.append(frame(sequence + 1));
    await store.stop();
    sessions.push(started);
  }
  assert.notEqual(sessions[0].id, sessions[1].id);
  for (const [index, session] of sessions.entries()) {
    const descriptor = store.download(session.id);
    const rows = await exportedRows(descriptor);
    assert.deepEqual(rows.map(row => row.frame.sequence), index === 0 ? [41, 42] : [82, 83]);
    assert.ok(rows.every(row => row.sessionId === session.id));
    const csv = await exportedText(recordingCsv(descriptor));
    assert.ok(csv.startsWith('\ufeff"sessionId","label","index"'));
    assert.match(csv, /重复 ""标签"",中文/);
    assert.ok(csv.includes(session.id));
    assert.ok(!csv.includes(sessions[1 - index].id));
  }
  const partial = recordingJsonl(store.download(sessions[0].id));
  assert.equal((await partial.next()).done, false);
  await partial.return(); // HTTP 取消下载时必须走迭代器 finally。
  await store.close();
  assert.equal(database(context.path, db => db.pragma('integrity_check', { simple: true })), 'ok');
  const reopened = await context.open();
  assert.equal(reopened.list().length, 2);
});

test('a paused export of an immutable recording does not pin the WAL for later recordings', async (t) => {
  const context = await fixture(t);
  const store = await context.open();
  const old = await store.start({ label: '慢速下载的旧记录' });
  store.append(frame(1));
  store.append(frame(2));
  await store.stop();
  const download = recordingJsonl(store.download(old.id));
  try {
    assert.equal((await download.next()).done, false);
    await store.start({ label: '下载时继续采集' });
    store.append(frame(3));
    store.append(frame(4));
    await store.stop();
    const checkpoint = database(context.path, db => db.pragma('wal_checkpoint(PASSIVE)')[0], {});
    assert.equal(checkpoint.busy, 0);
    assert.equal(checkpoint.checkpointed, checkpoint.log, '慢速导出不能保持旧读事务、阻挡新采集的 WAL 回收');
  } finally {
    await download.return();
  }
});

test('existing JSONL recordings remain readable without rewriting their source files', async (t) => {
  const context = await fixture(t);
  const id = '12345678-1234-4234-8234-123456789abc';
  const meta = { id, label: '旧记录', startedAt: 1, endedAt: 3, frameCount: 2, status: 'stopped' };
  const rows = [frame(1), frame(2)].map((value, index) => ({ schema: 'shroom.frame.v1', sessionId: id,
    label: meta.label, index, timestamp: value.timestamp, source: 'test', frame: value }));
  const metaText = JSON.stringify(meta);
  const dataText = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const metaPath = join(context.directory, `${id}.meta.json`);
  const dataPath = join(context.directory, `${id}.jsonl`);
  await writeFile(metaPath, metaText, 'utf8');
  await writeFile(dataPath, dataText, 'utf8');
  const store = await context.open();
  assert.deepEqual(store.list().find(record => record.id === id), meta);
  const descriptor = store.download(id);
  assert.equal(descriptor.format, 'jsonl');
  assert.equal(await exportedText(recordingJsonl(descriptor)), dataText);
  assert.match(await exportedText(recordingCsv(descriptor)), /旧记录/);
  await store.start({ label: '新记录' });
  store.append(frame(3));
  await store.stop();
  assert.equal(store.list().length, 2);
  assert.equal(database(context.path, db => db.prepare('SELECT COUNT(*) AS count FROM frames').get().count), 1);
  await store.close();
  assert.equal(await readFile(metaPath, 'utf8'), metaText);
  assert.equal(await readFile(dataPath, 'utf8'), dataText);
});
