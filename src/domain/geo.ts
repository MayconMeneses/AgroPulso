import { DomainError } from './errors.ts';
import type { FarmLocation } from './location.ts';

// Contas de mapa sem biblioteca: quadros do OpenStreetMap (projeção de "slippy map") e área do desenho do talhão.
export interface Grid {
  zoom: number;
  cx: number; // coluna do quadro central
  cy: number; // linha do quadro central
}

const tileXY = (latMicro: number, lonMicro: number, zoom: number): { x: number; y: number } => {
  const n = 2 ** zoom;
  const rad = (latMicro / 1_000_000 / 180) * Math.PI;
  return { x: ((lonMicro / 1_000_000 + 180) / 360) * n, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n };
};

export function gridFor(loc: FarmLocation, zoom: number): Grid {
  const { x, y } = tileXY(loc.latMicro, loc.lonMicro, zoom);
  return { zoom, cx: Math.floor(x), cy: Math.floor(y) };
}

// Posição de um ponto dentro da grade 3 x 3, em % (0 a 100), para desenhar por cima do mapa.
export function toPct(grid: Grid, p: FarmLocation): { x: number; y: number } {
  const t = tileXY(p.latMicro, p.lonMicro, grid.zoom);
  return { x: ((t.x - (grid.cx - 1)) / 3) * 100, y: ((t.y - (grid.cy - 1)) / 3) * 100 };
}

// O inverso: de um toque na grade (em %) para latitude e longitude em micrograus.
export function fromPct(grid: Grid, xPct: number, yPct: number): FarmLocation {
  const n = 2 ** grid.zoom;
  const tx = grid.cx - 1 + (xPct / 100) * 3;
  const ty = grid.cy - 1 + (yPct / 100) * 3;
  const lon = (tx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { latMicro: Math.round(lat * 1_000_000), lonMicro: Math.round(lon * 1_000_000) };
}

export const MAX_OUTLINE_POINTS = 60;

export function assertOutline(points: FarmLocation[]): void {
  if (!Array.isArray(points) || points.length < 3) throw new DomainError('invalido', 'O contorno precisa de pelo menos 3 pontos');
  if (points.length > MAX_OUTLINE_POINTS) throw new DomainError('invalido', `O contorno aceita até ${MAX_OUTLINE_POINTS} pontos`);
  for (const p of points) {
    if (!Number.isSafeInteger(p.latMicro) || !Number.isSafeInteger(p.lonMicro) || Math.abs(p.latMicro) > 90_000_000 || Math.abs(p.lonMicro) > 180_000_000) {
      throw new DomainError('invalido', 'Ponto do contorno fora do limite');
    }
  }
}

// Área estimada do desenho, em hectares. Projeção local plana: boa para talhões (centenas de metros); não é medida de topografia.
export function areaHectares(points: FarmLocation[]): number {
  assertOutline(points);
  const lat0 = points.reduce((s, p) => s + p.latMicro, 0) / points.length / 1_000_000;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const xy = points.map((p) => [(p.lonMicro / 1_000_000) * kx, (p.latMicro / 1_000_000) * ky] as const);
  let sum = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i] as readonly [number, number];
    const [x2, y2] = xy[(i + 1) % xy.length] as readonly [number, number];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2 / 10_000;
}
