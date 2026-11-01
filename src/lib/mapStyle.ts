import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LngLat, LngLatBounds, StyleSpecification } from '@maplibre/maplibre-react-native';
import type { Coord } from './geo';

/**
 * Free vector tiles from OpenFreeMap (no API key, no quota). Swap this one URL for a self-hosted
 * Protomaps style later if you ever need an SLA; nothing else in the app depends on it.
 * Attribution required: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".
 */
export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const CACHE_KEY = 'velio.mapstyle.v1';
const FETCH_TIMEOUT_MS = 5000;

export const toLngLat = (c: Coord): LngLat => [c.longitude, c.latitude];

export function boundsOf(pts: Coord[]): LngLatBounds | null {
  if (pts.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of pts) {
    if (p.longitude < w) w = p.longitude;
    if (p.longitude > e) e = p.longitude;
    if (p.latitude < s) s = p.latitude;
    if (p.latitude > n) n = p.latitude;
  }
  return [w, s, e, n];
}

// ---------- dark recolour ----------
// OpenFreeMap has no dark style, so we take its light "positron" style and recolour it once at
// runtime. Roads end up lighter than land and labels light on dark, like the old Google dark style.

type Hsl = { h: number; s: number; l: number; a: number };

function parseColor(v: string): Hsl | null {
  const str = v.trim().toLowerCase();
  let r: number, g: number, b: number, a = 1;
  let m: RegExpMatchArray | null;
  if ((m = str.match(/^#([0-9a-f]{3,8})$/))) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
  } else if ((m = str.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/))) {
    r = +m[1];
    g = +m[2];
    b = +m[3];
    if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  } else if ((m = str.match(/^hsla?\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%(?:[ ,/]+([\d.]+%?))?\s*\)$/))) {
    if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    return { h: +m[1], s: +m[2] / 100, l: +m[3] / 100, a };
  } else if (str === 'white') {
    [r, g, b] = [255, 255, 255];
  } else if (str === 'black') {
    [r, g, b] = [0, 0, 0];
  } else {
    return null;
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l, a };
}

const hsl = (h: number, s: number, l: number, a: number) =>
  `hsla(${h.toFixed(0)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a.toFixed(3)})`;

const HUE = 218; // cool blue-grey tint, matches the app's near-black UI
const TEXT_FILL = hsl(HUE, 0.1, 0.55, 1);
const TEXT_HALO = hsl(HUE, 0.25, 0.07, 1);

function darkenColor(prop: string, value: string): string {
  const c = parseColor(value);
  if (!c) return value;
  if (prop === 'text-color' || prop === 'icon-color') return TEXT_FILL;
  if (prop === 'text-halo-color' || prop === 'icon-halo-color') return TEXT_HALO;
  if (prop === 'background-color') return hsl(HUE, 0.25, 0.075, c.a);
  if (prop.startsWith('line-')) {
    // roads / paths: lighter than the land so the network reads; faint lines stay faint
    return hsl(HUE, 0.12, 0.13 + c.l * 0.1, c.a);
  }
  // fills (land, water, parks, buildings): all very dark, lighter source -> darker result
  return hsl(HUE, 0.25, 0.07 + (1 - c.l) * 0.07, c.a);
}

function darkenValue(prop: string, v: unknown): unknown {
  if (typeof v === 'string') return darkenColor(prop, v);
  if (Array.isArray(v)) return v.map((x) => darkenValue(prop, x));
  if (v && typeof v === 'object') {
    // legacy {stops: [[zoom, value], ...]} functions
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, darkenValue(prop, x)]));
  }
  return v;
}

export function darkenStyle(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((layer) => {
    if (!('paint' in layer) || !layer.paint) return layer;
    const paint: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(layer.paint)) {
      paint[k] = k.endsWith('color') ? darkenValue(k, v) : v;
    }
    return { ...layer, paint } as typeof layer;
  });
  return { ...style, layers };
}

// ---------- loading ----------

let memo: StyleSpecification | null = null;

async function fetchDark(): Promise<StyleSpecification> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(BASE_STYLE_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`style ${res.status}`);
    return darkenStyle((await res.json()) as StyleSpecification);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dark map style for MapLibre. Uses the last good copy from storage first (so the map opens
 * instantly and offline), refreshes it in the background, and falls back to the plain light style
 * URL if it can never be loaded, so the map always renders.
 */
export function useMapStyle(): { style: StyleSpecification | string | null } {
  const [style, setStyle] = useState<StyleSpecification | string | null>(memo);

  useEffect(() => {
    if (memo) return;
    let alive = true;
    (async () => {
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached && alive) {
          memo = JSON.parse(cached) as StyleSpecification;
          setStyle(memo);
          // refresh for next launch, but don't swap the style under a visible map
          fetchDark()
            .then((fresh) => AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh)))
            .catch(() => {});
          return;
        }
      } catch {}
      try {
        const fresh = await fetchDark();
        memo = fresh;
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
        if (alive) setStyle(fresh);
      } catch {
        if (alive) setStyle(BASE_STYLE_URL);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { style };
}
