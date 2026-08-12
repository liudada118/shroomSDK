/**
 * TerrainMapPage - 3D压力地形图
 * 追效果图：润滑材质、高光反射、青绿→黄→橙渐变、深色底板
 * 添加插值/高斯平滑控制按钮
 */
import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
// postprocessing removed for performance
import * as THREE from 'three';
import { Link } from 'wouter';
import { ArrowLeft, Hand, Settings2, Bluetooth, BluetoothOff, Eye, EyeOff, PanelLeftClose, PanelRightClose } from 'lucide-react';
import { mapGloveToMatrix, generateSimGloveData, DEFAULT_REGION_MAP, type RegionName, type RegionRect } from '@/lib/gloveToMatrixMap';
import { serialManager, type ConnectionState, type ParsedFrame } from '@/lib/serial';

// ============ 32×32 真实数据（CSV第一帧） ============
const SAMPLE_MATRIX: number[] = [
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,22,118,44,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,41,124,105,27,0,0,0,0,43,80,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,76,137,94,0,0,0,12,93,144,95,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,39,0,0,0,0,0,0,17,143,165,44,0,0,0,38,156,112,130,5,0,0,0,0,0,0,0,
  0,0,0,0,0,0,108,47,0,0,0,0,0,17,80,102,0,0,0,0,75,163,111,64,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,89,61,0,0,0,0,0,45,95,52,0,0,0,16,104,66,0,0,0,0,0,0,7,0,0,0,
  0,0,0,0,0,0,80,43,0,0,0,0,0,91,105,0,0,0,0,100,125,67,0,0,0,0,0,33,52,0,0,0,
  0,0,0,0,0,0,80,65,0,0,0,0,0,81,38,0,0,0,56,99,52,13,0,0,0,5,57,164,95,17,0,0,
  0,0,0,0,0,0,80,104,27,0,0,0,43,117,55,0,0,30,99,98,28,0,0,9,5,27,153,144,93,9,0,0,
  0,0,0,0,0,0,83,97,0,0,0,0,20,34,0,0,0,83,88,58,8,0,0,0,18,102,108,83,17,0,0,0,
  0,0,0,0,0,0,34,61,21,0,0,0,0,21,0,0,0,39,22,0,0,0,0,61,111,103,11,0,0,0,0,0,
  0,0,0,0,0,0,0,39,0,0,0,0,0,0,0,0,0,0,0,0,0,0,18,100,64,33,8,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,40,85,126,21,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,21,0,0,0,0,0,0,20,39,84,47,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,23,0,16,0,0,11,112,71,55,44,36,16,12,44,13,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,25,61,34,28,11,0,15,89,38,39,62,140,29,31,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,59,77,69,53,7,0,0,27,22,75,92,92,94,56,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,21,127,102,105,72,10,0,0,17,32,70,73,113,68,16,0,0,0,0,0,0,0,0,0,0,0,0,
  3,0,0,0,4,63,160,124,97,103,26,0,0,21,0,32,76,81,24,0,0,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,11,131,150,134,141,139,15,0,0,0,0,0,80,60,14,0,0,0,0,0,0,0,0,0,0,0,0,0,
  4,0,0,0,15,127,149,126,126,116,11,0,0,0,0,32,90,68,0,0,0,0,0,0,0,0,0,48,11,21,5,0,
  3,0,0,0,16,111,157,152,155,120,35,0,0,21,44,49,76,58,34,12,0,0,0,0,0,0,92,123,139,91,31,6,
  4,0,0,0,14,98,137,143,145,130,25,0,9,27,58,73,80,50,52,16,0,0,0,0,0,7,92,113,68,19,4,4,
  4,0,0,0,32,130,145,135,141,108,27,18,25,69,95,70,100,103,74,43,8,0,0,0,0,0,8,0,0,0,0,0,
  3,0,0,0,19,86,125,139,113,113,61,50,69,108,68,112,113,137,128,104,44,0,0,0,0,0,0,0,0,0,0,0,
  2,0,0,0,9,97,123,135,108,147,72,73,107,149,99,127,112,118,143,139,87,13,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,4,71,125,83,83,114,116,83,116,137,126,114,110,103,114,122,45,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,76,97,87,82,71,85,122,135,146,124,103,127,120,51,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,25,0,0,28,57,133,140,118,133,102,67,70,19,12,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,9,29,78,58,49,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
];

const GRID_SIZE = 32;
const MAX_ADC = 170;

// ============ 配色方案定义 ============
type ColorStop = { t: number; r: number; g: number; b: number };

