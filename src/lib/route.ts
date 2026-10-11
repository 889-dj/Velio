import type { Coord } from './geo';

/** Projects a real GPS track into a 100x60 box (aspect preserved) for the preview card. */
export function normalizeRoute(segments: Coord[][], w = 100, h = 60, pad = 8, maxPts = 140): [number, number][] {
  const pts = segments.flat();
  if (pts.length < 2) return [];
  const step = Math.max(1, Math.ceil(pts.length / maxPts));
  const ds = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);

  const lat0 = ds.reduce((a, p) => a + p.latitude, 0) / ds.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xy = ds.map((p) => [p.longitude * kx, -p.latitude] as const);

  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = maxX - minX;
  const dy = maxY - minY;
  if (dx < 1e-7 && dy < 1e-7) return [];

  const scale = Math.min((w - 2 * pad) / (dx || 1e-9), (h - 2 * pad) / (dy || 1e-9));
  const ox = (w - dx * scale) / 2;
  const oy = (h - dy * scale) / 2;
  return xy.map(([x, y]) => [+(ox + (x - minX) * scale).toFixed(2), +(oy + (y - minY) * scale).toFixed(2)]);
}
