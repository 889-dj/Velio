import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, ZoomIn } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { useRunTracker } from '../hooks/useRunTracker';
import { formatDuration, formatKm, formatPace } from '../lib/geo';
import { colors, font, label, radius } from '../theme';
import { Digits, emWidth, fitSize } from '../components/Digits';
import { CountUp } from '../components/CountUp';
import { HoldButton } from '../components/HoldButton';
import { clearActive, saveRun } from '../lib/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Tracking'>;

export default function TrackingScreen({ navigation, route }: Props) {
  const sport = route.params?.sport ?? 'run';
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const t = useRunTracker();
  const map = useRef<MapView>(null);
  const [count, setCount] = useState<number | null>(null);
  const [toast, setToast] = useState<{ km: number; ms: number } | null>(null);

  const last = t.segments.length ? t.segments[t.segments.length - 1] : [];
  const head = last.length ? last[last.length - 1] : null;
  const start = t.segments[0]?.[0] ?? null;
  const all = t.segments.flat();

  const idle = t.status === 'idle';
  const running = t.status === 'running';
  const paused = t.status === 'paused';
  const finished = t.status === 'finished';

  // keep the screen on while a run is in progress
  useEffect(() => {
    if (running || paused) activateKeepAwakeAsync('run');
    return () => {
      deactivateKeepAwake('run');
    };
  }, [running, paused]);

  // follow the runner
  useEffect(() => {
    const target = head ?? t.initial;
    if (target && !finished) {
      map.current?.animateCamera({ center: target, zoom: 17.5, pitch: 0 }, { duration: 700 });
    }
  }, [head, t.initial, finished]);

  // frame the whole route when done
  useEffect(() => {
    if (!finished || all.length < 2) return;
    map.current?.fitToCoordinates(all, {
      edgePadding: { top: 90, right: 50, bottom: Math.min(height * 0.55, 470), left: 50 },
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // km split toast + haptic, driven by the tracker rather than an effect
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdown = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setOnSplit } = t;
  useEffect(() => {
    setOnSplit((sp) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast(sp);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
    });
    return () => {
      setOnSplit(null);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (countdown.current) clearInterval(countdown.current);
    };
  }, [setOnSplit]);

  const begin = () => {
    if (t.permission === 'denied') {
      Alert.alert('Location needed', 'Allow location access so your route can be traced.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    // 3-2-1, then go
    let n = 3;
    setCount(n);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    countdown.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        if (countdown.current) clearInterval(countdown.current);
        countdown.current = null;
        setCount(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        t.start(sport);
      }
    }, 900);
  };

  const close = () => {
    if (idle || finished) return navigation.goBack();
    Alert.alert('Discard this run?', 'Your current activity will be lost.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  };

  const discard = async () => {
    t.finish();
    await clearActive();
    navigation.goBack();
  };

  const confirmDiscard = () =>
    Alert.alert('Discard this activity?', 'It will not be saved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);

  const save = async () => {
    const run = t.buildRun();
    await saveRun(run);
    await clearActive();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    navigation.replace('Activity', { id: run.id });
  };

  const locate = () => {
    const target = head ?? t.initial;
    if (target) map.current?.animateCamera({ center: target, zoom: 17.5 }, { duration: 400 });
  };

  const cadenceAvg = t.elapsed > 20000 ? Math.round(t.steps / (t.elapsed / 60000)) : 0;
  const statusText = running ? 'Recording' : paused ? 'Paused' : finished ? 'Complete' : t.initial ? 'GPS ready' : 'Locating…';
  const statusColor = running ? colors.accent : paused ? colors.amber : finished ? colors.accent : t.initial ? colors.accent : colors.mute;

  return (
    <View style={s.root}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle="dark"
        mapType="mutedStandard"
        showsUserLocation={idle}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        pitchEnabled={false}
        customMapStyle={darkMapStyle}
        initialRegion={t.initial ? { ...t.initial, latitudeDelta: 0.004, longitudeDelta: 0.004 } : undefined}
      >
        {t.segments.map((seg, i) =>
          seg.length > 1 ? (
            <Group key={i} coords={seg} />
          ) : null,
        )}
        {start && !idle && (
          <Marker coordinate={start} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={s.startDot} />
          </Marker>
        )}
        {head && !idle && (
          <Marker coordinate={head} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            {finished ? (
              <View style={s.endDot}><Ionicons name="flag" size={12} color={colors.onAccent} /></View>
            ) : (
              <View style={s.halo}><View style={s.me} /></View>
            )}
          </Marker>
        )}
      </MapView>

      {/* top scrim + readout */}
      <LinearGradient
        colors={['rgba(7,8,10,0.96)', 'rgba(7,8,10,0.7)', 'rgba(7,8,10,0)']}
        locations={[0, 0.55, 1]}
        style={[s.scrim, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={s.topRow}>
          <GlassButton onPress={close} icon="close" />
          <View style={s.pill}>
            <View style={[s.dot, { backgroundColor: statusColor }]} />
            <Text style={s.pillTxt}>{statusText}</Text>
          </View>
          <GlassButton onPress={locate} icon="locate" />
        </View>

        {!finished && (
          <Animated.View entering={FadeIn.delay(150)} style={s.readout} pointerEvents="none">
            <Digits value={formatKm(t.distance)} size={Math.min(136, height * 0.16)} />
            <Text style={[label, { marginTop: 2 }]}>Kilometers</Text>
          </Animated.View>
        )}

        {!finished && !idle && (
          <View style={s.gpsRow} pointerEvents="none">
            <View style={[s.gpsDot, { backgroundColor: t.gps === 'good' ? colors.accent : t.gps === 'weak' ? colors.amber : colors.danger }]} />
            <Text style={s.gpsTxt}>
              GPS {t.gps === 'good' ? 'good' : t.gps === 'weak' ? 'weak' : t.gps === 'lost' ? 'lost' : 'searching'}
              {t.accuracy != null && t.gps !== 'lost' ? ` · ±${Math.round(t.accuracy)} m` : ''}
            </Text>
          </View>
        )}

        {running && t.gps === 'lost' && (
          <Animated.View entering={FadeInDown} exiting={FadeOut} style={s.lost}>
            <Ionicons name="warning" size={16} color={colors.amber} />
            <Text style={s.lostTxt}>GPS signal lost. Distance keeps counting from your steps.</Text>
          </Animated.View>
        )}

        {toast && !finished && (
          <Animated.View entering={FadeInDown.springify().damping(14)} exiting={FadeOut} style={s.toast}>
            <Ionicons name="flag" size={14} color={colors.onAccent} />
            <Text style={s.toastTxt}>
              KM {toast.km} · {formatPace(toast.ms / 1000)} /km
            </Text>
          </Animated.View>
        )}
      </LinearGradient>

      {/* countdown */}
      {count != null && count > 0 && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={s.count} pointerEvents="none">
          <Animated.Text key={count} entering={ZoomIn.springify().damping(12)} style={s.countTxt}>
            {count}
          </Animated.Text>
        </Animated.View>
      )}

      {/* bottom panel */}
      <Animated.View
        key={t.status}
        entering={FadeInUp.duration(380)}
        style={[s.panelWrap]}
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[s.panel, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.grabber} />

          {idle && (
            <>
              <View style={s.idleRow}>
                <View>
                  <Text style={s.idleTitle}>Ready when you are</Text>
                  <Text style={s.idleSub}>
                    {t.permission === 'denied' ? 'Location is off — route can’t be traced' : t.initial ? 'GPS locked · step sensor on' : 'Finding your location…'}
                  </Text>
                </View>
                <View style={[s.gps, { borderColor: t.initial ? colors.accent : colors.dim }]}>
                  <Ionicons name="navigate" size={18} color={t.initial ? colors.accent : colors.dim} />
                </View>
              </View>
              <Pressable onPress={begin} style={({ pressed }) => [s.startBtn, pressed && { transform: [{ scale: 0.98 }] }]}>
                <Ionicons name="play" size={24} color={colors.onAccent} />
                <Text style={s.startTxt}>Start</Text>
              </Pressable>
            </>
          )}

          {(running || paused) && (
            <>
              <View style={s.metrics}>
                {(() => {
                  const vals = [formatDuration(t.elapsed), formatPace(t.currentPace), t.pedometerOk ? String(t.cadence || '--') : '--'];
                  const size = fitSize(vals, width - 40, 44);
                  return (
                    <>
                      <Metric label="Time" value={vals[0]} size={size} />
                      <View style={s.vr} />
                      <Metric label="Pace /km" value={vals[1]} size={size} />
                      <View style={s.vr} />
                      <Metric label="Cadence" value={vals[2]} size={size} />
                    </>
                  );
                })()}
              </View>

              {running ? (
                <View style={s.ctrlRow}>
                  <Chip icon="footsteps" text={t.pedometerOk ? `${t.steps}` : '—'} sub="steps" />
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      t.pause();
                    }}
                    style={({ pressed }) => [s.pause, pressed && { transform: [{ scale: 0.94 }] }]}
                  >
                    <Ionicons name="pause" size={34} color={colors.onAccent} />
                  </Pressable>
                  <Chip icon="speedometer" text={formatPace(t.avgPace)} sub="avg /km" />
                </View>
              ) : (
                <View style={s.ctrlRow}>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      t.resume();
                    }}
                    style={({ pressed }) => [s.resume, pressed && { transform: [{ scale: 0.98 }] }]}
                  >
                    <Ionicons name="play" size={22} color={colors.onAccent} />
                    <Text style={s.startTxt}>Resume</Text>
                  </Pressable>
                  <View style={{ alignItems: 'center', gap: 4 }}>
                    <HoldButton
                      size={72}
                      onComplete={() => {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        t.finish();
                      }}
                    >
                      <Ionicons name="stop" size={26} color={colors.danger} />
                    </HoldButton>
                    <Text style={s.holdHint}>HOLD TO FINISH</Text>
                  </View>
                </View>
              )}
            </>
          )}

          {finished && <Summary t={t} cadenceAvg={cadenceAvg} onSave={save} onDiscard={confirmDiscard} />}
        </View>
      </Animated.View>
    </View>
  );
}

/** Route drawn as glow + casing + core line so it reads over any map. */
function Group({ coords }: { coords: { latitude: number; longitude: number }[] }) {
  return (
    <>
      <Polyline coordinates={coords} strokeColor="rgba(200,255,46,0.18)" strokeWidth={16} lineCap="round" lineJoin="round" />
      <Polyline coordinates={coords} strokeColor="rgba(7,8,10,0.85)" strokeWidth={9} lineCap="round" lineJoin="round" />
      <Polyline coordinates={coords} strokeColor={colors.accent} strokeWidth={5} lineCap="round" lineJoin="round" />
    </>
  );
}

function Summary({
  t,
  cadenceAvg,
  onSave,
  onDiscard,
}: {
  t: ReturnType<typeof useRunTracker>;
  cadenceAvg: number;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const { width } = useWindowDimensions();
  const fastest = t.splits.length ? Math.min(...t.splits.map((x) => x.ms)) : 0;
  const slowest = t.splits.length ? Math.max(...t.splits.map((x) => x.ms)) : 0;
  return (
    <>
      <View style={{ alignItems: 'center', marginTop: 2 }}>
        <Text style={label}>Run complete</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <CountUp to={t.distance / 1000} size={96} decimals={2} delay={150} duration={900} />
          <Text style={s.unit}>km</Text>
        </View>
      </View>

      <View style={[s.metrics, { marginTop: 4 }]}>
        {(() => {
          const vals = [formatDuration(t.elapsed), formatPace(t.avgPace), t.pedometerOk ? String(t.steps) : '--'];
          const size = fitSize(vals, width - 40, 44);
          return (
            <>
              <Metric label="Time" value={vals[0]} size={size} />
              <View style={s.vr} />
              <Metric label="Avg pace" value={vals[1]} size={size} />
              <View style={s.vr} />
              <Metric label="Steps" value={vals[2]} size={size} />
            </>
          );
        })()}
      </View>

      <Text style={[label, { marginTop: 16, marginBottom: 8 }]}>Splits{cadenceAvg ? ` · ${cadenceAvg} spm avg` : ''}</Text>
      <ScrollView style={{ maxHeight: 120 }} showsVerticalScrollIndicator={false}>
        {t.splits.length === 0 ? (
          <Text style={s.idleSub}>Run a full kilometre to see splits.</Text>
        ) : (
          t.splits.map((sp) => {
            const w = slowest === fastest ? 1 : 0.45 + 0.55 * (1 - (sp.ms - fastest) / (slowest - fastest));
            return (
              <View key={sp.km} style={s.splitRow}>
                <Text style={s.splitKm}>{sp.km}</Text>
                <View style={s.splitTrack}>
                  <View style={[s.splitFill, { width: `${w * 100}%`, opacity: sp.ms === fastest ? 1 : 0.55 }]} />
                </View>
                <Text style={s.splitPace}>{formatPace(sp.ms / 1000)}</Text>
              </View>
            );
          })
        )}
      </ScrollView>

      <Pressable onPress={onSave} style={({ pressed }) => [s.startBtn, { marginTop: 16 }, pressed && { transform: [{ scale: 0.98 }] }]}>
        <Text style={s.startTxt}>Save activity</Text>
      </Pressable>
      <Pressable onPress={onDiscard} style={{ alignItems: 'center', paddingTop: 14 }}>
        <Text style={s.discard}>Discard</Text>
      </Pressable>
    </>
  );
}

function Metric({ label: l, value, size }: { label: string; value: string; size: number }) {
  return (
    <View style={{ flex: emWidth(value) + 1, alignItems: 'center' }}>
      <Digits value={value} size={size} weight={font.d700} />
      <Text style={[label, { marginTop: 2 }]}>{l}</Text>
    </View>
  );
}

function Chip({ icon, text, sub }: { icon: keyof typeof Ionicons.glyphMap; text: string; sub: string }) {
  return (
    <View style={s.chip}>
      <Ionicons name={icon} size={16} color={colors.mute} />
      <Text style={s.chipV}>{text}</Text>
      <Text style={s.chipS}>{sub}</Text>
    </View>
  );
}

function GlassButton({ onPress, icon }: { onPress: () => void; icon: keyof typeof Ionicons.glyphMap }) {
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

  scrim: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 56 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  glass: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(16,18,22,0.8)', borderWidth: 1, borderColor: colors.hairline },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillTxt: { color: colors.text, fontFamily: font.t600, fontSize: 12, letterSpacing: 0.4 },
  readout: { alignItems: 'center', marginTop: 10 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  gpsTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 12 },
  lost: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', marginTop: 12, backgroundColor: 'rgba(255,176,32,0.14)', borderColor: 'rgba(255,176,32,0.4)', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  lostTxt: { color: colors.text, fontFamily: font.t600, fontSize: 12 },
  toast: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  toastTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 13 },

  startDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.bg, borderWidth: 3, borderColor: '#7DFFB0' },
  halo: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(200,255,46,0.22)', alignItems: 'center', justifyContent: 'center' },
  me: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
  endDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg },

  count: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,8,10,0.78)' },
  countTxt: { color: colors.accent, fontFamily: font.d800, fontSize: 220, lineHeight: 230 },

  panelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden', borderTopWidth: 1, borderColor: colors.hairline },
  panel: { backgroundColor: 'rgba(10,11,14,0.86)', paddingHorizontal: 20, paddingTop: 10 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: 14 },

  idleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  idleTitle: { color: colors.text, fontFamily: font.d800, fontSize: 30, lineHeight: 32 },
  idleSub: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 2 },
  gps: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  startBtn: { height: 66, borderRadius: radius.pill, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  startTxt: { color: colors.onAccent, fontFamily: font.d800, fontSize: 28, textTransform: 'uppercase', letterSpacing: 0.5 },

  metrics: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginBottom: 18 },
  vr: { width: 1, height: 38, backgroundColor: colors.hairline },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pause: { width: 92, height: 92, borderRadius: 46, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  resume: { flex: 1, height: 72, borderRadius: radius.pill, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  holdHint: { color: colors.mute, fontFamily: font.t600, fontSize: 9, letterSpacing: 1.2 },
  chip: { width: 96, alignItems: 'center', gap: 2 },
  chipV: { color: colors.text, fontFamily: font.d700, fontSize: 26, lineHeight: 28 },
  chipS: { color: colors.mute, fontFamily: font.t500, fontSize: 11 },

  unit: { color: colors.mute, fontFamily: font.d700, fontSize: 28 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 5 },
  splitKm: { width: 18, color: colors.mute, fontFamily: font.t600, fontSize: 13, textAlign: 'right' },
  splitTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.surface2, overflow: 'hidden' },
  splitFill: { height: '100%', borderRadius: 5, backgroundColor: colors.accent },
  splitPace: { width: 48, color: colors.text, fontFamily: font.d700, fontSize: 20, textAlign: 'right' },
  discard: { color: colors.mute, fontFamily: font.t600, fontSize: 14 },
});