const COLOR_SCHEMES: Record<string, { name: string; stops: ColorStop[] }> = {
  terrain: {
    name: 'Terrain',
    stops: [
      { t: 0.0, r: 0.0, g: 0.08, b: 0.18 },     // 深暗青蓝
      { t: 0.06, r: 0.0, g: 0.28, b: 0.52 },    // 青蓝
      { t: 0.14, r: 0.0, g: 0.55, b: 0.7 },     // 亮青蓝发光
      { t: 0.22, r: 0.0, g: 0.7, b: 0.55 },     // 青绿
      { t: 0.32, r: 0.1, g: 0.78, b: 0.25 },    // 绿
      { t: 0.42, r: 0.45, g: 0.82, b: 0.05 },   // 黄绿
      { t: 0.52, r: 0.78, g: 0.75, b: 0.0 },    // 金黄
      { t: 0.62, r: 0.95, g: 0.6, b: 0.0 },     // 金橙
      { t: 0.72, r: 1.0, g: 0.4, b: 0.0 },      // 橙
      { t: 0.82, r: 1.0, g: 0.25, b: 0.0 },     // 深橙
      { t: 0.92, r: 1.0, g: 0.15, b: 0.0 },     // 红橙
      { t: 1.0, r: 1.0, g: 0.08, b: 0.0 },      // 红（顶峰发光）
    ],
  },
  ocean: {
    name: 'Ocean',
    stops: [
      { t: 0.0, r: 0.0, g: 0.02, b: 0.08 },
      { t: 0.15, r: 0.0, g: 0.1, b: 0.3 },
      { t: 0.3, r: 0.0, g: 0.3, b: 0.6 },
      { t: 0.45, r: 0.0, g: 0.55, b: 0.8 },
      { t: 0.6, r: 0.2, g: 0.75, b: 0.9 },
      { t: 0.75, r: 0.5, g: 0.9, b: 0.95 },
      { t: 0.9, r: 0.8, g: 0.95, b: 1.0 },
      { t: 1.0, r: 1.0, g: 1.0, b: 1.0 },
    ],
  },
  magma: {
    name: 'Magma',
    stops: [
      { t: 0.0, r: 0.0, g: 0.0, b: 0.02 },
      { t: 0.15, r: 0.15, g: 0.0, b: 0.3 },
      { t: 0.3, r: 0.4, g: 0.0, b: 0.5 },
      { t: 0.45, r: 0.7, g: 0.1, b: 0.4 },
      { t: 0.6, r: 0.9, g: 0.25, b: 0.15 },
      { t: 0.75, r: 1.0, g: 0.5, b: 0.0 },
      { t: 0.9, r: 1.0, g: 0.8, b: 0.2 },
      { t: 1.0, r: 1.0, g: 1.0, b: 0.6 },
    ],
  },
  viridis: {
    name: 'Viridis',
    stops: [
      { t: 0.0, r: 0.27, g: 0.0, b: 0.33 },
      { t: 0.15, r: 0.28, g: 0.14, b: 0.47 },
      { t: 0.3, r: 0.2, g: 0.3, b: 0.55 },
      { t: 0.45, r: 0.13, g: 0.47, b: 0.52 },
      { t: 0.6, r: 0.15, g: 0.62, b: 0.42 },
      { t: 0.75, r: 0.45, g: 0.77, b: 0.22 },
      { t: 0.9, r: 0.8, g: 0.88, b: 0.1 },
      { t: 1.0, r: 0.99, g: 0.91, b: 0.15 },
    ],
  },
  thermal: {
    name: 'Thermal',
    stops: [
      { t: 0.0, r: 0.0, g: 0.0, b: 0.0 },
      { t: 0.2, r: 0.2, g: 0.0, b: 0.5 },
      { t: 0.4, r: 0.6, g: 0.0, b: 0.4 },
      { t: 0.55, r: 0.9, g: 0.1, b: 0.1 },
      { t: 0.7, r: 1.0, g: 0.4, b: 0.0 },
      { t: 0.85, r: 1.0, g: 0.75, b: 0.0 },
      { t: 1.0, r: 1.0, g: 1.0, b: 0.8 },
    ],
  },
  inferno: {
    name: 'Inferno',
    stops: [
      { t: 0.0, r: 0.0, g: 0.0, b: 0.02 },
      { t: 0.12, r: 0.1, g: 0.02, b: 0.2 },
      { t: 0.25, r: 0.3, g: 0.02, b: 0.45 },
      { t: 0.38, r: 0.55, g: 0.05, b: 0.45 },
      { t: 0.5, r: 0.75, g: 0.15, b: 0.3 },
      { t: 0.62, r: 0.9, g: 0.3, b: 0.1 },
      { t: 0.75, r: 0.98, g: 0.55, b: 0.0 },
      { t: 0.88, r: 0.98, g: 0.8, b: 0.15 },
      { t: 1.0, r: 0.98, g: 0.98, b: 0.65 },
    ],
  },
  plasma: {
    name: 'Plasma',
    stops: [
      { t: 0.0, r: 0.05, g: 0.02, b: 0.53 },
      { t: 0.15, r: 0.3, g: 0.0, b: 0.63 },
      { t: 0.3, r: 0.55, g: 0.0, b: 0.6 },
      { t: 0.45, r: 0.75, g: 0.1, b: 0.45 },
      { t: 0.6, r: 0.9, g: 0.25, b: 0.25 },
      { t: 0.75, r: 0.98, g: 0.48, b: 0.05 },
      { t: 0.9, r: 0.95, g: 0.75, b: 0.0 },
      { t: 1.0, r: 0.94, g: 0.97, b: 0.13 },
    ],
  },
  rainbow: {
    name: 'Rainbow',
    stops: [
      { t: 0.0, r: 0.5, g: 0.0, b: 1.0 },
      { t: 0.17, r: 0.0, g: 0.0, b: 1.0 },
      { t: 0.33, r: 0.0, g: 0.8, b: 1.0 },
      { t: 0.5, r: 0.0, g: 1.0, b: 0.2 },
      { t: 0.67, r: 1.0, g: 1.0, b: 0.0 },
      { t: 0.83, r: 1.0, g: 0.4, b: 0.0 },
      { t: 1.0, r: 1.0, g: 0.0, b: 0.0 },
    ],
  },
  sunset: {
    name: 'Sunset',
    stops: [
      { t: 0.0, r: 0.05, g: 0.0, b: 0.15 },
      { t: 0.2, r: 0.15, g: 0.0, b: 0.35 },
      { t: 0.35, r: 0.4, g: 0.0, b: 0.5 },
      { t: 0.5, r: 0.7, g: 0.1, b: 0.4 },
      { t: 0.65, r: 0.9, g: 0.25, b: 0.2 },
      { t: 0.8, r: 1.0, g: 0.5, b: 0.1 },
      { t: 0.9, r: 1.0, g: 0.75, b: 0.3 },
      { t: 1.0, r: 1.0, g: 0.95, b: 0.6 },
    ],
  },
  neon: {
    name: 'Neon',
    stops: [
      { t: 0.0, r: 0.0, g: 0.0, b: 0.0 },
      { t: 0.15, r: 0.0, g: 0.1, b: 0.3 },
      { t: 0.3, r: 0.0, g: 0.8, b: 0.4 },
      { t: 0.45, r: 0.0, g: 1.0, b: 0.8 },
      { t: 0.6, r: 0.5, g: 1.0, b: 0.0 },
      { t: 0.75, r: 1.0, g: 0.9, b: 0.0 },
      { t: 0.88, r: 1.0, g: 0.2, b: 0.5 },
      { t: 1.0, r: 1.0, g: 0.0, b: 1.0 },
    ],
  },
  ice: {
    name: 'Ice',
    stops: [
      { t: 0.0, r: 0.0, g: 0.02, b: 0.08 },
      { t: 0.2, r: 0.0, g: 0.1, b: 0.25 },
      { t: 0.4, r: 0.1, g: 0.3, b: 0.55 },
      { t: 0.55, r: 0.3, g: 0.55, b: 0.75 },
      { t: 0.7, r: 0.55, g: 0.78, b: 0.9 },
      { t: 0.85, r: 0.8, g: 0.92, b: 0.98 },
      { t: 1.0, r: 1.0, g: 1.0, b: 1.0 },
    ],
  },
};

function getTerrainColor(normalizedValue: number, scheme: string = 'terrain'): [number, number, number] {
  const stops = COLOR_SCHEMES[scheme]?.stops || COLOR_SCHEMES.terrain.stops;
  const t = Math.max(0, Math.min(1, normalizedValue));
  let lower = stops[0], upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const range = upper.t - lower.t;
  const factor = range > 0 ? (t - lower.t) / range : 0;
  return [
    lower.r + (upper.r - lower.r) * factor,
    lower.g + (upper.g - lower.g) * factor,
    lower.b + (upper.b - lower.b) * factor,
  ];
}

