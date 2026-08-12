/**
 * 把传感器物理坐标矩阵转换成 SVG 可直接使用的点布局。
 * 数据索引始终按 row-major 规则对应 `row * cols + col`。
 *
 * @param {object | number[][][]} coordinateMap 坐标定义。
 * @returns {object | null} 有效布局；坐标无效时返回 null，供渲染器回退到规则矩阵。
 */
export function buildCoordinatePointLayout(coordinateMap) {
  const coordinates = Array.isArray(coordinateMap)
    ? coordinateMap
    : coordinateMap?.coordinates;
  if (!Array.isArray(coordinates) || !coordinates.length || !Array.isArray(coordinates[0])) {
    return null;
  }

  const rows = coordinates.length;
  const cols = coordinates[0].length;
  if (!cols) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const rawPoints = [];
  const neighborDistances = [];

  for (let row = 0; row < rows; row += 1) {
    if (!Array.isArray(coordinates[row]) || coordinates[row].length !== cols) return null;
    for (let col = 0; col < cols; col += 1) {
      const coordinate = coordinates[row][col];
      const x = Number(coordinate?.[0]);
      const y = Number(coordinate?.[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      rawPoints.push({ index: row * cols + col, row, col, x, y });

      const left = col > 0 ? coordinates[row][col - 1] : null;
      const above = row > 0 ? coordinates[row - 1][col] : null;
      [left, above].forEach((neighbor) => {
        if (!neighbor) return;
        const distance = Math.hypot(x - Number(neighbor[0]), y - Number(neighbor[1]));
        if (Number.isFinite(distance) && distance > 0) neighborDistances.push(distance);
      });
    }
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;

  neighborDistances.sort((left, right) => left - right);
  // 取较小一侧的典型间距，避免长方形点阵在短边方向发生圆点重叠。
  const neighborDistance = neighborDistances.length
    ? neighborDistances[Math.floor(neighborDistances.length * 0.1)]
    : Math.min(width / Math.max(cols - 1, 1), height / Math.max(rows - 1, 1));
  const radius = Math.max(neighborDistance * 0.32, Math.min(width, height) * 0.002);
  const padding = radius * 1.5;
  const viewWidth = width + padding * 2;
  const viewHeight = height + padding * 2;

  return {
    rows,
    cols,
    pointCount: rawPoints.length,
    points: rawPoints.map((point) => ({
      ...point,
      displayX: point.x - minX + padding,
      displayY: maxY - point.y + padding,
    })),
    bounds: { minX, maxX, minY, maxY, width, height },
    radius,
    padding,
    viewBox: `0 0 ${viewWidth} ${viewHeight}`,
    aspectRatio: viewWidth / viewHeight,
  };
}

/**
 * 将物理坐标布局转换为现有 Three.js 场景可直接使用的世界坐标。
 *
 * 长边固定到指定范围，短边按原始比例缩放，因此长条形、手形等异形传感器
 * 不会被强制拉伸成方形。每个世界坐标点仍保留原始 row-major 数据索引。
 *
 * @param {object | number[][][]} coordinateMap 传感器物理坐标定义。
 * @param {object} options 转换选项。
 * @param {number} [options.extent=1.8] 世界坐标长边范围。
 * @returns {object | null} Three.js 世界坐标布局。
 */
export function buildCoordinateWorldLayout(coordinateMap, { extent = 1.8 } = {}) {
  const layout = buildCoordinatePointLayout(coordinateMap);
  if (!layout) return null;

  const longestSide = Math.max(layout.bounds.width, layout.bounds.height);
  const safeExtent = Number.isFinite(Number(extent)) && Number(extent) > 0
    ? Number(extent)
    : 1.8;
  const scale = safeExtent / longestSide;
  const centerX = (layout.bounds.minX + layout.bounds.maxX) / 2;
  const centerY = (layout.bounds.minY + layout.bounds.maxY) / 2;

  return {
    ...layout,
    worldCellSize: Math.max(layout.radius * 2 * scale, safeExtent * 0.004),
    points: layout.points.map((point) => ({
      ...point,
      worldX: (point.x - centerX) * scale,
      worldY: (point.y - centerY) * scale,
    })),
  };
}
