import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors, font, label, radius } from '../theme';
import { Digits } from '../components/Digits';
import { CountUp } from '../components/CountUp';
import { ProgressRing } from '../components/ProgressRing';
import { RoutePreview } from '../components/RoutePreview';
import { DEFAULT_GOAL_KM, Run, Sport, clearActive, loadActive, loadProfile, loadRuns, saveRun } from '../lib/storage';
import { useEnter } from '../lib/motion';
import { formatDuration, formatPace } from '../lib/geo';
import { splitsOf } from '../lib/splits';
import { formatDist, toUnit, unitLabel, unitMeters, useUnits } from '../lib/units';
import { normalizeRoute } from '../lib/route';
import { titleOf, whenOf } from '../lib/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const DAY = 86400000;

// ---------- derived stats (all computed from real saved runs) ----------
const mondayOf = (ts: number) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function computeStats(runs: Run[]) {
  const weekStart = mondayOf(Date.now()).getTime();
  const week = runs.filter((r) => r.startedAt >= weekStart);
  const perDay = Array(7).fill(0) as number[];
  week.forEach((r) => {
    const idx = Math.floor((r.startedAt - weekStart) / DAY);
    if (idx >= 0 && idx < 7) perDay[idx] += r.distance / 1000;
  });
  const weekKm = week.reduce((a, r) => a + r.distance, 0) / 1000;
  const weekMs = week.reduce((a, r) => a + r.elapsed, 0);

  // weekly streak: consecutive weeks with at least one activity. A quiet current week doesn't break it.
  const weeks = new Set(runs.map((r) => key(mondayOf(r.startedAt))));
  const cursor = mondayOf(Date.now());
  if (!weeks.has(key(cursor))) cursor.setDate(cursor.getDate() - 7);
  let streak = 0;
  while (weeks.has(key(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }

  // each record remembers the activity that set it, so its tile can open that activity
  const pick = <T,>(items: Run[], score: (r: Run) => T | null, better: (a: T, b: T) => boolean) => {
    let best: { run: Run; value: T } | null = null;
    for (const r of items) {
      const v = score(r);
      if (v != null && (!best || better(v, best.value))) best = { run: r, value: v };
    }
    return best;
  };
  const bestPace = pick(runs.filter((r) => r.distance >= 1000 && r.elapsed > 0), (r) => r.elapsed / 1000 / (r.distance / 1000), (a, b) => a < b);
  const longest = pick(runs, (r) => r.distance, (a, b) => a > b);
  // fastest single split in the unit being shown (only splits of the same length are comparable)
  const um = unitMeters();
  const fastestSplit = pick(
    runs,
    (r) => {
      const l = splitsOf(r, um);
      return l.unitM === um && l.splits.length > 0 ? Math.min(...l.splits.map((x) => x.ms)) : null;
    },
    (a, b) => a < b,
  );

  return { perDay, weekKm, weekMs, weekCount: week.length, streak, bestPace, longest, fastestSplit };
}

const paceOf = (r: Run) => (r.distance > 20 ? r.elapsed / 1000 / (r.distance / 1000) : null);

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const GHOST_ROUTE: [number, number][] = [
  [10, 44], [18, 36], [28, 40], [36, 26], [48, 30], [56, 18], [68, 22], [76, 32], [88, 28], [92, 40],
];

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [recovered, setRecovered] = useState<Run | null>(null);
  const [sport, setSport] = useState<Sport>('run');
  const [goalKm, setGoalKm] = useState(DEFAULT_GOAL_KM);
  const [initials, setInitials] = useState('');
  const [firstName, setFirstName] = useState('');
  const [loc, setLoc] = useState<'on' | 'off' | 'ask'>('ask');
  const enter = useEnter();
  const reduced = useReducedMotion();
  const units = useUnits();

  const refresh = useCallback(async () => {
    const [r, active, profile] = await Promise.all([loadRuns(), loadActive(), loadProfile()]);
    setRuns(r);
    setGoalKm(profile.weeklyGoalKm);
    setFirstName(profile.name.trim().split(/\s+/)[0] ?? '');
    Location.getForegroundPermissionsAsync()
      .then((p) => setLoc(p.granted ? 'on' : p.canAskAgain ? 'ask' : 'off'))
      .catch(() => {});
    const parts = profile.name.trim().split(/\s+/).filter(Boolean);
    setInitials(parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '');
    setRecovered(active && active.distance > 50 ? active : null);
    if (active && active.distance <= 50) clearActive();
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = useMemo(() => computeStats(runs ?? []), [runs, units]);
  const last = runs?.[0];
  const earlier = (runs ?? []).slice(1, 5);
  const lastRoute = useMemo(() => (last ? normalizeRoute(last.segments) : []), [last]);

  const glow = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    glow.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [glow, reduced]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: reduced ? 0.3 : 0.2 + glow.value * 0.25, transform: [{ scale: reduced ? 1 : 1 + glow.value * 0.05 }] }));

  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const shortDay = (ts: number) => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });

  const openRun = (id: string) => {
    Haptics.selectionAsync();
    navigation.navigate('Activity', { id });
  };

  const saveRecovered = async () => {
    if (!recovered) return;
    await saveRun(recovered);
    await clearActive();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    refresh();
  };
  const dropRecovered = async () => {
    await clearActive();
    refresh();
  };

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 220 + insets.bottom }} showsVerticalScrollIndicator={false}>
          <Animated.View entering={enter(0)} style={s.header}>
            <View>
              <Text style={label}>{dateLabel}</Text>
              <Text style={s.title} accessibilityRole="header">{firstName ? `${hello}, ${firstName}` : hello}</Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                navigation.navigate('Account');
              }}
              style={s.avatar}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Open account"
            >
              {initials ? (
                <Text style={{ color: colors.accent, fontFamily: font.d800, fontSize: 18 }}>{initials}</Text>
              ) : (
                <Ionicons name="person" size={18} color={colors.text} />
              )}
            </Pressable>
          </Animated.View>

          {recovered && (
            <Animated.View entering={enter(0)} style={s.recover}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="alert-circle" size={18} color={colors.amber} />
                <Text style={s.recoverTitle}>We recovered an unfinished run</Text>
              </View>
              <Text style={s.recoverSub}>
                {formatDist(recovered.distance)} {unitLabel()} · {formatDuration(recovered.elapsed)} · {whenOf(recovered.startedAt)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Pressable onPress={saveRecovered} accessibilityRole="button" accessibilityLabel="Save the recovered run" style={[s.recBtn, { backgroundColor: colors.accent }]}>
                  <Text style={[s.recBtnTxt, { color: colors.onAccent }]}>Save it</Text>
                </Pressable>
                <Pressable onPress={dropRecovered} accessibilityRole="button" accessibilityLabel="Discard the recovered run" style={[s.recBtn, { backgroundColor: colors.surface2 }]}>
                  <Text style={s.recBtnTxt}>Discard</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* weekly hero: ring, two numbers and the 7-day strip in one card */}
          <Animated.View entering={enter(1)} style={s.hero}>
            <View style={s.heroTop}>
              <View
                style={s.ringBox}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={`Weekly goal: ${formatDist(stats.weekKm * 1000, 1)} of ${formatDist(goalKm * 1000, 0)} ${unitLabel()}`}
              >
                <ProgressRing size={150} stroke={12} progress={stats.weekKm / goalKm} />
                <View style={s.ringCenter}>
                  <CountUp to={toUnit(stats.weekKm * 1000)} size={48} />
                  <Text style={s.ringSub}>of {formatDist(goalKm * 1000, 0)} {unitLabel()}</Text>
                </View>
              </View>
              <View style={s.heroStats}>
                <HeroStat icon="flame" value={String(stats.streak)} unit="week streak" tint={colors.amber} />
                <HeroStat icon="time" value={formatDuration(stats.weekMs)} unit="moving this week" />
              </View>
            </View>
            <View style={s.week}>
              {stats.perDay.map((km, i) => {
                const today = (now.getDay() + 6) % 7 === i;
                const max = Math.max(...stats.perDay, 1);
                return (
                  <View
                    key={i}
                    style={s.dayCol}
                    accessible
                    accessibilityLabel={`${DAY_NAMES[i]}${today ? ', today' : ''}: ${km ? `${formatDist(km * 1000, 1)} ${unitLabel()}` : 'no activity'}`}
                  >
                    <View style={s.dayTrack}>
                      <View style={[s.dayFill, { height: `${km ? Math.max((km / max) * 100, 14) : 0}%` }]} />
                    </View>
                    <View style={[s.dayDot, today && s.dayDotToday]}>
                      <Text style={[s.dayTxt, today && { color: colors.onAccent }]}>{'MTWTFSS'[i]}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Animated.View>

          {/* last activity / empty state */}
          {runs !== null && !last && (
            <Animated.View entering={enter(3)} style={s.card}>
              <View style={[s.routeBox, { opacity: 0.55 }]}>
                <RoutePreview points={GHOST_ROUTE} width="100%" height="100%" />
              </View>
              <View style={s.cardBody}>
                <Text style={s.cardTitle}>Your first run lands here</Text>
                <Text style={s.emptySub}>
                  Hit start, run anywhere outdoors, and your route, splits and personal bests will show up on this screen.
                </Text>
              </View>
            </Animated.View>
          )}

          {last && (
            <Animated.View entering={enter(3)} style={s.card}>
              <Pressable
                onPress={() => navigation.navigate('Activity', { id: last.id })}
                accessibilityRole="button"
                accessibilityLabel={`Latest activity: ${titleOf(last)}, ${whenOf(last.startedAt)}, ${formatDist(last.distance)} ${unitLabel() === 'km' ? 'kilometres' : 'miles'}. Open`}
              >
              <View style={s.routeBox}>
                {lastRoute.length > 1 ? (
                  <RoutePreview key={last.id} points={lastRoute} width="100%" height="100%" />
                ) : (
                  <Ionicons name="map-outline" size={34} color={colors.dim} />
                )}
                <LinearGradient colors={['transparent', colors.surface]} style={s.routeFade} pointerEvents="none" />
                {stats.fastestSplit?.run.id === last.id && (
                  <View style={s.prChip}>
                    <Ionicons name="trophy" size={12} color={colors.onAccent} />
                    <Text style={s.prTxt}>Fastest {unitLabel()}</Text>
                  </View>
                )}
              </View>
              <View style={s.cardBody}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={s.cardTitle}>{titleOf(last)}</Text>
                  <Text style={s.cardWhen}>{whenOf(last.startedAt)}</Text>
                </View>
                <View style={s.statRow}>
                  <MiniStat label="Distance" big={formatDist(last.distance)} unit={unitLabel()} />
                  <MiniStat label="Avg pace" big={formatPace(paceOf(last))} unit={`/${unitLabel()}`} />
                  <MiniStat label="Time" big={formatDuration(last.elapsed)} />
                </View>
              </View>
              </Pressable>
            </Animated.View>
          )}

          {/* personal bests: each tile opens the activity that set it */}
          {runs && runs.length > 0 && (
            <Animated.View entering={enter(4)}>
              <Text style={[label, { marginTop: 26, marginBottom: 12 }]} accessibilityRole="header">Personal bests</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                {stats.longest && (
                  <Best k="Longest" v={`${formatDist(stats.longest.value)} ${unitLabel()}`} when={shortDay(stats.longest.run.startedAt)} onPress={() => openRun(stats.longest!.run.id)} />
                )}
                {stats.bestPace && (
                  <Best k="Best pace" v={`${formatPace(stats.bestPace.value)} /${unitLabel()}`} when={shortDay(stats.bestPace.run.startedAt)} onPress={() => openRun(stats.bestPace!.run.id)} />
                )}
                {stats.fastestSplit && (
                  <Best k={`Fastest ${unitLabel()}`} v={formatDuration(stats.fastestSplit.value)} when={shortDay(stats.fastestSplit.run.startedAt)} onPress={() => openRun(stats.fastestSplit!.run.id)} />
                )}
              </ScrollView>
            </Animated.View>
          )}

          {earlier.length > 0 && (
            <Animated.View entering={enter(5)}>
              <Text style={[label, { marginTop: 26, marginBottom: 12 }]}>Earlier</Text>
              {earlier.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => navigation.navigate('Activity', { id: r.id })}
                  style={s.row}
                  accessibilityRole="button"
                  accessibilityLabel={`${titleOf(r)}, ${whenOf(r.startedAt)}, ${formatDist(r.distance)} ${unitLabel() === 'km' ? 'kilometres' : 'miles'}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{titleOf(r)}</Text>
                    <Text style={s.cardWhen}>{whenOf(r.startedAt)}</Text>
                  </View>
                  <Text style={s.rowStat}>
                    {formatDist(r.distance)}
                    <Text style={s.miniUnit}> {unitLabel()}</Text>
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.dim} style={{ marginLeft: 10 }} />
                </Pressable>
              ))}
            </Animated.View>
          )}

          {runs && runs.length > 0 && (
            <Animated.View entering={enter(6)}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  navigation.navigate('History');
                }}
                style={s.allRow}
                accessibilityRole="button"
                accessibilityLabel={`All activities, ${runs.length} saved`}
              >
                <Ionicons name="calendar-clear-outline" size={18} color={colors.accent} />
                <Text style={s.allTxt}>All activities</Text>
                <Text style={s.allCount}>{runs.length}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.mute} />
              </Pressable>
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* floating start CTA, in the thumb zone */}
      <LinearGradient
        colors={['rgba(11,11,12,0)', colors.bg, colors.bg]}
        style={[s.ctaWrap, { paddingBottom: insets.bottom + 14 }]}
        pointerEvents="box-none"
      >
        {loc === 'off' ? (
          <Pressable
            onPress={() => Linking.openSettings()}
            style={s.locChip}
            accessibilityRole="button"
            accessibilityLabel="Location is off. Open settings to turn it on"
          >
            <Ionicons name="location-outline" size={14} color={colors.amber} />
            <Text style={[s.locTxt, { color: colors.amber }]}>Location is off · Open settings</Text>
          </Pressable>
        ) : loc === 'on' ? (
          <View style={s.locChip} accessible accessibilityLabel="Location is on">
            <View style={s.locDot} />
            <Text style={s.locTxt}>Location on</Text>
          </View>
        ) : null}
        <View style={s.chips} accessibilityRole="radiogroup">
          {(['run', 'walk'] as Sport[]).map((sp) => (
            <Pressable
              key={sp}
              onPress={() => {
                Haptics.selectionAsync();
                setSport(sp);
              }}
              style={[s.chip, sport === sp && s.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: sport === sp }}
              accessibilityLabel={sp === 'run' ? 'Run' : 'Walk'}
            >
              <MaterialCommunityIcons name={sp === 'run' ? 'run' : 'walk'} size={16} color={sport === sp ? colors.onAccent : colors.mute} />
              <Text style={[s.chipTxt, sport === sp && { color: colors.onAccent }]}>{sp === 'run' ? 'Run' : 'Walk'}</Text>
            </Pressable>
          ))}
        </View>
        <Animated.View style={[s.ctaGlow, glowStyle]} pointerEvents="none" />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.navigate('Tracking', { sport });
          }}
          style={({ pressed }) => [s.cta, pressed && { transform: [{ scale: 0.97 }] }]}
          accessibilityRole="button"
          accessibilityLabel={`Start ${sport}`}
          accessibilityHint="Opens the recording screen"
        >
          <View style={s.ctaIcon}>
            <Ionicons name="play" size={22} color={colors.accent} style={{ marginLeft: 2 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.ctaTitle}>Start {sport}</Text>
            <Text style={s.ctaSub}>Outdoor · GPS + step sensor</Text>
          </View>
          <Ionicons name="arrow-forward" size={22} color={colors.onAccent} />
        </Pressable>
      </LinearGradient>
    </View>
  );
}

function HeroStat({ icon, value, unit, tint }: { icon: keyof typeof Ionicons.glyphMap; value: string; unit: string; tint?: string }) {
  return (
    <View style={s.heroStat}>
      <Ionicons name={icon} size={16} color={tint ?? colors.accent} />
      <Text style={s.heroStatV}>{value}</Text>
      <Text style={s.heroStatU}>{unit}</Text>
    </View>
  );
}

function MiniStat({ label: l, big, unit }: { label: string; big: string; unit?: string }) {
  return (
    <View>
      <Text style={label}>{l}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
        <Digits value={big} size={30} weight={font.d700} />
        {unit ? <Text style={s.miniUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function Best({ k, v, when, onPress }: { k: string; v: string; when: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.pb, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={`${k}: ${v}, set on ${when}. Open that activity`}
    >
      <Text style={s.pbK}>{k}</Text>
      <Text style={s.pbV}>{v}</Text>
      <Text style={s.pbWhen}>{when}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, marginTop: 16, paddingHorizontal: 16, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  allTxt: { flex: 1, color: colors.text, fontFamily: font.t600, fontSize: 14 },
  allCount: { color: colors.mute, fontFamily: font.t500, fontSize: 13 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 22 },
  title: { color: colors.text, fontFamily: font.d800, fontSize: 40, lineHeight: 42, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },

  recover: { backgroundColor: 'rgba(255,176,32,0.1)', borderColor: 'rgba(255,176,32,0.35)', borderWidth: 1, borderRadius: radius.md, padding: 16, marginBottom: 16 },
  recoverTitle: { color: colors.text, fontFamily: font.t700, fontSize: 14 },
  recoverSub: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 4 },
  recBtn: { flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  recBtnTxt: { color: colors.text, fontFamily: font.t700, fontSize: 14 },

  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: colors.hairline },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  ringBox: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center' },
  ringSub: { color: colors.mute, fontFamily: font.t500, fontSize: 12, marginTop: -2 },
  heroStats: { flex: 1, gap: 10 },
  heroStat: { flexDirection: 'row', alignItems: 'baseline', gap: 6, backgroundColor: colors.surface2, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12 },
  heroStatV: { color: colors.text, fontFamily: font.d700, fontSize: 24, lineHeight: 26 },
  heroStatU: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },

  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 14, paddingHorizontal: 2, borderTopWidth: 1, borderTopColor: colors.hairline },
  dayCol: { alignItems: 'center', gap: 8, flex: 1 },
  dayTrack: { height: 56, width: 10, borderRadius: 5, backgroundColor: colors.surface2, justifyContent: 'flex-end', overflow: 'hidden' },
  dayFill: { width: '100%', backgroundColor: colors.accent, borderRadius: 5 },
  dayDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  dayDotToday: { backgroundColor: colors.accent },
  dayTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 11 },

  card: { marginTop: 18, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  routeBox: { height: 190, backgroundColor: '#0B0D10', alignItems: 'center', justifyContent: 'center' },
  routeFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 60 },
  prChip: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.accent, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  prTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 11 },
  cardBody: { padding: 18, paddingTop: 6 },
  cardTitle: { color: colors.text, fontFamily: font.t700, fontSize: 18 },
  cardWhen: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },
  emptySub: { color: colors.mute, fontFamily: font.t500, fontSize: 14, lineHeight: 20, marginTop: 6 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  miniUnit: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },

  pb: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: colors.hairline, minWidth: 110 },
  pbK: { color: colors.mute, fontFamily: font.t600, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  pbV: { color: colors.text, fontFamily: font.d700, fontSize: 26, marginTop: 4 },
  pbWhen: { color: colors.mute, fontFamily: font.t500, fontSize: 11, marginTop: 2 },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: colors.hairline },
  rowTitle: { color: colors.text, fontFamily: font.t600, fontSize: 15 },
  rowStat: { color: colors.text, fontFamily: font.d700, fontSize: 24 },

  ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 36 },
  locChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, minHeight: 28, marginBottom: 8 },
  locDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  locTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 12 },
  chips: { flexDirection: 'row', alignSelf: 'center', gap: 8, marginBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, minWidth: 96, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 13 },
  ctaGlow: { position: 'absolute', left: 30, right: 30, bottom: 24, height: 70, borderRadius: 40, backgroundColor: colors.accent },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.accent, borderRadius: radius.pill, padding: 10, paddingRight: 22 },
  ctaIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.onAccent, alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { color: colors.onAccent, fontFamily: font.d800, fontSize: 28, lineHeight: 30, textTransform: 'uppercase' },
  ctaSub: { color: 'rgba(11,13,5,0.65)', fontFamily: font.t500, fontSize: 12 },
});