// ============ 高斯模糊 ============
function gaussianBlur(matrix: number[][], size: number, sigma: number): number[][] {
  const kernel = createGaussianKernel(sigma);
  const kSize = kernel.length;
  const half = Math.floor(kSize / 2);
  const result: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));

  // 水平pass
  const temp: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, wSum = 0;
      for (let k = -half; k <= half; k++) {
        const px = Math.max(0, Math.min(size - 1, x + k));
        const w = kernel[k + half];
        sum += matrix[y][px] * w;
        wSum += w;
      }
      temp[y][x] = sum / wSum;
    }
  }
  // 垂直pass
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, wSum = 0;
      for (let k = -half; k <= half; k++) {
        const py = Math.max(0, Math.min(size - 1, y + k));
        const w = kernel[k + half];
        sum += temp[py][x] * w;
        wSum += w;
      }
      result[y][x] = sum / wSum;
    }
  }
  return result;
}

function createGaussianKernel(sigma: number): number[] {
  const size = Math.ceil(sigma * 3) * 2 + 1;
  const kernel: number[] = [];
  const s2 = 2 * sigma * sigma;
  for (let i = 0; i < size; i++) {
    const x = i - Math.floor(size / 2);
    kernel.push(Math.exp(-(x * x) / s2));
  }
  return kernel;
}

// ============ 双三次插值 ============
function bicubicInterpolate(matrix: number[][], size: number, upscale: number): number[][] {
  const outSize = size * upscale;
  const result: number[][] = Array.from({ length: outSize }, () => new Array(outSize).fill(0));

  for (let oy = 0; oy < outSize; oy++) {
    for (let ox = 0; ox < outSize; ox++) {
      const srcX = (ox / (outSize - 1)) * (size - 1);
      const srcY = (oy / (outSize - 1)) * (size - 1);
      const ix = Math.floor(srcX);
      const iy = Math.floor(srcY);
      const fx = srcX - ix;
      const fy = srcY - iy;

      let sum = 0, weightSum = 0;
      for (let dy = -1; dy <= 2; dy++) {
        for (let dx = -1; dx <= 2; dx++) {
          const px = Math.max(0, Math.min(size - 1, ix + dx));
          const py = Math.max(0, Math.min(size - 1, iy + dy));
          const wx = cubicWeight(fx - dx);
          const wy = cubicWeight(fy - dy);
          const w = wx * wy;
          sum += matrix[py][px] * w;
          weightSum += w;
        }
      }
      result[oy][ox] = Math.max(0, weightSum > 0 ? sum / weightSum : 0);
    }
  }
  return result;
}

function cubicWeight(t: number): number {
  const a = -0.5;
  const at = Math.abs(t);
  if (at <= 1) return (a + 2) * at * at * at - (a + 3) * at * at + 1;
  if (at < 2) return a * at * at * at - 5 * a * at * at + 8 * a * at - 4 * a;
  return 0;
}

// ============ 3D地形网格组件（磨砂自发光+网格线叠加） ============
function TerrainMesh({ matrix, interpolation, gaussSigma, showWireframe, gain, wireWidth = 1.5, colorScheme = 'terrain', baseResolution = 32 }: { matrix: number[]; interpolation: number; gaussSigma: number; showWireframe: boolean; gain: number; wireWidth?: number; colorScheme?: string; baseResolution?: 32 | 64 }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.LineSegments>(null);

  const { geometry, wireGeo } = useMemo(() => {
    // 如果baseResolution=64，先将32x32插值到64x64
    let srcSize = GRID_SIZE;
    let grid2D: number[][] = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      grid2D.push(matrix.slice(i * GRID_SIZE, (i + 1) * GRID_SIZE));
    }
    if (baseResolution === 64) {
      grid2D = bicubicInterpolate(grid2D, GRID_SIZE, 2);
      srcSize = 64;
    }

    // 高斯模糊
    if (gaussSigma > 0) {
      grid2D = gaussianBlur(grid2D, srcSize, gaussSigma);
    }

    // 双三次插值上采样
    const smoothed = bicubicInterpolate(grid2D, srcSize, interpolation);
    const meshSize = srcSize * interpolation;

    // 创建几何体
    const geo = new THREE.PlaneGeometry(10, 10, meshSize - 1, meshSize - 1);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const heightScale = 4.8;

    for (let i = 0; i < positions.count; i++) {
      const ix = i % meshSize;
      const iy = Math.floor(i / meshSize);
      const value = smoothed[iy][ix];
      const normalized = Math.min((value * gain) / MAX_ADC, 1);

      // 高度
      positions.setY(i, normalized * heightScale);

      // 颜色（自发光感：颜色本身就亮，不依赖光照反射）
      const [r, g, b] = getTerrainColor(normalized, colorScheme);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // 网格线几何体 —— 只在有压力数据的区域生成线段
    const wireSegments: number[] = [];
    const WIRE_THRESHOLD = 0.01; // 归一化阈值，低于此不画线
    const wireGridSize = srcSize; // 网格线密度跟随基础分辨率

    for (let iy = 0; iy < wireGridSize; iy++) {
      for (let ix = 0; ix < wireGridSize; ix++) {
        const sx = Math.round((ix / (wireGridSize - 1)) * (meshSize - 1));
        const sy = Math.round((iy / (wireGridSize - 1)) * (meshSize - 1));
        const value = smoothed[Math.min(sy, meshSize - 1)][Math.min(sx, meshSize - 1)];
        const normalized = Math.min((value * gain) / MAX_ADC, 1);

        if (normalized < WIRE_THRESHOLD) continue;

        const x0 = (ix / (wireGridSize - 1) - 0.5) * 10;
        const z0 = (iy / (wireGridSize - 1) - 0.5) * 10;
        const y0 = normalized * heightScale + 0.03;

        // 右邻居
        if (ix < wireGridSize - 1) {
          const sx2 = Math.round(((ix + 1) / (wireGridSize - 1)) * (meshSize - 1));
          const val2 = smoothed[Math.min(sy, meshSize - 1)][Math.min(sx2, meshSize - 1)];
          const norm2 = Math.min((val2 * gain) / MAX_ADC, 1);
          if (norm2 >= WIRE_THRESHOLD) {
            const x1 = ((ix + 1) / (wireGridSize - 1) - 0.5) * 10;
            const y1 = norm2 * heightScale + 0.03;
            wireSegments.push(x0, y0, z0, x1, y1, z0);
          }
        }
        // 下邻居
        if (iy < wireGridSize - 1) {
          const sy2 = Math.round(((iy + 1) / (wireGridSize - 1)) * (meshSize - 1));
          const val2 = smoothed[Math.min(sy2, meshSize - 1)][Math.min(sx, meshSize - 1)];
          const norm2 = Math.min((val2 * gain) / MAX_ADC, 1);
          if (norm2 >= WIRE_THRESHOLD) {
            const z1 = ((iy + 1) / (wireGridSize - 1) - 0.5) * 10;
            const y1 = norm2 * heightScale + 0.03;
            wireSegments.push(x0, y0, z0, x0, y1, z1);
          }
        }
      }
    }

    const wireGeoObj = new THREE.BufferGeometry();
    wireGeoObj.setAttribute('position', new THREE.Float32BufferAttribute(wireSegments, 3));

    return { geometry: geo, wireGeo: wireGeoObj };
  }, [matrix, interpolation, gaussSigma, gain, colorScheme, baseResolution]);

  return (
    <group>
      {/* 主表面：meshBasicMaterial不受光照影响，直接显示饱和的顶点颜色 */}
      <mesh ref={meshRef} geometry={geometry}>
        <meshBasicMaterial
          vertexColors
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {/* 网格线叠加层 —— 只在有压力的区域显示 */}
      {showWireframe && (
        <lineSegments ref={wireRef} geometry={wireGeo}>
          <lineBasicMaterial color="#e0f0ff" opacity={0.55} transparent linewidth={wireWidth} />
        </lineSegments>
      )}
    </group>
  );
}

