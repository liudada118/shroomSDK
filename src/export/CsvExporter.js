const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function safeFileName(value) {
  return String(value || 'capture')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '_');
}

function getTitles(language = 'zh') {
  const isEnglish = String(language).toLowerCase().startsWith('en');
  if (isEnglish) {
    return {
      index: 'index',
      seconds: 'seconds',
      timestamp: 'timestamp',
      channel: 'channel',
      max: 'max',
      min: 'min',
      mean: 'mean',
      total: 'total',
      point: 'points',
      data: 'data',
      rotate: 'rotate',
      rawFrame: 'rawFrameHex',
      extra: 'extra',
    };
  }

  return {
    index: '序号',
    seconds: '秒数',
    timestamp: '时间戳',
    channel: '通道',
    max: '最大值',
    min: '最小值',
    mean: '平均值',
    total: '总和',
    point: '点数',
    data: '矩阵数据',
    rotate: '姿态数据',
    rawFrame: '原始帧HEX',
    extra: '附加信息',
  };
}

class CsvExporter {
  constructor({ store, exportDir } = {}) {
    if (!store) {
      throw new Error('store is required');
    }
    this.store = store;
    this.exportDir = exportDir || path.join(process.cwd(), 'data');
    ensureDir(this.exportDir);
  }

  async exportCapture(options = {}) {
    const rows = this.store.queryFrames(options);
    if (!rows.length) {
      throw new Error('no capture frames found');
    }

    const titles = getTitles(options.language || options.locale);
    const captureName = rows[0].capture_name || options.captureName || options.captureId;
    const sensorType = options.sensorType || rows[0].sensor_type || 'sensor';
    const outputPath = options.outputPath || path.join(
      options.exportDir || this.exportDir,
      `${safeFileName(sensorType)}_${safeFileName(captureName)}.csv`,
    );
    ensureDir(path.dirname(outputPath));

    const baseTimestamp = Number(rows[0].timestamp) || Date.now();
    const records = rows.map((row, index) => {
      const data = parseJson(row.data_json, []);
      const stats = parseJson(row.stats_json, {});
      const extra = parseJson(row.extra_json, {});
      const timestamp = Number(row.timestamp) || baseTimestamp;

      return {
        index: index + 1,
        seconds: ((timestamp - baseTimestamp) / 1000).toFixed(3),
        timestamp,
        channel: row.channel,
        max: stats.max ?? '',
        min: stats.min ?? '',
        mean: stats.mean ?? '',
        total: stats.total ?? '',
        point: stats.point ?? '',
        data: JSON.stringify(data),
        rotate: JSON.stringify(extra.rotate || []),
        rawFrame: row.raw_frame_hex || '',
        extra: JSON.stringify(extra.extra || {}),
      };
    });

    const writer = createCsvWriter({
      path: outputPath,
      header: [
        { id: 'index', title: titles.index },
        { id: 'seconds', title: titles.seconds },
        { id: 'timestamp', title: titles.timestamp },
        { id: 'channel', title: titles.channel },
        { id: 'max', title: titles.max },
        { id: 'min', title: titles.min },
        { id: 'mean', title: titles.mean },
        { id: 'total', title: titles.total },
        { id: 'point', title: titles.point },
        { id: 'data', title: titles.data },
        { id: 'rotate', title: titles.rotate },
        { id: 'rawFrame', title: titles.rawFrame },
        { id: 'extra', title: titles.extra },
      ],
    });

    await writer.writeRecords(records);
    return {
      files: [outputPath],
      rows: records.length,
      dir: path.dirname(outputPath),
    };
  }
}

module.exports = {
  CsvExporter,
};
