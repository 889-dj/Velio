import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop, Circle, Text as SvgText } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, font, label } from '../theme';
import type { Pt, SplitRow } from '../lib/insights';
import { formatPace } from '../lib/geo';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type LineProps = {
  data: Pt[];
  width: number;
  height?: number;
  color?: string;
  fill?: boolean;
  /** Smaller y plots higher (pace: faster = up). */
  invertY?: boolean;
  avg?: number | null;
  title: string;
  /** Formats a y value for the readout and the axis labels. */
  fmtY: (v: number) => string;
  unit?: string;
  onScrub?: (km: number | null) => void;
  /** Force the y-axis to include this value (e.g. 0). */
  includeY?: number;
  delay?: number;
};

const PAD = { l: 8, r: 8, t: 16, b: 22 };

/** Touch-scrubbable line / area chart. Drag horizontally to read values; haptic tick per km crossed. */
export const LineChart = memo(function LineChart(p: LineProps) {
  const { data, width, height = 150, color = colors.accent, fill, invertY, avg, fmtY, onScrub, includeY, delay = 250 } = p;
  const reduce = useReducedMotion();
  const [cursor, setCursor] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (data.length < 2) return null;
    let lo = Math.min(...data.map((d) => d.y));
    let hi = Math.max(...data.map((d) => d.y));
    if (avg != null) {
      lo = Math.min(lo, avg);
      hi = Math.max(hi, avg);
    }
    if (includeY != null) {
      lo = Math.min(lo, includeY);
      hi = Math.max(hi, includeY);
    }
    const span = Math.max(hi - lo, 1e-6);
    lo -= span * 0.12;
    hi += span * 0.12;
    const x0 = data[0].x;
    const x1 = data[data.length - 1].x;
    const w = width - PAD.l - PAD.r;
    const h = height - PAD.t - PAD.b;
    const px = (x: number) => PAD.l + ((x - x0) / Math.max(x1 - x0, 1e-6)) * w;
    const py = (y: number) => {
      const t = (y - lo) / (hi - lo);
      return PAD.t + (invertY ? t : 1 - t) * h;
    };
    const pts = data.map((d) => [px(d.x), py(d.y)] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${PAD.t + h} L${pts[0][0].toFixed(1)},${PAD.t + h} Z`;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { px, py, pts, line, area, len, lo, hi, x0, x1, h };
  }, [data, width, height, invertY, avg, includeY]);

  const prog = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    prog.value = reduce ? 1 : withDelay(delay, withTiming(1, { duration: 1200, easing: Easing.bezier(0.25, 0.1, 0.25, 1) }));
  }, [prog, delay, reduce, data]);
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: (geo?.len ?? 0) * (1 - prog.value) }));
  const fillProps = useAnimatedProps(() => ({ opacity: prog.value }));

  // pan handlers live in a ref, so they read the latest props through this mirror
  const live = useRef({ geo, data, onScrub });
  useEffect(() => {
    live.current = { geo, data, onScrub };
  });
  const lastKm = useRef(-1);

  const setFromX = (x: number) => {
    const { geo: g, data: d, onScrub: cb } = live.current;
    if (!g) return;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < g.pts.length; i++) {
      const dd = Math.abs(g.pts[i][0] - x);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    setCursor(best);
    cb?.(d[best].x);
    const km = Math.floor(d[best].x);
    if (km !== lastKm.current) {
      lastKm.current = km;
      Haptics.selectionAsync();
    }
  };
  const end = () => {
    setCursor(null);
    lastKm.current = -1;
    live.current.onScrub?.(null);
  };

  // The handlers only run on touch events (never during render), so reading refs inside them is safe.
  const pan = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
      onPanResponderTerminationRequest: () => false,
    }),
    // handlers read the latest props through `live`, so they are created once
    [],
  );

  if (!geo) return null;
  const cur = cursor != null ? data[cursor] : null;
  const gid = `g${color.replace('#', '')}${fill ? 'f' : 'l'}`;

  return (
    <View>
      <View style={s.head}>
        <Text style={label}>{p.title}</Text>
        <Text style={s.readout}>
          {cur ? `${fmtY(cur.y)}${p.unit ? ` ${p.unit}` : ''} · ${cur.x.toFixed(2)} km` : avg != null ? `avg ${fmtY(avg)}${p.unit ? ` ${p.unit}` : ''}` : ' '}
        </Text>
      </View>
      <View {...pan.panHandlers} style={{ width, height }}>
        <Svg width={width} height={height} pointerEvents="none">
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.32} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {[0.25, 0.5, 0.75].map((t) => (
            <Line key={t} x1={PAD.l} x2={width - PAD.r} y1={PAD.t + geo.h * t} y2={PAD.t + geo.h * t} stroke="#fff" strokeOpacity={0.06} strokeWidth={1} />
          ))}
          {fill && <AnimatedPath d={geo.area} fill={`url(#${gid})`} animatedProps={fillProps} />}
          {avg != null && (
            <Line x1={PAD.l} x2={width - PAD.r} y1={geo.py(avg)} y2={geo.py(avg)} stroke={colors.mute} strokeOpacity={0.7} strokeWidth={1} strokeDasharray="4 4" />
          )}
          <AnimatedPath
            d={geo.line}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={[geo.len, geo.len]}
            animatedProps={lineProps}
          />
          <SvgText x={PAD.l} y={height - 6} fill={colors.mute} fontSize={10} fontFamily={font.t500}>
            {geo.x0.toFixed(1)} km
          </SvgText>
          <SvgText x={width - PAD.r} y={height - 6} fill={colors.mute} fontSize={10} fontFamily={font.t500} textAnchor="end">
            {geo.x1.toFixed(1)} km
          </SvgText>
          {cursor != null && (
            <>
              <Line x1={geo.pts[cursor][0]} x2={geo.pts[cursor][0]} y1={PAD.t} y2={PAD.t + geo.h} stroke="#fff" strokeOpacity={0.5} strokeWidth={1} />
              <Circle cx={geo.pts[cursor][0]} cy={geo.pts[cursor][1]} r={5} fill={color} stroke={colors.bg} strokeWidth={2} />
            </>
          )}
        </Svg>
      </View>
    </View>
  );
});

type BarsProps = {
  rows: SplitRow[];
  avgPace: number;
  selected: number | null;
  onSelect: (km: number | null) => void;
};

/** Per-km split bars. Bar length is speed from zero (never truncated); the dashed tick is your average. */
export function SplitBars({ rows, avgPace, selected, onSelect }: BarsProps) {
  const reduce = useReducedMotion();
  const speeds = rows.map((r) => 3600 / r.pace);
  const max = Math.max(...speeds) * 1.08;
  const avgPos = 3600 / avgPace / max;
  const full = rows.filter((r) => !r.partial);
  const fast = full.length ? Math.min(...full.map((r) => r.pace)) : -1;
  const slow = full.length ? Math.max(...full.map((r) => r.pace)) : -1;

  return (
    <View>
      {rows.map((r, i) => (
        <Row
          key={r.km}
          row={r}
          index={i}
          len={speeds[i] / max}
          avgPos={avgPos}
          tone={r.partial ? 'mute' : r.pace === fast ? 'fast' : r.pace === slow && full.length > 2 ? 'slow' : 'mid'}
          active={selected === r.km}
          dim={selected != null && selected !== r.km}
          reduce={reduce}
          onPress={() => {
            Haptics.selectionAsync();
            onSelect(selected === r.km ? null : r.km);
          }}
        />
      ))}
    </View>
  );
}

const TONE = { fast: colors.accent, slow: colors.amber, mid: 'rgba(198,255,61,0.42)', mute: 'rgba(255,255,255,0.28)' };

function Row({
  row,
  index,
  len,
  avgPos,
  tone,
  active,
  dim,
  reduce,
  onPress,
}: {
  row: SplitRow;
  index: number;
  len: number;
  avgPos: number;
  tone: keyof typeof TONE;
  active: boolean;
  dim: boolean;
  reduce: boolean;
  onPress: () => void;
}) {
  const w = useSharedValue(reduce ? len : 0);
  useEffect(() => {
    w.value = reduce ? len : withDelay(250 + index * 70, withTiming(len, { duration: 650, easing: Easing.out(Easing.cubic) }));
  }, [w, len, index, reduce]);
  const bar = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  const d = Math.round(row.delta);
  return (
    <Pressable onPress={onPress} style={[s.row, active && s.rowOn, dim && { opacity: 0.45 }]}>
      <Text style={s.km}>{row.partial ? `${(row.dist / 1000).toFixed(2)}` : row.km}</Text>
      <View style={s.track}>
        <Animated.View style={[s.bar, { backgroundColor: TONE[tone] }, bar]} />
        <View style={[s.avgTick, { left: `${avgPos * 100}%` }]} />
      </View>
      <Text style={s.pace}>{formatPace(row.pace)}</Text>
      <Text style={[s.delta, { color: d < 0 ? colors.accent : d > 0 ? colors.amber : colors.mute }]}>
        {d === 0 ? '0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  readout: { color: colors.text, fontFamily: font.t600, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 6, borderRadius: 12 },
  rowOn: { backgroundColor: 'rgba(198,255,61,0.08)' },
  km: { width: 34, color: colors.mute, fontFamily: font.t600, fontSize: 13, textAlign: 'right' },
  track: { flex: 1, height: 14, borderRadius: 7, backgroundColor: colors.surface2, justifyContent: 'center' },
  bar: { height: '100%', borderRadius: 7 },
  avgTick: { position: 'absolute', top: -3, bottom: -3, width: 1.5, backgroundColor: 'rgba(255,255,255,0.7)' },
  pace: { width: 46, color: colors.text, fontFamily: font.d700, fontSize: 22, textAlign: 'right' },
  delta: { width: 34, fontFamily: font.t600, fontSize: 12, textAlign: 'right' },
});
