import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { Coord } from '../lib/geo';
import { normalizeRoute } from '../lib/route';
import { colors, radius } from '../theme';

const BOX = 100;
const PAD = 16;
const MAX_POINTS = 40; // plenty at this size, and it keeps a long list light

/** A still route for list rows. RoutePreview animates, so it is too heavy to repeat down a list. */
export const RouteThumb = memo(function RouteThumb({ segments, size }: { segments: Coord[][]; size: number }) {
  const route = useMemo(() => normalizeRoute(segments, BOX, BOX, PAD, MAX_POINTS), [segments]);
  const box = { width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.surface2, overflow: 'hidden' as const };
  if (route.length < 2) {
    return (
      <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="map-outline" size={size * 0.34} color={colors.dim} />
      </View>
    );
  }
  const pts = route.map((p) => p.join(',')).join(' ');
  const last = route[route.length - 1];
  return (
    <View style={box}>
      <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
        <Polyline points={pts} fill="none" stroke={colors.accent} strokeOpacity={0.16} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
        <Polyline points={pts} fill="none" stroke={colors.accent} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={last[0]} cy={last[1]} r={5} fill={colors.accent} />
      </Svg>
    </View>
  );
});
