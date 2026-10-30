/** 手套标准分区：每指 4×3 主体与独立指腹，手掌按真实行长输出 72 点。 */
import { ShroomError } from './errors.js';
import { validateDecodeOptions } from './serial-config.js';

// 产品方提供的分区表：编号从 1 开始，指向原始扫描通道，而非旧展示矩阵的坐标。
const gloveRegionsLayouts = {
  left: {
    little: { name: '小拇指', indices: [[31, 30, 29], [15, 14, 13], [255, 254, 253], [239, 238, 237]], pulpIndices: [[222]] },
    ring: { name: '无名指', indices: [[28, 27, 26], [12, 11, 10], [252, 251, 250], [236, 235, 234]], pulpIndices: [[219]] },
    middle: { name: '中指', indices: [[25, 24, 23], [9, 8, 7], [249, 248, 247], [233, 232, 231]], pulpIndices: [[216]] },
    index: { name: '食指', indices: [[22, 21, 20], [6, 5, 4], [246, 245, 244], [230, 229, 228]], pulpIndices: [[213]] },
    thumb: { name: '大拇指', indices: [[19, 18, 17], [3, 2, 1], [243, 242, 241], [227, 226, 225]], pulpIndices: [[210]] },
    palm: {
      name: '手掌',
      indices: [
        [207, 206, 205, 204, 203, 202, 201, 200, 199, 198, 197, 196],
        [191, 190, 189, 188, 187, 186, 185, 184, 183, 182, 181, 180, 179, 178, 177],
        [175, 174, 173, 172, 171, 170, 169, 168, 167, 166, 165, 164, 163, 162, 161],
        [159, 158, 157, 156, 155, 154, 153, 152, 151, 150, 149, 148, 147, 146, 145],
        [143, 142, 141, 140, 139, 138, 137, 136, 135, 134, 133, 132, 131, 130, 129],
      ],
    },
  },
  right: {
    thumb: { name: '大拇指', indices: [[240, 239, 238], [256, 255, 254], [16, 15, 14], [32, 31, 30]], pulpIndices: [[47]] },
    index: { name: '食指', indices: [[237, 236, 235], [253, 252, 251], [13, 12, 11], [29, 28, 27]], pulpIndices: [[44]] },
    middle: { name: '中指', indices: [[234, 233, 232], [250, 249, 248], [10, 9, 8], [26, 25, 24]], pulpIndices: [[41]] },
    ring: { name: '无名指', indices: [[231, 230, 229], [247, 246, 245], [7, 6, 5], [23, 22, 21]], pulpIndices: [[38]] },
    little: { name: '小拇指', indices: [[228, 227, 226], [244, 243, 242], [4, 3, 2], [20, 19, 18]], pulpIndices: [[35]] },
    palm: {
      name: '手掌',
      indices: [
        [61, 60, 59, 58, 57, 56, 55, 54, 53, 52, 51, 50],
        [80, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69, 68, 67, 66],
        [96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82],
        [112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100, 99, 98],
        [128, 127, 126, 125, 124, 123, 122, 121, 120, 119, 118, 117, 116, 115, 114],
      ],
    },
  },
};

/** 按分区行表读取压力；对外 sourceIndices 转为从 0 开始的原始通道下标。 */
function gloveRegionsRead(name, indices, cols, pressure, fullScale) {
  const sourceIndices = Uint16Array.from(indices.flat(), (position) => position - 1);
  const raw = Uint8Array.from(sourceIndices, (position) => pressure[position]);
  let offset = 0;
  // matrix 的每行独立复制 ADC 值；修改扁平 raw 数组不会反向改变 matrix。
  const matrix = indices.map((row) => {
    const values = Array.from(raw.subarray(offset, offset + row.length));
    offset += row.length;
    return values;
  });
  return {
    name, rows: indices.length, cols, rowLengths: indices.map((row) => row.length),
    sourceIndices, raw, values: Float32Array.from(raw, (value) => value / fullScale), matrix,
  };
}

/**
 * 提取命名五指、独立指腹与行长不齐的手掌；0 是有效测量值，不能据此删除触点。
 * 各输出数组为独立可写快照；values = raw / fullScale，不做物理量标定或截断。
 * @param {Uint8Array} pressure 严格为 256 字节、保持原始扫描顺序的 ADC 数据。
 * @param {{side:'left'|'right',fullScale?:number}} options 明确实物手侧，fullScale 默认 255。
 * @returns {object} fingers 五指对象与 palm；手掌 rowLengths 为 [12,15,15,15,15]，不补齐空点。
 */
export function createGloveRegions(pressure, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || !['left', 'right'].includes(options.side)) {
    throw new ShroomError('INVALID_CONFIG', '手套分区需要明确指定 side 为 left 或 right', {
      stage: 'configure', details: { field: 'side' },
    });
  }
  const { fullScale = 255 } = validateDecodeOptions(options);
  if (!(pressure instanceof Uint8Array) || pressure.length !== 256) {
    throw new ShroomError('PARSE_FAILED', '手套分区需要 256 字节的原始扫描压力数据', {
      stage: 'parse', details: { expectedLength: 256, actualLength: pressure?.length },
    });
  }
  const layout = gloveRegionsLayouts[options.side];
  const fingers = {};
  for (const key of ['thumb', 'index', 'middle', 'ring', 'little']) {
    const finger = layout[key];
    fingers[key] = {
      ...gloveRegionsRead(finger.name, finger.indices, 3, pressure, fullScale),
      pulp: gloveRegionsRead(`${finger.name}指腹`, finger.pulpIndices, 1, pressure, fullScale),
    };
  }
  return { fingers, palm: gloveRegionsRead(layout.palm.name, layout.palm.indices, 15, pressure, fullScale) };
}