// ============ 底部网格平面（效果图：深灰蓝底板+细网格线） ============
function GridFloor() {
  return (
    <group position={[0, -0.02, 0]}>
      {/* 深色底板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 12]} />
        <meshBasicMaterial color="#0d1a28" />
      </mesh>
      {/* 细网格线 */}
      <gridHelper args={[12, 64, '#1a3050', '#111d2d']} position={[0, 0.01, 0]} />
    </group>
  );
}

// ============ 场景灯光（柔和均匀，不产生高光反射） ============
function SceneLights() {
  return <ambientLight intensity={0.4} />;
}

// ============ 相机控制器 ============
function CameraController({ viewMode, autoRotate }: { viewMode: string; autoRotate: boolean }) {
  const { camera } = useThree();

  useEffect(() => {
    switch (viewMode) {
      case '3d':
        camera.position.set(9, 8, 9);
        camera.lookAt(0, 1.5, 0);
        break;
      case 'top':
        camera.position.set(0, 15, 0.01);
        camera.lookAt(0, 0, 0);
        break;
      case 'side':
        camera.position.set(15, 3, 0);
        camera.lookAt(0, 1.5, 0);
        break;
    }
  }, [viewMode, camera]);

  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.05}
      minDistance={4}
      maxDistance={25}
      target={[0, 1.5, 0]}
      autoRotate={autoRotate}
      autoRotateSpeed={-1.5}
    />
  );
}

