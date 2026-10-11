import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Polyline, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, font } from '../theme';
import { Digits } from './Digits';
import { formatDuration, formatPace } from '../lib/geo';
import { CANVAS, ROUTE_BOX, T, Path, buildPath, easeInOutCubic, seg, slicePath, toPoints } from '../lib/share';
import type { Coord } from '../lib/geo';

export type ShareOptions = { showTime: boolean; showPace: boolean; showElev: boolean };

export type ShareData = {
  title: string;
  when: string;
  coords: Coord[]; // already privacy-trimmed
  distance: number; // metres
  elapsed: number; // ms
  avgPace: number | null;
  elevGain: number | null;
};

const BRAND = 'strava'; // app name; change before release

/**
 * One frame of the share video. Pure function of `p` (0..1), so the in-app preview and the
 * frame-by-frame MP4 export render exactly the same pixels.
 */
export const ShareCanvas = memo(function ShareCanvas({ data, opts, p }: { data: ShareData; opts: ShareOptions; p: number }) {
  const path: Path = useMemo(() => buildPath(data.coords), [data.coords]);

  const draw = easeInOutCubic(seg(p, T.draw[0], T.draw[1]));
  const intro = seg(p, T.intro[0], T.intro[1]);
  const outro = seg(p, T.outro[0], T.outro[1]);
  const done = p >= T.draw[1];

  const upto = path.total * draw;
  const trail = slicePath(path, 0, upto);
  const comet = slicePath(path, Math.max(0, upto - path.total * 0.14), upto);
  const head = trail.length ? trail[trail.length - 1] : path.pts[0];
  const pulse = done ? 0.5 + 0.5 * Math.sin((p - T.draw[1]) * 60) : 1;

  const km = (data.distance * draw) / 1000;
  const stats = [
    opts.showTime && { k: 'Time', v: formatDuration(data.elapsed * draw), show: 1 },
    opts.showPace && { k: 'Avg pace', v: formatPace(data.avgPace), show: outro },
    opts.showElev && data.elevGain != null && { k: 'Climb', v: `${Math.round(data.elevGain * draw)}m`, show: 1 },
  ].filter(Boolean) as { k: string; v: string; show: number }[];

  return (
    <View style={s.canvas}>
      <Svg width={CANVAS.w} height={CANVAS.h} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="38%" r="55%">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.1} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="line" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7DFFB0" />
            <Stop offset="1" stopColor={colors.accent} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={CANVAS.w} height={CANVAS.h} fill="url(#glow)" />
        {/* faint street grid so the route has something to sit on */}
        {Array.from({ length: 9 }).map((_, i) => (
          <Line key={`h${i}`} x1={0} x2={CANVAS.w} y1={ROUTE_BOX.y - 20 + i * 32} y2={ROUTE_BOX.y - 14 + i * 32} stroke="#fff" strokeOpacity={0.045} strokeWidth={1} />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <Line key={`v${i}`} y1={ROUTE_BOX.y - 20} y2={ROUTE_BOX.y + 262} x1={i * 40 - 6} x2={i * 40 + 2} stroke="#fff" strokeOpacity={0.045} strokeWidth={1} />
        ))}

        {path.pts.length > 1 && (
          <>
            {/* faint ghost of the full route so you can see where it is heading */}
            <Polyline points={toPoints(path.pts)} fill="none" stroke="#fff" strokeOpacity={0.07} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            {trail.length > 1 && (
              <>
                <Polyline points={toPoints(trail)} fill="none" stroke={colors.accent} strokeOpacity={0.16} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
                <Polyline points={toPoints(trail)} fill="none" stroke="url(#line)" strokeOpacity={0.85} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
                {comet.length > 1 && <Polyline points={toPoints(comet)} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />}
              </>
            )}
            {/* start marker */}
            <Circle cx={path.pts[0][0]} cy={path.pts[0][1]} r={5} fill={colors.bg} stroke="#7DFFB0" strokeWidth={2} opacity={seg(p, 0.05, 0.1)} />
            {/* head dot */}
            <Circle cx={head[0]} cy={head[1]} r={16 + 4 * (1 - pulse)} fill={colors.accent} opacity={0.22 * (done ? pulse + 0.4 : 1)} />
            <Circle cx={head[0]} cy={head[1]} r={7} fill={done ? colors.accent : '#fff'} stroke={colors.bg} strokeWidth={2.5} />
          </>
        )}
      </Svg>

      {/* title block, inside the top safe area */}
      <View style={[s.title, { opacity: intro }]}>
        <Text style={s.kicker}>{data.title.toUpperCase()}</Text>
        <Text style={s.when}>{data.when}</Text>
      </View>

      {/* big distance */}
      <View style={s.distance}>
        <Digits value={km.toFixed(2)} size={92} />
        <Text style={s.unit}>KILOMETERS</Text>
      </View>

      {/* secondary stats */}
      {stats.length > 0 && (
        <View style={s.row}>
          {stats.map((st) => (
            <View key={st.k} style={[s.cell, { opacity: st.show }]}>
              <Digits value={st.v} size={30} weight={font.d700} />
              <Text style={s.cellK}>{st.k.toUpperCase()}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={s.brand}>{BRAND}</Text>
    </View>
  );
});

const s = StyleSheet.create({
  canvas: { width: CANVAS.w, height: CANVAS.h, backgroundColor: colors.bg, overflow: 'hidden' },
  title: { position: 'absolute', top: 92, left: 0, right: 0, alignItems: 'center' },
  kicker: { color: colors.accent, fontFamily: font.t700, fontSize: 12, letterSpacing: 2.2 },
  when: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 4 },
  distance: { position: 'absolute', top: 396, left: 0, right: 0, alignItems: 'center' },
  unit: { color: colors.mute, fontFamily: font.t600, fontSize: 11, letterSpacing: 2.4, marginTop: 2 },
  row: { position: 'absolute', top: 506, left: 24, right: 24, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  cell: { flex: 1, alignItems: 'center' },
  cellK: { color: colors.mute, fontFamily: font.t600, fontSize: 10, letterSpacing: 1.6, marginTop: 2 },
  brand: { position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center', color: colors.dim, fontFamily: font.d800, fontSize: 18, letterSpacing: 5, textTransform: 'uppercase' },
});
