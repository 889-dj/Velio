import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeIn, Easing } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors, font, label, radius } from '../theme';
import { Digits, emWidth, fitSize } from '../components/Digits';
import { LineChart, SplitBars } from '../components/charts';
import { Run, DEFAULT_WEIGHT_KG, deleteRun, loadRuns, loadWeight, saveWeight } from '../lib/storage';
import { Coord, formatDuration, formatKm, formatPace } from '../lib/geo';
import { titleOf, whenOf } from '../lib/format';
import {
  avgPaceOf,
  cadenceOf,
  caloriesOf,
  compareSimilar,
  elevationOf,
  insightsOf,
  paceSeries,
  recordsOf,
  splitRows,
  splitVerdict,
  strideOf,
  variability,
} from '../lib/insights';

type Props = NativeStackScreenProps<RootStackParamList, 'Activity'>;

const MAP_H = 330;
const enter = (i: number) => FadeInDown.delay(80 + i * 70).duration(480).easing(Easing.out(Easing.cubic));

const mixHex = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

export default function ActivityScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const map = useRef<MapView>(null);

  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [weight, setWeight] = useState(DEFAULT_WEIGHT_KG);
  const [weightOpen, setWeightOpen] = useState(false);
  const [draftWeight, setDraftWeight] = useState(DEFAULT_WEIGHT_KG);
  const [scrubKm, setScrubKm] = useState<number | null>(null);
  const [selectedKm, setSelectedKm] = useState<number | null>(null);
  const [paceColors, setPaceColors] = useState(true);
  const [speedMode, setSpeedMode] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [runs, w] = await Promise.all([loadRuns(), loadWeight()]);
      if (!alive) return;
      const found = runs.find((r) => r.id === route.params.id) ?? null;
      setHistory(runs);
      setWeight(w);
      setRun(found);
      setState(found ? 'ready' : 'missing');
    })();
    return () => {
      alive = false;
    };
  }, [route.params.id]);

  // ---------- derived insights ----------
  const a = useMemo(() => {
    if (!run) return null;
    const elev = elevationOf(run);
    const rows = splitRows(run, elev);
    const verdict = splitVerdict(rows);
    const cadence = cadenceOf(run);
    const similar = compareSimilar(run, history);
    return {
      elev,
      rows,
      verdict,
      cadence,
      similar,
      pace: paceSeries(run),
      avg: avgPaceOf(run),
      variability: variability(rows),
      records: recordsOf(run, rows, history),
      stride: strideOf(run),
      insights: insightsOf({ rows, verdict, cadence, similar, elev }),
    };
  }, [run, history]);

  const coords = useMemo(() => (run ? run.segments.flat() : []), [run]);
  const aligned = !!run?.track && coords.length === run.track.length;

  const coordAtKm = (km: number): Coord | null => {
    if (!run?.track || !aligned) return null;
    const tr = run.track;
    let i = 0;
    while (i < tr.length - 1 && tr[i][1] / 1000 < km) i++;
    return coords[i];
  };

  // route layers
  const layers = useMemo(() => {
    if (!run) return [];
    const out: { key: string; coords: Coord[]; color: string; width: number }[] = [];
    const tr = run.track;
    let offset = 0;
    run.segments.forEach((seg, si) => {
      if (seg.length > 1) {
        out.push({ key: `g${si}`, coords: seg, color: 'rgba(198,255,61,0.16)', width: 16 });
        out.push({ key: `c${si}`, coords: seg, color: 'rgba(11,11,12,0.85)', width: 9 });
        if (paceColors && aligned && tr) {
          const chunks: { c: Coord[]; pace: number }[] = [];
          for (let i = 0; i < seg.length - 1; i += 5) {
            const c = seg.slice(i, Math.min(i + 6, seg.length));
            const a0 = tr[offset + i];
            const a1 = tr[offset + Math.min(i + 5, seg.length - 1)];
            const dd = a1[1] - a0[1];
            chunks.push({ c, pace: dd > 5 ? (a1[0] - a0[0]) / 1000 / (dd / 1000) : NaN });
          }
          const ps = chunks.map((c) => c.pace).filter((p) => isFinite(p)).sort((x, y) => x - y);
          const lo = ps[Math.floor(ps.length * 0.1)] ?? 0;
          const hi = ps[Math.floor(ps.length * 0.9)] ?? 1;
          chunks.forEach((ch, ci) => {
            const t = isFinite(ch.pace) ? Math.min(1, Math.max(0, (ch.pace - lo) / Math.max(hi - lo, 1))) : 0.5;
            // fast = lime, slow = amber
            out.push({ key: `p${si}-${ci}`, coords: ch.c, color: mixHex('#C6FF3D', '#FFB020', t), width: 5 });
          });
        } else {
          out.push({ key: `l${si}`, coords: seg, color: colors.accent, width: 5 });
        }
      }
      offset += seg.length;
    });
    return out;
  }, [run, paceColors, aligned]);

  const kmSlice = (km: number) => {
    if (!run?.track || !aligned) return [];
    const lo = (km - 1) * 1000;
    const hi = km * 1000;
    return coords.filter((_, i) => run.track![i][1] >= lo && run.track![i][1] <= hi + 40);
  };

  const fit = (pts: Coord[], animated: boolean, bottom = 150) => {
    if (pts.length < 2) return;
    map.current?.fitToCoordinates(pts, { edgePadding: { top: 110, right: 40, bottom, left: 40 }, animated });
  };
  useEffect(() => {
    if (selectedKm == null) return fit(coords, true);
    const seg = kmSlice(selectedKm);
    if (seg.length > 1) fit(seg, true, 170);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKm]);

  const confirmDelete = () =>
    Alert.alert('Delete this activity?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (run) await deleteRun(run.id);
          navigation.goBack();
        },
      },
    ]);

  // ---------- states ----------
  if (state === 'loading') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (state === 'missing' || !run || !a) {
    return (
      <View style={[s.root, s.center, { padding: 32 }]}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.dim} />
        <Text style={s.emptyTitle}>We couldn’t find this activity</Text>
        <Text style={s.emptySub}>It may have been deleted.</Text>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backTxt}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const chartW = width - 40 - 32;
  const hasTrack = !!run.track && run.track.length > 5;
  const kcal = caloriesOf(run, weight);
  const climbPerKm = a.elev ? a.elev.gain / Math.max(run.distance / 1000, 0.1) : 0;
  const paceData = speedMode ? a.pace.map((p) => ({ x: p.x, y: 3600 / p.y })) : a.pace;
  const paceAvg = a.avg == null ? null : speedMode ? 3600 / a.avg : a.avg;
  const marker = scrubKm != null ? coordAtKm(scrubKm) : null;

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}>
        {/* map hero */}
        <View style={{ height: MAP_H + insets.top * 0 }}>
          <MapView
            ref={map}
            style={StyleSheet.absoluteFill}
            userInterfaceStyle="dark"
            mapType="mutedStandard"
            customMapStyle={darkMapStyle}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            showsCompass={false}
            showsPointsOfInterests={false}
            onMapReady={() => fit(coords, false)}
          >
            {layers.map((l) => (
              <Polyline
                key={l.key}
                coordinates={l.coords}
                strokeColor={selectedKm != null && l.width === 5 ? withAlpha(l.color, 0.3) : l.color}
                strokeWidth={l.width}
                lineCap="round"
                lineJoin="round"
              />
            ))}
            {selectedKm != null && kmSlice(selectedKm).length > 1 && (
              <Polyline coordinates={kmSlice(selectedKm)} strokeColor="#FFFFFF" strokeWidth={6} lineCap="round" lineJoin="round" />
            )}
            {coords.length > 0 && (
              <Marker coordinate={coords[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={s.startDot} />
              </Marker>
            )}
            {coords.length > 1 && (
              <Marker coordinate={coords[coords.length - 1]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={s.endDot}>
                  <Ionicons name="flag" size={11} color={colors.onAccent} />
                </View>
              </Marker>
            )}
            {marker && (
              <Marker coordinate={marker} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={s.scrubHalo}>
                  <View style={s.scrubDot} />
                </View>
              </Marker>
            )}
          </MapView>

          <LinearGradient colors={['rgba(11,11,12,0.9)', 'rgba(11,11,12,0)']} style={[s.topFade, { height: insets.top + 80 }]} pointerEvents="none" />
          <LinearGradient colors={['rgba(11,11,12,0)', colors.bg]} style={s.bottomFade} pointerEvents="none" />

          <View style={[s.topRow, { top: insets.top + 8 }]}>
            <GlassButton icon="chevron-back" onPress={() => navigation.goBack()} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <GlassButton icon="share-outline" onPress={() => navigation.navigate('Share', { id: run.id })} />
              <GlassButton icon="trash-outline" onPress={confirmDelete} />
            </View>
          </View>

          {aligned && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setPaceColors((v) => !v);
              }}
              style={s.mapChip}
            >
              <View style={[s.mapChipDot, { backgroundColor: paceColors ? colors.accent : colors.dim }]} />
              <Text style={s.mapChipTxt}>Pace colours</Text>
            </Pressable>
          )}

          <View style={s.titleBlock} pointerEvents="none">
            <Text style={s.title}>{titleOf(run)}</Text>
            <Text style={s.when}>{whenOf(run.startedAt)}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          {/* headline numbers */}
          <Animated.View entering={enter(0)} style={s.trio}>
            {(() => {
              const vals = [formatKm(run.distance), formatDuration(run.elapsed), formatPace(a.avg)];
              const size = fitSize(vals, width - 40, 48);
              return (
                <>
                  <Big label="Distance · km" value={vals[0]} size={size} />
                  <View style={s.vr} />
                  <Big label="Time" value={vals[1]} size={size} />
                  <View style={s.vr} />
                  <Big label="Avg pace · /km" value={vals[2]} size={size} />
                </>
              );
            })()}
          </Animated.View>

          {a.records.length > 0 && (
            <Animated.View entering={enter(1)} style={s.badges}>
              {a.records.map((r) => (
                <View key={r} style={s.badge}>
                  <Ionicons name="trophy" size={12} color={colors.onAccent} />
                  <Text style={s.badgeTxt}>{r}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* what we noticed */}
          {a.insights.length > 0 && (
            <Animated.View entering={enter(2)} style={s.card}>
              <Text style={[label, { marginBottom: 12 }]}>What we noticed</Text>
              {a.insights.map((ins, i) => (
                <View key={i} style={[s.insight, i > 0 && { marginTop: 14 }]}>
                  <View style={[s.insightIcon, { backgroundColor: ins.tone === 'good' ? colors.accentDim : ins.tone === 'warn' ? 'rgba(255,176,32,0.14)' : colors.surface2 }]}>
                    <Ionicons name={ins.icon} size={16} color={ins.tone === 'good' ? colors.accent : ins.tone === 'warn' ? colors.amber : colors.mute} />
                  </View>
                  <Text style={s.insightTxt}>{ins.text}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* pace */}
          {hasTrack && a.pace.length > 3 ? (
            <Animated.View entering={enter(3)} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardTitle}>Pace</Text>
                <View style={s.seg}>
                  {['Pace', 'Speed'].map((m) => {
                    const on = (m === 'Speed') === speedMode;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSpeedMode(m === 'Speed');
                        }}
                        style={[s.segItem, on && s.segOn]}
                      >
                        <Text style={[s.segTxt, on && { color: colors.onAccent }]}>{m}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View>
                <LineChart
                  title={speedMode ? 'Speed' : 'Pace'}
                  data={paceData}
                  width={chartW}
                  invertY={!speedMode}
                  avg={paceAvg}
                  fmtY={(v) => (speedMode ? v.toFixed(1) : formatPace(v))}
                  unit={speedMode ? 'km/h' : '/km'}
                  onScrub={setScrubKm}
                />
              </View>
              <Text style={s.note}>
                Faster is higher. Drag across the chart to see where on the route you were.
                {climbPerKm > 15 ? ' This run was hilly, so slower stretches often match the climbs.' : ''}
              </Text>
            </Animated.View>
          ) : (
            <Animated.View entering={enter(3)} style={s.card}>
              <Text style={s.cardTitle}>Pace chart</Text>
              <Text style={s.note}>Detailed pace, elevation and cadence charts are recorded for activities from this version on. This one has splits only.</Text>
            </Animated.View>
          )}

          {/* splits */}
          {a.rows.length > 0 && a.avg != null && (
            <Animated.View entering={enter(4)} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardTitle}>Splits</Text>
                <Text style={s.cardMeta}>vs avg, s/km</Text>
              </View>
              <SplitBars rows={a.rows} avgPace={a.avg} selected={selectedKm} onSelect={setSelectedKm} />
              <Text style={s.note}>
                Bar length is speed from zero; the white tick is your average.{aligned ? ' Tap a km to see it on the map.' : ''}
              </Text>
              {(a.verdict || a.variability) && (
                <View style={s.pillRow}>
                  {a.verdict && (
                    <Pill
                      text={a.verdict.kind === 'negative' ? 'Negative split' : a.verdict.kind === 'positive' ? 'Positive split' : 'Even split'}
                      sub={`${a.verdict.pct > 0 ? '+' : ''}${a.verdict.pct.toFixed(1)}%`}
                    />
                  )}
                  {a.variability && <Pill text={`${a.variability.word} pacing`} sub={`CV ${a.variability.cv.toFixed(1)}%`} />}
                </View>
              )}
            </Animated.View>
          )}

          {/* elevation */}
          {hasTrack && (
            <Animated.View entering={enter(5)} style={s.card}>
              <Text style={s.cardTitle}>Elevation</Text>
              {a.elev && a.elev.series.length > 3 ? (
                <>
                  <View style={s.elevStats}>
                    <Mini label="Gain" value={`${Math.round(a.elev.gain)} m`} />
                    <Mini label="Loss" value={`${Math.round(a.elev.loss)} m`} />
                    <Mini label="High" value={`${Math.round(a.elev.max)} m`} />
                    <Mini label="Low" value={`${Math.round(a.elev.min)} m`} />
                  </View>
                  <View>
                    <LineChart
                      title="Altitude"
                      data={a.elev.series}
                      width={chartW}
                      height={130}
                      fill
                      color="#7DFFB0"
                      fmtY={(v) => `${Math.round(v)}`}
                      unit="m"
                      onScrub={setScrubKm}
                      delay={350}
                    />
                  </View>
                  <Text style={s.note}>
                    Estimated from phone GPS altitude, smoothed and filtered, so it can differ from other apps.
                    {a.elev.suspicious ? ' Altitude looks noisy on this run; treat the climb with caution.' : ''}
                  </Text>
                </>
              ) : (
                <Text style={s.note}>This phone didn’t report enough altitude data for this run.</Text>
              )}
            </Animated.View>
          )}

          {/* cadence */}
          {a.cadence && (
            <Animated.View entering={enter(6)} style={s.card}>
              <Text style={s.cardTitle}>Cadence</Text>
              {a.cadence.series.length > 3 ? (
                <View>
                  <LineChart
                    title="Steps per minute"
                    data={a.cadence.series}
                    width={chartW}
                    height={130}
                    color="#FFFFFF"
                    avg={a.cadence.avg}
                    fmtY={(v) => `${Math.round(v)}`}
                    unit="spm"
                    onScrub={setScrubKm}
                    delay={450}
                  />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
                  <Digits value={String(a.cadence.avg)} size={40} weight={font.d700} />
                  <Text style={s.cardMeta}>steps / min average</Text>
                </View>
              )}
              <Text style={s.note}>
                Most recreational runners sit between 160 and 180, and cadence rises with speed. Compare it with your own average rather than a target.
              </Text>
            </Animated.View>
          )}

          {/* details */}
          <Animated.View entering={enter(7)} style={s.card}>
            <Text style={[s.cardTitle, { marginBottom: 6 }]}>Details</Text>
            <Row k="Moving time" v={formatDuration(run.elapsed)} />
            <Row k="Steps" v={run.steps > 0 ? run.steps.toLocaleString() : '—'} />
            {a.stride != null && <Row k="Average stride" v={`${a.stride.toFixed(2)} m`} hint="distance ÷ steps" />}
            {a.elev && <Row k="Elevation gain" v={`${Math.round(a.elev.gain)} m`} hint="estimated, filtered" />}
            <Pressable
              onPress={() => {
                setDraftWeight(weight);
                setWeightOpen(true);
              }}
              style={s.detailRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.detailK}>Calories (estimate)</Text>
                <Text style={s.detailHint}>Based on {weight} kg · tap to change · ±20%</Text>
              </View>
              <Text style={s.detailV}>≈ {kcal}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.dim} style={{ marginLeft: 6 }} />
            </Pressable>
            {a.similar && (
              <Row
                k="Vs similar runs"
                v={`${a.similar.deltaSec <= 0 ? '−' : '+'}${Math.round(Math.abs(a.similar.deltaSec))} s/km`}
                hint={`last ${a.similar.count} runs of similar length`}
                last
              />
            )}
          </Animated.View>
        </View>
      </ScrollView>

      {/* weight editor for the calorie estimate */}
      <Modal visible={weightOpen} transparent animationType="fade" onRequestClose={() => setWeightOpen(false)}>
        <View style={s.modalBack}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <Animated.View entering={FadeIn} style={s.modal}>
            <Text style={s.modalTitle}>Your weight</Text>
            <Text style={s.modalSub}>Only used to estimate calories. It stays on this phone.</Text>
            <View style={s.stepper}>
              <Step label="−5" onPress={() => setDraftWeight((w) => Math.max(30, w - 5))} />
              <Step label="−1" onPress={() => setDraftWeight((w) => Math.max(30, w - 1))} />
              <Text style={s.weightVal}>
                {draftWeight}
                <Text style={s.weightUnit}> kg</Text>
              </Text>
              <Step label="+1" onPress={() => setDraftWeight((w) => Math.min(200, w + 1))} />
              <Step label="+5" onPress={() => setDraftWeight((w) => Math.min(200, w + 5))} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <Pressable onPress={() => setWeightOpen(false)} style={[s.modalBtn, { backgroundColor: colors.surface2 }]}>
                <Text style={s.modalBtnTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await saveWeight(draftWeight);
                  setWeight(draftWeight);
                  setWeightOpen(false);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }}
                style={[s.modalBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={[s.modalBtnTxt, { color: colors.onAccent }]}>Save</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const withAlpha = (hex: string, a: number) => {
  if (!hex.startsWith('#')) return hex;
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
};

function Big({ label: l, value, size }: { label: string; value: string; size: number }) {
  return (
    <View style={{ flex: emWidth(value) + 1, alignItems: 'center' }}>
      <Digits value={value} size={size} weight={font.d800} />
      <Text style={[label, { marginTop: 2, fontSize: 10, letterSpacing: 1 }]} numberOfLines={1}>
        {l}
      </Text>
    </View>
  );
}

function Mini({ label: l, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.miniV}>{value}</Text>
      <Text style={s.miniK}>{l}</Text>
    </View>
  );
}

function Row({ k, v, hint, last }: { k: string; v: string; hint?: string; last?: boolean }) {
  return (
    <View style={[s.detailRow, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.detailK}>{k}</Text>
        {hint ? <Text style={s.detailHint}>{hint}</Text> : null}
      </View>
      <Text style={s.detailV}>{v}</Text>
    </View>
  );
}

function Pill({ text, sub }: { text: string; sub: string }) {
  return (
    <View style={s.pill}>
      <Text style={s.pillTxt}>{text}</Text>
      <Text style={s.pillSub}>{sub}</Text>
    </View>
  );
}

function Step({ label: l, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={s.step}
    >
      <Text style={s.stepTxt}>{l}</Text>
    </Pressable>
  );
}

function GlassButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={s.glass}>
      <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#11141a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6f7683' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#11141a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#222833' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#080a0d' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.d800, fontSize: 28, marginTop: 12 },
  emptySub: { color: colors.mute, fontFamily: font.t500, fontSize: 14, marginTop: 4 },
  backBtn: { marginTop: 20, height: 48, paddingHorizontal: 28, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 15 },

  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomFade: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 150 },
  topRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  glass: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
  mapChip: { position: 'absolute', right: 16, bottom: 74, flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(23,24,27,0.85)', borderWidth: 1, borderColor: colors.hairline },
  mapChipDot: { width: 8, height: 8, borderRadius: 4 },
  mapChipTxt: { color: colors.text, fontFamily: font.t600, fontSize: 12 },
  titleBlock: { position: 'absolute', left: 20, bottom: 18 },
  title: { color: colors.text, fontFamily: font.d800, fontSize: 40, lineHeight: 42 },
  when: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 2 },

  startDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.bg, borderWidth: 3, borderColor: '#7DFFB0' },
  endDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg },
  scrubHalo: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  scrubDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 3, borderColor: colors.bg },

  trio: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6 },
  vr: { width: 1, height: 40, backgroundColor: colors.hairline },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  badgeTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 12 },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, padding: 16, marginTop: 14 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { color: colors.text, fontFamily: font.t700, fontSize: 17 },
  cardMeta: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },
  note: { color: colors.mute, fontFamily: font.t500, fontSize: 12, lineHeight: 17, marginTop: 10 },

  insight: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  insightIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  insightTxt: { flex: 1, color: colors.text, fontFamily: font.t500, fontSize: 14, lineHeight: 20, paddingTop: 5 },

  seg: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.pill, padding: 3 },
  segItem: { height: 30, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  segTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 12 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: { flexDirection: 'row', alignItems: 'baseline', gap: 6, backgroundColor: colors.surface2, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  pillTxt: { color: colors.text, fontFamily: font.t600, fontSize: 12 },
  pillSub: { color: colors.mute, fontFamily: font.t500, fontSize: 11 },

  elevStats: { flexDirection: 'row', marginBottom: 10 },
  miniV: { color: colors.text, fontFamily: font.d700, fontSize: 24 },
  miniK: { color: colors.mute, fontFamily: font.t600, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },

  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.hairline, minHeight: 48 },
  detailK: { color: colors.text, fontFamily: font.t600, fontSize: 14 },
  detailHint: { color: colors.mute, fontFamily: font.t500, fontSize: 11, marginTop: 2 },
  detailV: { color: colors.text, fontFamily: font.d700, fontSize: 24 },

  modalBack: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 24 },
  modal: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, padding: 20 },
  modalTitle: { color: colors.text, fontFamily: font.d800, fontSize: 28 },
  modalSub: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 },
  step: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { color: colors.text, fontFamily: font.t700, fontSize: 14 },
  weightVal: { color: colors.text, fontFamily: font.d800, fontSize: 44, minWidth: 90, textAlign: 'center' },
  weightUnit: { color: colors.mute, fontFamily: font.d700, fontSize: 18 },
  modalBtn: { flex: 1, height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  modalBtnTxt: { color: colors.text, fontFamily: font.t700, fontSize: 15 },
});