// ============ 传感器矩阵缩略图 ============
function SensorMatrixMini({ data, colorScheme = 'terrain', resolution = 32 }: { data: number[]; colorScheme?: string; resolution?: 32 | 64 }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayGrid = resolution;
    const size = displayGrid * 4; // canvas像素尺寸
    const cellSize = size / displayGrid;
    canvas.width = size;
    canvas.height = size;

    ctx.fillStyle = '#080e16';
    ctx.fillRect(0, 0, size, size);

    if (resolution === 64) {
      // 插值到64x64
      let grid2D: number[][] = [];
      for (let i = 0; i < GRID_SIZE; i++) {
        grid2D.push(data.slice(i * GRID_SIZE, (i + 1) * GRID_SIZE));
      }
      const interpolated = bicubicInterpolate(grid2D, GRID_SIZE, 2);
      for (let row = 0; row < 64; row++) {
        for (let col = 0; col < 64; col++) {
          const value = interpolated[row][col];
          if (value > 0) {
            const normalized = Math.min(value / MAX_ADC, 1);
            const [r, g, b] = getTerrainColor(normalized, colorScheme);
            ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
            const cx = col * cellSize + cellSize / 2;
            const cy = row * cellSize + cellSize / 2;
            const radius = cellSize * 0.38;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else {
      // 原始32x32
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const value = data[row * GRID_SIZE + col];
          if (value > 0) {
            const normalized = Math.min(value / MAX_ADC, 1);
            const [r, g, b] = getTerrainColor(normalized, colorScheme);
            ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
            const cx = col * cellSize + cellSize / 2;
            const cy = row * cellSize + cellSize / 2;
            const radius = cellSize * 0.38;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  }, [data, colorScheme, resolution]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full aspect-square rounded-lg"
      style={{ imageRendering: 'auto' }}
    />
  );
}

// ============ 主页面组件 ============
export default function TerrainMapPage() {
  const [viewMode, setViewMode] = useState<'3d' | 'top' | 'side'>('3d');
  const [interpolation, setInterpolation] = useState(3); // 上采样倍率
  const [gaussSigma, setGaussSigma] = useState(1.0); // 高斯模糊sigma
  const [showWireframe, setShowWireframe] = useState(true); // 网格线
  const [wireWidth, setWireWidth] = useState(1.5); // 网格线粗细
  const [colorScheme, setColorScheme] = useState('terrain'); // 配色方案
  const [baseGain, setBaseGain] = useState(0.6); // 基础层数值系数（淡淡的底层）
  const [gloveGain, setGloveGain] = useState(2.0); // 手套数据系数（明显的变化）
  const [autoRotate, setAutoRotate] = useState(false); // 自动旋转
  const [autoCycleView, setAutoCycleView] = useState(false); // 自动切换视角
  const [autoCycleInterval, setAutoCycleInterval] = useState(2); // 自动切换间隔（秒）
  const [autoColorCycle, setAutoColorCycle] = useState(false); // 配色自动切换
  const [colorCycleSpeed, setColorCycleSpeed] = useState(1); // 配色切换速度（秒）
  const [matrixResolution, setMatrixResolution] = useState<32 | 64>(32); // 矩阵显示分辨率
  const [gloveOverlay, setGloveOverlay] = useState(true); // 手套数据叠加开关
  const [showRegionEditor, setShowRegionEditor] = useState(false); // 显示区域编辑器
  const [showLeftPanel, setShowLeftPanel] = useState(true); // 左侧控制面板显示
  const [showRightPanel, setShowRightPanel] = useState(true); // 右侧面板显示
  const [showUI, setShowUI] = useState(true); // 全局UI显示

  // ESC键恢复UI
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showUI) {
        setShowUI(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showUI]);

  // 自动循环切换视角（独立于旋转）
  useEffect(() => {
    if (!autoCycleView) return;
    const views: ('3d' | 'top' | 'side')[] = ['3d', 'top', 'side'];
    const timer = setInterval(() => {
      setViewMode(prev => {
        const idx = views.indexOf(prev);
        return views[(idx + 1) % views.length];
      });
    }, autoCycleInterval * 1000);
    return () => clearInterval(timer);
  }, [autoCycleView, autoCycleInterval]);

  // 配色自动循环切换
  useEffect(() => {
    if (!autoColorCycle) return;
    const keys = Object.keys(COLOR_SCHEMES);
    const timer = setInterval(() => {
      setColorScheme(prev => {
        const idx = keys.indexOf(prev);
        return keys[(idx + 1) % keys.length];
      });
    }, colorCycleSpeed * 1000);
    return () => clearInterval(timer);
  }, [autoColorCycle, colorCycleSpeed]);

  // ====== 串口连接状态 ======
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [serialFps, setSerialFps] = useState(0);
  const [liveGloveData, setLiveGloveData] = useState<number[] | null>(null);
  const [tareBaseline, setTareBaseline] = useState<number[] | null>(null); // 清零基准值
  const tareBaselineRef = useRef<number[] | null>(null);

  // 串口连接/断开
  const handleConnect = useCallback(async () => {
    if (connState === 'connected') {
      await serialManager.disconnect();
    } else {
      await serialManager.connect({ baudRate: 921600 });
    }
  }, [connState]);

  // 手套数据清零（TARE）——记录当前帧作为零点基准
  const handleTare = useCallback(() => {
    if (liveGloveData) {
      setTareBaseline([...liveGloveData]);
      tareBaselineRef.current = [...liveGloveData];
    }
  }, [liveGloveData]);

  // 取消清零
  const handleClearTare = useCallback(() => {
    setTareBaseline(null);
    tareBaselineRef.current = null;
  }, []);

  // 监听串口状态和数据
  useEffect(() => {
    const unsubState = serialManager.onStateChange((state) => {
      setConnState(state);
      if (state === 'disconnected' || state === 'error') {
        setLiveGloveData(null);
        setSerialFps(0);
      }
    });

    const unsubData = serialManager.onData((frame: ParsedFrame) => {
      // frame.pressure 是 0-based 数组，但 mapGloveToMatrix 中的 LEFT_HAND_MAP 通道号是 1-based
      // 且 mapGloveToMatrix 直接用 gloveData[ch] 访问，所以需要在前面插入一个 0 使得 data[1] = channel1
      const shifted = [0, ...frame.pressure]; // 现在 shifted[1] = channel1, shifted[256] = channel256
      // 如果有tare基准，减去预压力
      if (tareBaselineRef.current) {
        const tared = shifted.map((v, i) => Math.max(0, v - (tareBaselineRef.current![i] || 0)));
        setLiveGloveData(tared);
      } else {
        setLiveGloveData(shifted);
      }
    });

    // FPS 轮询
    const fpsInterval = setInterval(() => {
      if (serialManager.getState() === 'connected') {
        setSerialFps(serialManager.getFps());
      }
    }, 500);

    // 初始化状态
    setConnState(serialManager.getState());

    return () => {
      unsubState();
      unsubData();
      clearInterval(fpsInterval);
    };
  }, []);

  // 可编辑的区域映射配置（从localStorage加载）
  const [regionMap, setRegionMap] = useState<Record<RegionName, RegionRect>>(() => {
    try {
      const saved = localStorage.getItem('terrain_region_map');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { ...DEFAULT_REGION_MAP };
  });

  // 保存区域映射到localStorage
  useEffect(() => {
    localStorage.setItem('terrain_region_map', JSON.stringify(regionMap));
  }, [regionMap]);

  // 手套各区域模拟压力值 (0-150)
  const [fingerPressures, setFingerPressures] = useState<Record<RegionName, number>>({
    thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, palm: 0,
  });

  // 计算叠加后的矩阵数据（基础层 × baseGain + 手套层 × gloveGain）
  const matrixData = useMemo(() => {
    // 基础层应用baseGain（淡淡的底层）
    const base = SAMPLE_MATRIX.map(v => v * baseGain);

    if (!gloveOverlay) return base;

    // 手套数据层（使用gloveGain作为regionGains）
    const allGains: Record<RegionName, number> = {
      thumb: gloveGain, index: gloveGain, middle: gloveGain,
      ring: gloveGain, pinky: gloveGain, palm: gloveGain,
    };

    // 实时串口数据优先
    if (liveGloveData) {
      return mapGloveToMatrix(base, liveGloveData, regionMap, allGains);
    }

    // 否则用模拟滑块
    const hasAnyPressure = Object.values(fingerPressures).some(v => v > 0);
    if (!hasAnyPressure) return base;
    const simGlove = generateSimGloveData(fingerPressures);
    return mapGloveToMatrix(base, simGlove, regionMap, allGains);
  }, [fingerPressures, gloveOverlay, regionMap, liveGloveData, baseGain, gloveGain]);

  // 统计数据
  const stats = useMemo(() => {
    const total = matrixData.reduce((s, v) => s + v, 0);
    const fingerPeaks = [
      { name: 'Index Finger', value: 0 },
      { name: 'Middle Finger', value: 0 },
      { name: 'Thumb', value: 0 },
      { name: 'Ring Finger', value: 0 },
      { name: 'Pinky', value: 0 },
    ];
    for (let r = 0; r < 6; r++)
      for (let c = 13; c < 17; c++)
        fingerPeaks[0].value = Math.max(fingerPeaks[0].value, matrixData[r * 32 + c]);
    for (let r = 2; r < 7; r++)
      for (let c = 20; c < 25; c++)
        fingerPeaks[1].value = Math.max(fingerPeaks[1].value, matrixData[r * 32 + c]);
    for (let r = 17; r < 27; r++)
      for (let c = 4; c < 11; c++)
        fingerPeaks[2].value = Math.max(fingerPeaks[2].value, matrixData[r * 32 + c]);
    for (let r = 7; r < 10; r++)
      for (let c = 25; c < 30; c++)
        fingerPeaks[3].value = Math.max(fingerPeaks[3].value, matrixData[r * 32 + c]);
    for (let r = 20; r < 24; r++)
      for (let c = 25; c < 30; c++)
        fingerPeaks[4].value = Math.max(fingerPeaks[4].value, matrixData[r * 32 + c]);

    const adcToN = (adc: number) => (adc / 165) * 22.1;
    fingerPeaks.forEach(p => { p.value = parseFloat(adcToN(p.value).toFixed(1)); });
    fingerPeaks.sort((a, b) => b.value - a.value);

    return { totalForce: parseFloat((total * 0.0035).toFixed(1)), fingerPeaks };
  }, [matrixData]);

  return (
    <div className="min-h-screen bg-[#080e16] text-white font-mono overflow-hidden">
      {/* 顶部导航 */}
      <header className={`h-11 flex items-center px-4 border-b border-white/5 bg-[#0a1520]/80 transition-all duration-200 ${!showUI ? 'hidden' : ''}`}>
        <Link href="/" className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors text-xs tracking-widest">
          <ArrowLeft size={14} />
          BACK
        </Link>
        <span className="ml-4 text-[#00D4FF] text-xs tracking-[0.3em]">3D PRESSURE TERRAIN MAP</span>

        {/* 面板显示控制 */}
        <div className="ml-4 flex items-center gap-1">
          <button
            onClick={() => setShowUI(!showUI)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] tracking-wider transition-all border ${
              showUI
                ? 'border-white/20 text-white/50 hover:text-white/80 hover:border-white/40'
                : 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10'
            }`}
            title="隐藏/显示所有控制面板"
          >
            {showUI ? <Eye size={12} /> : <EyeOff size={12} />}
            {showUI ? 'UI' : 'HIDDEN'}
          </button>
          {showUI && (
            <>
              <button
                onClick={() => setShowLeftPanel(!showLeftPanel)}
                className={`p-1 rounded transition-all border ${
                  showLeftPanel
                    ? 'border-white/20 text-white/40 hover:text-white/70'
                    : 'border-[#00D4FF]/30 text-[#00D4FF]/60'
                }`}
                title="左侧控制面板"
              >
                <PanelLeftClose size={12} />
              </button>
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                className={`p-1 rounded transition-all border ${
                  showRightPanel
                    ? 'border-white/20 text-white/40 hover:text-white/70'
                    : 'border-[#00D4FF]/30 text-[#00D4FF]/60'
                }`}
                title="右侧信息面板"
              >
                <PanelRightClose size={12} />
              </button>
            </>
          )}
        </div>

        {/* 串口连接状态区域 */}
        <div className="ml-auto flex items-center gap-3">
          {/* 状态指示灯 */}
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full transition-colors ${
              connState === 'connected' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]' :
              connState === 'connecting' ? 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.6)] animate-pulse' :
              connState === 'error' ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]' :
              'bg-white/20'
            }`} />
            <span className={`text-[10px] tracking-wider ${
              connState === 'connected' ? 'text-green-400' :
              connState === 'connecting' ? 'text-yellow-400' :
              connState === 'error' ? 'text-red-400' :
              'text-white/30'
            }`}>
              {connState === 'connected' ? 'CONNECTED' :
               connState === 'connecting' ? 'CONNECTING...' :
               connState === 'error' ? 'ERROR' : 'OFFLINE'}
            </span>
          </div>

          {/* FPS显示 */}
          {connState === 'connected' && (
            <span className="text-[10px] text-[#00D4FF] tracking-wider">
              {serialFps} Hz
            </span>
          )}

          {/* TARE清零按钮 */}
          {connState === 'connected' && (
            <button
              onClick={tareBaseline ? handleClearTare : handleTare}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] tracking-wider transition-all border ${
                tareBaseline
                  ? 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20'
                  : 'border-white/20 text-white/50 hover:text-white/80 hover:border-white/40'
              }`}
            >
              {tareBaseline ? 'TARED ✓' : 'TARE'}
            </button>
          )}

          {/* 连接/断开按钮 */}
          <button
            onClick={handleConnect}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-[10px] tracking-wider transition-all border ${
              connState === 'connected'
                ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                : 'border-[#00D4FF]/40 text-[#00D4FF] hover:bg-[#00D4FF]/10'
            }`}
          >
            {connState === 'connected' ? (
              <><BluetoothOff size={12} /> DISCONNECT</>
            ) : (
              <><Bluetooth size={12} /> CONNECT GLOVE</>
            )}
          </button>
        </div>
      </header>

      {/* 主布局 */}
      <div className={`flex ${showUI ? 'h-[calc(100vh-44px)]' : 'h-screen'}`}>
        {/* 左侧：3D画布区域 */}
        <div className="flex-1 relative border border-[#1a3050]/40 m-3 mr-0 rounded-xl overflow-hidden">
          {/* 标题 */}
          <div className="absolute top-5 left-0 right-0 text-center z-10 pointer-events-none">
            <h1 className="text-[22px] font-bold text-white tracking-wide" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
              3D Pressure Terrain Map
            </h1>
            <p className="text-white/35 text-[13px] mt-1 tracking-wide">手掌压力三维地形可视化 · 实时数据映射</p>
          </div>

          {/* Three.js Canvas */}
          <Canvas
            camera={{ position: [9, 8, 9], fov: 40, near: 0.1, far: 100 }}
            gl={{
              antialias: true,
              alpha: true,
              powerPreference: 'high-performance',
            }}
            style={{ background: 'radial-gradient(ellipse at 50% 40%, #0f2030 0%, #080e16 70%)' }}
          >
            <CameraController viewMode={viewMode} autoRotate={autoRotate} />
            <SceneLights />
            <TerrainMesh matrix={matrixData} interpolation={interpolation} gaussSigma={gaussSigma} showWireframe={showWireframe} gain={1.0} wireWidth={wireWidth} colorScheme={colorScheme} baseResolution={matrixResolution} />
            <GridFloor />
            <fog attach="fog" args={['#080e16', 25, 45]} />
          </Canvas>

          {/* 左下角控制面板 */}
          {showUI && showLeftPanel && <div className="absolute bottom-16 left-4 z-10 flex flex-col gap-2 transition-all duration-200">
            {/* 插值倍率 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="text-[9px] text-white/40 tracking-wider mb-1.5">INTERPOLATION</div>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(v => (
                  <button
                    key={v}
                    onClick={() => setInterpolation(v)}
                    className={`px-2 py-0.5 rounded text-[10px] transition-all ${
                      interpolation === v
                        ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                        : 'text-white/40 hover:text-white/70 border border-white/10'
                    }`}
                  >
                    {v}x
                  </button>
                ))}
              </div>
            </div>

            {/* 高斯模糊 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="text-[9px] text-white/40 tracking-wider mb-1.5">GAUSSIAN σ</div>
              <div className="flex gap-1">
                {[0, 0.5, 1.0, 1.5, 2.0].map(v => (
                  <button
                    key={v}
                    onClick={() => setGaussSigma(v)}
                    className={`px-2 py-0.5 rounded text-[10px] transition-all ${
                      gaussSigma === v
                        ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                        : 'text-white/40 hover:text-white/70 border border-white/10'
                    }`}
                  >
                    {v === 0 ? 'OFF' : v.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* 网格线开关 + 粗细调节 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-white/40 tracking-wider">WIREFRAME</span>
                <button
                  onClick={() => setShowWireframe(!showWireframe)}
                  className={`px-2 py-0.5 rounded text-[9px] transition-all ${
                    showWireframe
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/40 hover:text-white/70 border border-white/10'
                  }`}
                >
                  {showWireframe ? 'ON' : 'OFF'}
                </button>
              </div>
              {showWireframe && (
                <div className="mt-1">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[8px] text-white/30">WIDTH</span>
                    <span className="text-[9px] text-white/50">{wireWidth.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3.0"
                    step="0.1"
                    value={wireWidth}
                    onChange={(e) => setWireWidth(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/60
                      [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(255,255,255,0.3)]"
                  />
                </div>
              )}
            </div>

            {/* 配色方案切换 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="flex items-center justify-between">
                <div className="text-[9px] text-white/40 tracking-wider">COLOR SCHEME</div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      const keys = Object.keys(COLOR_SCHEMES);
                      const idx = keys.indexOf(colorScheme);
                      setColorScheme(keys[(idx - 1 + keys.length) % keys.length]);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white/70 border border-white/10 hover:border-white/30 transition-all text-[10px]"
                  >
                    ◀
                  </button>
                  <span className="text-[10px] text-[#00D4FF] min-w-[52px] text-center">
                    {COLOR_SCHEMES[colorScheme]?.name}
                  </span>
                  <button
                    onClick={() => {
                      const keys = Object.keys(COLOR_SCHEMES);
                      const idx = keys.indexOf(colorScheme);
                      setColorScheme(keys[(idx + 1) % keys.length]);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white/70 border border-white/10 hover:border-white/30 transition-all text-[10px]"
                  >
                    ▶
                  </button>
                </div>
              </div>
              {/* 配色自动切换 */}
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={() => setAutoColorCycle(!autoColorCycle)}
                  className={`px-2 py-0.5 rounded text-[9px] transition-all ${
                    autoColorCycle
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/30 hover:text-white/60 border border-white/10'
                  }`}
                >
                  {autoColorCycle ? 'AUTO' : 'AUTO'}
                </button>
                {autoColorCycle && <div className="flex items-center gap-1">
                  {[0.3, 0.6, 1, 1.5].map(s => (
                    <button
                      key={s}
                      onClick={() => setColorCycleSpeed(s)}
                      className={`px-1.5 h-5 rounded text-[8px] transition-all ${
                        colorCycleSpeed === s
                          ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                          : 'text-white/30 hover:text-white/60 border border-white/10'
                      }`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>}
              </div>
            </div>

            {/* 基础层系数滑块 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-white/40 tracking-wider">BASE GAIN</span>
                <span className="text-[10px] text-white/50">{baseGain.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={baseGain}
                onChange={(e) => setBaseGain(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white/50
                  [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(255,255,255,0.3)]"
              />
              <div className="flex justify-between text-[8px] text-white/25 mt-0.5">
                <span>0</span>
                <span>1.5x</span>
              </div>
            </div>

            {/* 手套数据系数滑块 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-[#00D4FF]/20">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] text-[#00D4FF]/60 tracking-wider">GLOVE GAIN</span>
                <span className="text-[10px] text-[#00D4FF]">{gloveGain.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.1"
                value={gloveGain}
                onChange={(e) => setGloveGain(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00D4FF]
                  [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(0,212,255,0.5)]"
              />
              <div className="flex justify-between text-[8px] text-white/25 mt-0.5">
                <span>0.5x</span>
                <span>5.0x</span>
              </div>
            </div>

            {/* 自动旋转 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="text-[9px] text-white/40 tracking-wider mb-1.5">ROTATE</div>
              <button
                onClick={() => setAutoRotate(!autoRotate)}
                className={`px-3 py-0.5 rounded text-[10px] transition-all ${
                  autoRotate
                    ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                    : 'text-white/40 hover:text-white/70 border border-white/10'
                }`}
              >
                {autoRotate ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* 自动切换视角 */}
            <div className="bg-black/60 backdrop-blur-md rounded-lg px-3 py-2 border border-white/10">
              <div className="text-[9px] text-white/40 tracking-wider mb-1.5">CYCLE VIEW</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoCycleView(!autoCycleView)}
                  className={`px-3 py-0.5 rounded text-[10px] transition-all ${
                    autoCycleView
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/40 hover:text-white/70 border border-white/10'
                  }`}
                >
                  {autoCycleView ? 'ON' : 'OFF'}
                </button>
                {autoCycleView && <div className="flex items-center gap-1">
                  {[1, 2, 3, 4].map(s => (
                    <button
                      key={s}
                      onClick={() => setAutoCycleInterval(s)}
                      className={`w-5 h-5 rounded text-[9px] transition-all ${
                        autoCycleInterval === s
                          ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                          : 'text-white/30 hover:text-white/60 border border-white/10'
                      }`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>}
              </div>
            </div>
          </div>}

          {/* 视图切换按钮 */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {(['3d', 'top', 'side'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-5 py-2 rounded-full text-[11px] tracking-wider transition-all duration-200 ${
                  viewMode === mode
                    ? 'bg-white/12 text-white border border-white/25 backdrop-blur-md shadow-lg shadow-black/20'
                    : 'text-white/35 hover:text-white/60 border border-transparent hover:border-white/10'
                }`}
              >
                {mode === '3d' ? '3D View' : mode === 'top' ? 'Top View' : 'Side View'}
              </button>
            ))}
          </div>
        </div>

        {/* 右侧面板 */}
        {showUI && showRightPanel && <div className="w-[270px] p-3 flex flex-col gap-3 overflow-y-auto">
          {/* 手套映射控制面板 */}
          <div className="rounded-xl border border-[#1a3a5a]/50 bg-gradient-to-b from-[#0d1f2d]/90 to-[#0a1520]/90 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Hand size={14} className="text-[#00D4FF]" />
                <h3 className="text-[10px] tracking-[0.2em] text-white/50 uppercase">Glove Mapping</h3>
              </div>
              <button
                onClick={() => setGloveOverlay(!gloveOverlay)}
                className={`px-2 py-0.5 rounded text-[9px] transition-all ${
                  gloveOverlay
                    ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                    : 'text-white/40 border border-white/10'
                }`}
              >
                {gloveOverlay ? 'ON' : 'OFF'}
              </button>
            </div>

            {gloveOverlay && (
              <div className="space-y-2.5">
                {(['thumb', 'index', 'middle', 'ring', 'pinky', 'palm'] as RegionName[]).map((region) => (
                  <div key={region}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-white/50 capitalize">{region}</span>
                      <span className="text-[9px] text-[#00D4FF]">{fingerPressures[region]}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="150"
                      step="5"
                      value={fingerPressures[region]}
                      onChange={(e) => setFingerPressures(prev => ({ ...prev, [region]: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#00D4FF]
                        [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(0,212,255,0.4)]"
                    />
                  </div>
                ))}

                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setFingerPressures({ thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, palm: 0 })}
                    className="flex-1 py-1 rounded text-[9px] text-white/40 border border-white/10 hover:text-white/70 hover:border-white/20 transition-all"
                  >
                    RESET ALL
                  </button>
                  <button
                    onClick={() => setShowRegionEditor(!showRegionEditor)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-[9px] transition-all ${
                      showRegionEditor
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'text-white/40 border border-white/10 hover:text-white/70'
                    }`}
                  >
                    <Settings2 size={10} />
                    MAP
                  </button>
                </div>
              </div>
            )}

            {/* 区域映射编辑器 */}
            {gloveOverlay && showRegionEditor && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] text-amber-400 tracking-wider">REGION EDITOR</span>
                  <button
                    onClick={() => setRegionMap({ ...DEFAULT_REGION_MAP })}
                    className="text-[8px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    RESET DEFAULT
                  </button>
                </div>
                <div className="space-y-3">
                  {(['thumb', 'index', 'middle', 'ring', 'pinky', 'palm'] as RegionName[]).map((region) => (
                    <div key={region} className="bg-black/30 rounded-lg p-2">
                      <span className="text-[9px] text-white/60 capitalize font-medium">{region}</span>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] text-white/30 w-[18px]">R↑</span>
                          <input
                            type="number"
                            min="0" max="31"
                            value={regionMap[region].rowStart}
                            onChange={(e) => setRegionMap(prev => ({
                              ...prev,
                              [region]: { ...prev[region], rowStart: Math.max(0, Math.min(31, parseInt(e.target.value) || 0)) }
                            }))}
                            className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-[#00D4FF] text-center
                              focus:border-[#00D4FF]/50 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] text-white/30 w-[18px]">R↓</span>
                          <input
                            type="number"
                            min="0" max="31"
                            value={regionMap[region].rowEnd}
                            onChange={(e) => setRegionMap(prev => ({
                              ...prev,
                              [region]: { ...prev[region], rowEnd: Math.max(0, Math.min(31, parseInt(e.target.value) || 0)) }
                            }))}
                            className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-[#00D4FF] text-center
                              focus:border-[#00D4FF]/50 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] text-white/30 w-[18px]">C←</span>
                          <input
                            type="number"
                            min="0" max="31"
                            value={regionMap[region].colStart}
                            onChange={(e) => setRegionMap(prev => ({
                              ...prev,
                              [region]: { ...prev[region], colStart: Math.max(0, Math.min(31, parseInt(e.target.value) || 0)) }
                            }))}
                            className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-[#00D4FF] text-center
                              focus:border-[#00D4FF]/50 focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[8px] text-white/30 w-[18px]">C→</span>
                          <input
                            type="number"
                            min="0" max="31"
                            value={regionMap[region].colEnd}
                            onChange={(e) => setRegionMap(prev => ({
                              ...prev,
                              [region]: { ...prev[region], colEnd: Math.max(0, Math.min(31, parseInt(e.target.value) || 0)) }
                            }))}
                            className="w-full bg-black/50 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-[#00D4FF] text-center
                              focus:border-[#00D4FF]/50 focus:outline-none"
                          />
                        </div>
                      </div>
                      {/* Pulp指腹位置编辑（仅手指，非手掌） */}
                      {region !== 'palm' && (
                        <div className="mt-1.5 pt-1.5 border-t border-white/5">
                          <span className="text-[8px] text-amber-400/70">Pulp</span>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] text-amber-400/40 w-[18px]">PR</span>
                              <input
                                type="number"
                                min="0" max="31"
                                value={regionMap[region].pulpRow ?? regionMap[region].rowStart}
                                onChange={(e) => setRegionMap(prev => ({
                                  ...prev,
                                  [region]: { ...prev[region], pulpRow: Math.max(0, Math.min(31, parseInt(e.target.value) || 0)) }
                                }))}
                                className="w-full bg-black/50 border border-amber-500/20 rounded px-1.5 py-0.5 text-[9px] text-amber-400 text-center
                                  focus:border-amber-500/50 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[8px] text-amber-400/40 w-[18px]">PC</span>
                              <input
                                type="number"
                                min="0" max="31"
                                value={regionMap[region].pulpCol ?? Math.round((regionMap[region].colStart + regionMap[region].colEnd) / 2)}
                                onChange={(e) => setRegionMap(prev => ({
                                  ...prev,
                                  [region]: { ...prev[region], pulpCol: Math.max(0, Math.min(31, parseInt(e.target.value) || 0)) }
                                }))}
                                className="w-full bg-black/50 border border-amber-500/20 rounded px-1.5 py-0.5 text-[9px] text-amber-400 text-center
                                  focus:border-amber-500/50 focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Total Force Output */}
          <div className="rounded-xl border border-[#1a3a5a]/50 bg-gradient-to-b from-[#0d1f2d]/90 to-[#0a1520]/90 p-5 text-center backdrop-blur-sm">
            <h3 className="text-[10px] tracking-[0.2em] text-white/50 mb-3 uppercase">Total Force Output</h3>
            <div className="text-[48px] font-bold text-white leading-none">{stats.totalForce}</div>
            <div className="text-white/35 text-[12px] mt-2">Newton (N)</div>
          </div>

          {/* Peak Pressure Points */}
          <div className="rounded-xl border border-[#1a3a5a]/50 bg-gradient-to-b from-[#0d1f2d]/90 to-[#0a1520]/90 p-5 backdrop-blur-sm">
            <h3 className="text-[10px] tracking-[0.2em] text-white/50 mb-4 uppercase">Peak Pressure Points</h3>
            <div className="space-y-3">
              {stats.fingerPeaks.map((fp) => (
                <div key={fp.name} className="flex justify-between items-center">
                  <span className="text-white/65 text-[13px]">{fp.name}</span>
                  <span className="text-[#00D4FF] font-bold text-[13px]">{fp.value}N</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sensor Matrix */}
          <div className="rounded-xl border border-[#1a3a5a]/50 bg-gradient-to-b from-[#0d1f2d]/90 to-[#0a1520]/90 p-5 backdrop-blur-sm flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[10px] tracking-[0.2em] text-white/50 uppercase">Sensor Matrix ({matrixResolution}×{matrixResolution})</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMatrixResolution(32)}
                  className={`px-1.5 py-0.5 rounded text-[8px] transition-all ${
                    matrixResolution === 32
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/30 hover:text-white/60 border border-white/10'
                  }`}
                >
                  32
                </button>
                <button
                  onClick={() => setMatrixResolution(64)}
                  className={`px-1.5 py-0.5 rounded text-[8px] transition-all ${
                    matrixResolution === 64
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/30 hover:text-white/60 border border-white/10'
                  }`}
                >
                  64
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <SensorMatrixMini data={matrixData} colorScheme={colorScheme} resolution={matrixResolution} />
            </div>
          </div>
        </div>}

        {/* UI隐藏时左上角提示 */}
        {!showUI && <div className="absolute top-4 left-4 z-20 px-3 py-1.5 rounded-lg bg-[#0a1520]/50 backdrop-blur-sm text-white/30 text-[10px] tracking-wider pointer-events-none">
          Press ESC to show UI
        </div>}

        {/* Sensor Matrix - UI隐藏时仍然显示（右上角放大1.5倍） */}
        {!(showUI && showRightPanel) && <div className="absolute top-4 right-4 z-10 w-[330px] h-[330px]">
          <div className="rounded-xl border border-[#1a3a5a]/50 bg-gradient-to-b from-[#0d1f2d]/90 to-[#0a1520]/90 p-4 backdrop-blur-sm h-full flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] tracking-[0.2em] text-white/50 uppercase">Sensor Matrix ({matrixResolution}×{matrixResolution})</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMatrixResolution(32)}
                  className={`px-1.5 py-0.5 rounded text-[8px] transition-all ${
                    matrixResolution === 32
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/30 hover:text-white/60 border border-white/10'
                  }`}
                >
                  32
                </button>
                <button
                  onClick={() => setMatrixResolution(64)}
                  className={`px-1.5 py-0.5 rounded text-[8px] transition-all ${
                    matrixResolution === 64
                      ? 'bg-[#00D4FF]/20 text-[#00D4FF] border border-[#00D4FF]/40'
                      : 'text-white/30 hover:text-white/60 border border-white/10'
                  }`}
                >
                  64
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <SensorMatrixMini data={matrixData} colorScheme={colorScheme} resolution={matrixResolution} />
            </div>
          </div>
        </div>}
      </div>
    </div>
  );
}
