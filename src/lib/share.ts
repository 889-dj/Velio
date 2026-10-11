import { TurboModuleRegistry } from 'react-native';
import { Coord, haversine } from './geo';
import { normalizeRoute } from './route';

/** Canvas is laid out in points at 360x640 (9:16) and exported at 1080x1920. */
export const CANVAS = { w: 360, h: 640 };
export const EXPORT = { w: 1080, h: 1920, fps: 30, ms: 10000 };
export const TOTAL_FRAMES = Math.round((EXPORT.ms / 1000) * EXPORT.fps);

/** Route box inside the canvas (points). */
export const ROUTE_BOX = { x: 30, y: 150, w: 300, h: 240 };

/** Privacy: hide this much of the start and finish. */
export const TRIM_M = 200;
/** Below this total length trimming would erase most of the route, so it is skipped. */
export const MIN_TRIM_TOTAL_M = 800;

/** True only in a development build that includes the native recorder (never in Expo Go). */
export const recorderAvailable = () => {
  try {
    return TurboModuleRegistry.get('ViewRecorder') != null;
  } catch {
    return false;
  }
};

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 before `a`, 1 after `b`, linear between. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Timeline, as fractions of the 10 s video. */
export const T = { intro: [0, 0.07], draw: [0.08, 0.78], outro: [0.78, 0.9] } as const;

/** Drops the first and last TRIM_M metres of a track. Returns the input if the run is too short. */
export function trimTrack(coords: Coord[], trim: boolean): { coords: Coord[]; trimmed: boolean; tooShort: boolean } {
  if (coords.length < 2) return { coords, trimmed: false, tooShort: false };
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  if (total < MIN_TRIM_TOTAL_M) return { coords, trimmed: false, tooShort: true };
  if (!trim) return { coords, trimmed: false, tooShort: false };
  const kept = coords.filter((_, i) => cum[i] >= TRIM_M && cum[i] <= total - TRIM_M);
  return kept.length >= 2 ? { coords: kept, trimmed: true, tooShort: false } : { coords, trimmed: false, tooShort: true };
}

export type Pt = [number, number];
export type Path = { pts: Pt[]; len: number[]; total: number };

/** Route points in canvas coordinates, with cumulative length for exact partial drawing. */
export function buildPath(coords: Coord[]): Path {
  const local = normalizeRoute([coords], ROUTE_BOX.w, ROUTE_BOX.h, 14, 240);
  const pts = local.map(([x, y]) => [x + ROUTE_BOX.x, y + ROUTE_BOX.y] as Pt);
  const len: number[] = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, len, total: len[len.length - 1] || 1 };
}

/** The part of the path between two distances (in path units), with interpolated end points. */
export function slicePath(path: Path, from: number, to: number): Pt[] {
  const { pts, len } = path;
  if (pts.length < 2 || to <= from) return [];
  const at = (d: number): Pt => {
    if (d <= 0) return pts[0];
    if (d >= path.total) return pts[pts.length - 1];
    let i = 1;
    while (len[i] < d) i++;
    const t = (d - len[i - 1]) / Math.max(len[i] - len[i - 1], 1e-6);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const out: Pt[] = [at(from)];
  for (let i = 0; i < pts.length; i++) if (len[i] > from && len[i] < to) out.push(pts[i]);
  out.push(at(to));
  return out;
}

export const toPoints = (pts: Pt[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
