import { memo, useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { Coord } from '../lib/geo';
import { toLngLat } from '../lib/mapStyle';

export type RouteLine = {
  coords: Coord[];
  color: string;
  width: number;
  /** Draw order: lower z is drawn first (glow, then casing, then the line itself, then highlight). */
  z: number;
};

const Z_LEVELS = [0, 1, 2, 3];

/**
 * Draws route lines on a MapLibre map. All lines share one GeoJSON source; each z level is one
 * layer, so glow/casing always sit under the coloured line regardless of feature order.
 */
export const RouteLines = memo(function RouteLines({ id, lines }: { id: string; lines: RouteLine[] }) {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: lines
        .filter((l) => l.coords.length > 1)
        .map((l) => ({
          type: 'Feature',
          properties: { color: l.color, width: l.width, z: l.z },
          geometry: { type: 'LineString', coordinates: l.coords.map(toLngLat) },
        })),
    }),
    [lines],
  );

  return (
    <GeoJSONSource id={id} data={data}>
      {Z_LEVELS.map((z) => (
        <Layer
          key={z}
          id={`${id}-z${z}`}
          type="line"
          filter={['==', ['get', 'z'], z]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': ['to-color', ['get', 'color']],
            'line-width': ['get', 'width'],
          }}
        />
      ))}
    </GeoJSONSource>
  );
});

/** Glow + casing + core line so a route reads over any map. */
export function routeLinesFor(segments: Coord[][], color: string): RouteLine[] {
  return segments.flatMap((coords) =>
    coords.length > 1
      ? [
          { coords, color: 'rgba(200,255,46,0.18)', width: 16, z: 0 },
          { coords, color: 'rgba(7,8,10,0.85)', width: 9, z: 1 },
          { coords, color, width: 5, z: 2 },
        ]
      : [],
  );
}
