import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors, font, label, radius } from '../theme';
import { Run, loadProfile, loadRuns } from '../lib/storage';
import { titleOf, whenOf } from '../lib/format';
import { avgPaceOf, elevationOf } from '../lib/insights';
import { CANVAS, EXPORT, MIN_TRIM_TOTAL_M, TRIM_M, recorderAvailable, trimTrack } from '../lib/share';
import { ShareData, ShareOptions } from '../components/ShareCanvas';
import { ShareStage, StageHandle } from '../components/ShareStage';

type Props = NativeStackScreenProps<RootStackParamList, 'Share'>;
type Busy = null | { kind: 'video' | 'still' | 'save'; progress: number };

const asUri = (u: string) => (u.startsWith('file://') ? u : `file://${u}`);

export default function ShareScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const stage = useRef<StageHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef<{ sig: string; uri: string } | null>(null);
  const hasVideo = recorderAvailable();

  const [run, setRun] = useState<Run | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [trim, setTrim] = useState(true);
  const [opts, setOpts] = useState<ShareOptions>({ showTime: true, showPace: true, showElev: true });
  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const pRef = useRef(0);

  useEffect(() => {
    loadProfile().then((pr) => setTrim(pr.hideEnds));
  }, []);
  useEffect(() => {
    pRef.current = p;
  }, [p]);

  useEffect(() => {
    let alive = true;
    loadRuns().then((runs) => {
      if (!alive) return;
      const found = runs.find((r) => r.id === route.params.id) ?? null;
      setRun(found);
      setState(found ? 'ready' : 'missing');
      if (found) setPlaying(true);
    });
    return () => {
      alive = false;
    };
  }, [route.params.id]);

  // ---------- data for the canvas ----------
  const flat = useMemo(() => (run ? run.segments.flat() : []), [run]);
  const trimmed = useMemo(() => trimTrack(flat, trim), [flat, trim]);
  const elev = useMemo(() => (run ? elevationOf(run) : null), [run]);
  const data: ShareData | null = useMemo(
    () =>
      run
        ? {
            title: titleOf(run),
            when: whenOf(run.startedAt),
            coords: trimmed.coords,
            distance: run.distance,
            elapsed: run.elapsed,
            avgPace: avgPaceOf(run),
            elevGain: elev ? elev.gain : null,
          }
        : null,
    [run, trimmed.coords, elev],
  );

  // ---------- preview playback (10 s, same timeline as the export) ----------
  useEffect(() => {
    if (!playing || busy) return;
    let raf = 0;
    let last = 0;
    const t0 = Date.now() - (pRef.current >= 1 ? 0 : pRef.current) * EXPORT.ms;
    const tick = () => {
      const now = Date.now();
      const v = (now - t0) / EXPORT.ms;
      if (v >= 1) {
        setP(1);
        setPlaying(false);
        return;
      }
      if (now - last >= 33) {
        last = now;
        setP(v);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, busy]);

  const replay = () => {
    Haptics.selectionAsync();
    setP(0);
    pRef.current = 0;
    setPlaying(true);
  };
  const togglePlay = () => {
    Haptics.selectionAsync();
    if (p >= 1) return replay();
    setPlaying((v) => !v);
  };

  // ---------- export ----------
  const sig = JSON.stringify({ id: route.params.id, trim: trimmed.trimmed, opts, v: hasVideo });

  /** Renders (or reuses) the video or still for the current settings. Resolves to a file:// URI, or null if cancelled. */
  const makeFile = async (kind: 'video' | 'still' | 'save'): Promise<string | null> => {
    if (cache.current?.sig === sig) return cache.current.uri;
    setPlaying(false);
    abort.current = new AbortController();
    try {
      let uri: string;
      if (hasVideo) {
        setBusy({ kind: kind === 'save' ? 'save' : 'video', progress: 0 });
        uri = asUri(await stage.current!.record((f) => setBusy({ kind: kind === 'save' ? 'save' : 'video', progress: f }), abort.current.signal));
      } else {
        setBusy({ kind: kind === 'save' ? 'save' : 'still', progress: 0 });
        uri = asUri(await stage.current!.still());
      }
      cache.current = { sig, uri };
      return uri;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return null;
      throw e;
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const fail = (e: unknown) =>
    Alert.alert('Couldn’t create the file', e instanceof Error ? e.message : 'Something went wrong. Please try again.');

  const share = async () => {
    if (!(await Sharing.isAvailableAsync())) return Alert.alert('Sharing isn’t available on this device.');
    try {
      const uri = await makeFile('video');
      if (!uri) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await Sharing.shareAsync(uri, hasVideo
        ? { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: 'Share your run' }
        : { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your run' });
    } catch (e) {
      fail(e);
    }
  };

  // ---------- states ----------
  if (state === 'loading') {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (state === 'missing' || !run || !data) {
    return (
      <View style={[s.root, s.center, { padding: 32 }]}>
        <Ionicons name="alert-circle-outline" size={40} color={colors.dim} />
        <Text style={s.emptyTitle}>We couldn’t find this activity</Text>
        <Pressable onPress={() => navigation.goBack()} style={s.primary}>
          <Text style={s.primaryTxt}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const noRoute = trimmed.coords.length < 2;
  const busyLabel =
    busy?.kind === 'still' ? 'Preparing image' : busy?.kind === 'save' ? 'Rendering to save' : 'Rendering video';

  return (
    <View style={s.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 140 }}>
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={s.round}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>
          <Text style={s.headerTitle}>Share</Text>
          <View style={{ width: 44 }} />
        </View>

        {/* preview, centred; this exact view is what gets recorded */}
        <View style={s.stageWrap}>
          <View style={s.stageFrame}>
            <Pressable onPress={togglePlay} disabled={!!busy} style={{ width: CANVAS.w, height: CANVAS.h }}>
              <ShareStage ref={stage} data={data} opts={opts} p={p} />
            </Pressable>
            {busy && (
              <Animated.View entering={FadeIn} exiting={FadeOut} style={s.busy} pointerEvents="auto">
                <ActivityIndicator color={colors.accent} />
                <Text style={s.busyTitle}>{busyLabel}</Text>
                {busy.kind !== 'still' && (
                  <>
                    <View style={s.busyTrack}>
                      <View style={[s.busyFill, { width: `${Math.round(busy.progress * 100)}%` }]} />
                    </View>
                    <Text style={s.busySub}>{Math.round(busy.progress * 100)}%</Text>
                  </>
                )}
                {hasVideo && (
                  <Pressable onPress={() => abort.current?.abort()} style={s.cancel}>
                    <Text style={s.cancelTxt}>Cancel</Text>
                  </Pressable>
                )}
              </Animated.View>
            )}
          </View>

          <View style={s.controls}>
            <Pressable onPress={togglePlay} disabled={!!busy} hitSlop={8} style={s.ctl}>
              <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.text} />
            </Pressable>
            <View style={s.bar}>
              <View style={[s.barFill, { width: `${p * 100}%` }]} />
            </View>
            <Pressable onPress={replay} disabled={!!busy} hitSlop={8} style={s.ctl}>
              <Ionicons name="refresh" size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {!hasVideo && (
          <Animated.View entering={FadeInDown} style={[s.card, s.callout]}>
            <Ionicons name="information-circle" size={20} color={colors.amber} />
            <Text style={s.calloutTxt}>
              Video export needs a development build. In Expo Go you can still share a still image of the finished route card.
            </Text>
          </Animated.View>
        )}

        {/* privacy */}
        <View style={s.card}>
          <Text style={label}>Privacy</Text>
          <View style={s.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={s.rowTitle}>Hide start and finish</Text>
              <Text style={s.rowSub}>
                {trimmed.tooShort
                  ? `This route is under ${MIN_TRIM_TOTAL_M} m, too short to hide the start without losing the route.`
                  : `Cuts the first and last ${TRIM_M} m so your home isn’t shown. Applies to this video only.`}
              </Text>
            </View>
            <Switch
              value={trim && !trimmed.tooShort}
              disabled={trimmed.tooShort}
              onValueChange={(v) => {
                Haptics.selectionAsync();
                setTrim(v);
              }}
              trackColor={{ false: colors.surface2, true: colors.accent }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* stats */}
        <View style={s.card}>
          <Text style={label}>Show on video</Text>
          <View style={s.chips}>
            <Chip text="Time" on={opts.showTime} onPress={() => setOpts((o) => ({ ...o, showTime: !o.showTime }))} />
            <Chip text="Avg pace" on={opts.showPace} onPress={() => setOpts((o) => ({ ...o, showPace: !o.showPace }))} />
            {elev && <Chip text="Climb" on={opts.showElev} onPress={() => setOpts((o) => ({ ...o, showElev: !o.showElev }))} />}
          </View>
          <Text style={s.rowSub}>Distance is always shown. Text stays inside the area Instagram doesn’t cover.</Text>
        </View>

        {noRoute && (
          <View style={[s.card, s.callout]}>
            <Ionicons name="map-outline" size={20} color={colors.mute} />
            <Text style={s.calloutTxt}>This activity has no recorded route, so the video shows your stats only.</Text>
          </View>
        )}
      </ScrollView>

      {/* actions in the thumb zone */}
      <LinearGradient colors={['rgba(11,11,12,0)', colors.bg, colors.bg]} style={[s.footer, { paddingBottom: insets.bottom + 14 }]} pointerEvents="box-none">
        <Pressable onPress={share} disabled={!!busy} style={({ pressed }) => [s.primary, { flex: 1 }, (pressed || busy) && { opacity: 0.7 }]}>
          <Ionicons name="share-outline" size={22} color={colors.onAccent} />
          <Text style={s.primaryTxt}>{hasVideo ? 'Share video' : 'Share image'}</Text>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

function Chip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={[s.chip, on && s.chipOn]}
    >
      {on && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
      <Text style={[s.chipTxt, on && { color: colors.onAccent }]}>{text}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontFamily: font.d800, fontSize: 28, marginVertical: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  headerTitle: { color: colors.text, fontFamily: font.d800, fontSize: 28 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },

  stageWrap: { alignItems: 'center' },
  stageFrame: { width: CANVAS.w, height: CANVAS.h, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.hairline },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,11,12,0.86)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  busyTitle: { color: colors.text, fontFamily: font.t700, fontSize: 16, marginTop: 6 },
  busyTrack: { width: 200, height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  busyFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  busySub: { color: colors.mute, fontFamily: font.t600, fontSize: 13 },
  cancel: { marginTop: 10, height: 40, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { color: colors.text, fontFamily: font.t600, fontSize: 14 },

  controls: { width: CANVAS.w, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  ctl: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent },

  card: { marginHorizontal: 20, marginTop: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, padding: 16 },
  callout: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  calloutTxt: { flex: 1, color: colors.mute, fontFamily: font.t500, fontSize: 13, lineHeight: 19 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  rowTitle: { color: colors.text, fontFamily: font.t600, fontSize: 15 },
  rowSub: { color: colors.mute, fontFamily: font.t500, fontSize: 12, lineHeight: 17, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 14 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 36, flexDirection: 'row', gap: 12 },
  primary: { height: 60, borderRadius: radius.pill, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 28 },
  primaryTxt: { color: colors.onAccent, fontFamily: font.d800, fontSize: 24, textTransform: 'uppercase' },
  secondary: { height: 60, paddingHorizontal: 24, borderRadius: radius.pill, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.hairline },
  secondaryTxt: { color: colors.text, fontFamily: font.t700, fontSize: 15 },

  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill },
  toastTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 14 },
});
