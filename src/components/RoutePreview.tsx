import { useEffect } from 'react';
import Svg, { Defs, LinearGradient, Stop, Polyline, Circle, Line } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { colors } from '../theme';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

type Pt = [number, number];

function length(pts: Pt[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** A glowing route that draws itself in over a faint street grid. */
export function RoutePreview({ points, width, height }: { points: Pt[]; width: number | string; height: number | string }) {
  const len = length(points);
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(350, withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }));
  }, [p]);
  const animated = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - p.value) }));
  const pts = points.map((q) => q.join(',')).join(' ');
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height} viewBox="0 0 100 60" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#7DFFB0" />
          <Stop offset="1" stopColor={colors.accent} />
        </LinearGradient>
      </Defs>
      {/* street grid */}
      {[10, 22, 34, 46].map((y) => (
        <Line key={`h${y}`} x1="0" x2="100" y1={y} y2={y + (y % 3)} stroke="#fff" strokeOpacity={0.045} strokeWidth={0.6} />
      ))}
      {[14, 30, 48, 66, 84].map((x) => (
        <Line key={`v${x}`} y1="0" y2="60" x1={x} x2={x - (x % 5)} stroke="#fff" strokeOpacity={0.045} strokeWidth={0.6} />
      ))}
      {/* glow + casing + line */}
      <Polyline points={pts} fill="none" stroke={colors.accent} strokeOpacity={0.16} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <AnimatedPolyline
        points={pts}
        fill="none"
        stroke="url(#g)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[len, len]}
        animatedProps={animated}
      />
      <Circle cx={first[0]} cy={first[1]} r={1.6} fill={colors.bg} stroke="#7DFFB0" strokeWidth={0.9} />
      <Circle cx={last[0]} cy={last[1]} r={1.9} fill={colors.accent} />
    </Svg>
  );
}
