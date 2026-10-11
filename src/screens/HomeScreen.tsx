import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
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
import { DEFAULT_GOAL_KM, Run, Sport, clearActive, deleteRun, loadActive, loadProfile, loadRuns, saveRun } from '../lib/storage';
import { formatDuration, formatKm, formatPace } from '../lib/geo';
import { normalizeRoute } from '../lib/route';
import { titleOf, whenOf } from '../lib/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const DAY = 86400000;

const enter = (i: number) => FadeInDown.delay(60 + i * 80).duration(500).easing(Easing.out(Easing.cubic));

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

  const paced = runs.filter((r) => r.distance >= 1000 && r.elapsed > 0);
  const bestPace = paced.length ? Math.min(...paced.map((r) => r.elapsed / 1000 / (r.distance / 1000))) : null;
  const longest = runs.length ? Math.max(...runs.map((r) => r.distance)) : 0;
  const k1 = runs.filter((r) => r.splits.length > 0).map((r) => r.splits[0].ms);
  const fastest1k = k1.length ? Math.min(...k1) : null;

  return { perDay, weekKm, weekMs, weekCount: week.length, streak, bestPace, longest, fastest1k };
}

const paceOf = (r: Run) => (r.distance > 20 ? r.elapsed / 1000 / (r.distance / 1000) : null);

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

  const refresh = useCallback(async () => {
    const [r, active, profile] = await Promise.all([loadRuns(), loadActive(), loadProfile()]);
    setRuns(r);
    setGoalKm(profile.weeklyGoalKm);
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

  const stats = useMemo(() => computeStats(runs ?? []), [runs]);
  const last = runs?.[0];
  const earlier = (runs ?? []).slice(1, 5);
  const lastRoute = useMemo(() => (last ? normalizeRoute(last.segments) : []), [last]);

  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.2 + glow.value * 0.25, transform: [{ scale: 1 + glow.value * 0.05 }] }));

  const now = new Date();
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });

  const confirmDelete = (r: Run) =>
    Alert.alert('Delete this activity?', `${titleOf(r)} · ${formatKm(r.distance)} km`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteRun(r.id); refresh(); } },
    ]);

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
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 190 + insets.bottom }} showsVerticalScrollIndicator={false}>
          <Animated.View entering={enter(0)} style={s.header}>
            <View>
              <Text style={label}>{dateLabel}</Text>
              <Text style={s.title}>{hello}</Text>
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
                {formatKm(recovered.distance)} km · {formatDuration(recovered.elapsed)} · {whenOf(recovered.startedAt)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <Pressable onPress={saveRecovered} style={[s.recBtn, { backgroundColor: colors.accent }]}>
                  <Text style={[s.recBtnTxt, { color: colors.onAccent }]}>Save it</Text>
                </Pressable>
                <Pressable onPress={dropRecovered} style={[s.recBtn, { backgroundColor: colors.surface2 }]}>
                  <Text style={s.recBtnTxt}>Discard</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* weekly hero */}
          <Animated.View entering={enter(1)} style={s.hero}>
            <View style={s.ringBox}>
              <ProgressRing size={150} stroke={12} progress={stats.weekKm / goalKm} />
              <View style={s.ringCenter}>
                <CountUp to={stats.weekKm} size={48} />
                <Text style={s.ringSub}>of {goalKm} km</Text>
              </View>
            </View>
            <View style={s.heroStats}>
              <HeroStat icon="flame" value={String(stats.streak)} unit={stats.streak === 1 ? 'week streak' : 'week streak'} tint={colors.amber} />
              <HeroStat icon="footsteps" value={String(stats.weekCount)} unit={stats.weekCount === 1 ? 'activity' : 'activities'} />
              <HeroStat icon="time" value={formatDuration(stats.weekMs)} unit="moving" />
            </View>
          </Animated.View>

          <Animated.View entering={enter(2)} style={s.week}>
            {stats.perDay.map((km, i) => {
              const today = (now.getDay() + 6) % 7 === i;
              const max = Math.max(...stats.perDay, 1);
              return (
                <View key={i} style={s.dayCol}>
                  <View style={s.dayTrack}>
                    <View style={[s.dayFill, { height: `${km ? Math.max((km / max) * 100, 14) : 0}%` }]} />
                  </View>
                  <View style={[s.dayDot, today && s.dayDotToday]}>
                    <Text style={[s.dayTxt, today && { color: colors.onAccent }]}>{'MTWTFSS'[i]}</Text>
                  </View>
                </View>
              );
            })}
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
              <Pressable onPress={() => navigation.navigate('Activity', { id: last.id })}>
              <View style={s.routeBox}>
                {lastRoute.length > 1 ? (
                  <RoutePreview key={last.id} points={lastRoute} width="100%" height="100%" />
                ) : (
                  <Ionicons name="map-outline" size={34} color={colors.dim} />
                )}
                <LinearGradient colors={['transparent', colors.surface]} style={s.routeFade} pointerEvents="none" />
                {stats.fastest1k != null && last.splits[0]?.ms === stats.fastest1k && (
                  <View style={s.prChip}>
                    <Ionicons name="trophy" size={12} color={colors.onAccent} />
                    <Text style={s.prTxt}>Fastest 1K</Text>
                  </View>
                )}
                <Pressable onPress={() => confirmDelete(last)} hitSlop={10} style={s.trash}>
                  <Ionicons name="trash-outline" size={16} color={colors.mute} />
                </Pressable>
              </View>
              <View style={s.cardBody}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={s.cardTitle}>{titleOf(last)}</Text>
                  <Text style={s.cardWhen}>{whenOf(last.startedAt)}</Text>
                </View>
                <View style={s.statRow}>
                  <MiniStat label="Distance" big={formatKm(last.distance)} unit="km" />
                  <MiniStat label="Avg pace" big={formatPace(paceOf(last))} unit="/km" />
                  <MiniStat label="Time" big={formatDuration(last.elapsed)} />
                </View>
              </View>
              </Pressable>
            </Animated.View>
          )}

          {/* personal bests (only what the history can actually support) */}
          {runs && runs.length > 0 && (
            <Animated.View entering={enter(4)}>
              <Text style={[label, { marginTop: 26, marginBottom: 12 }]}>Personal bests</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
                <Best k="Longest" v={`${formatKm(stats.longest)} km`} />
                {stats.bestPace != null && <Best k="Best pace" v={`${formatPace(stats.bestPace)} /km`} />}
                {stats.fastest1k != null && <Best k="Fastest 1K" v={formatDuration(stats.fastest1k)} />}
                <Best k="Activities" v={String(runs.length)} />
              </ScrollView>
            </Animated.View>
          )}

          {earlier.length > 0 && (
            <Animated.View entering={enter(5)}>
              <Text style={[label, { marginTop: 26, marginBottom: 12 }]}>Earlier</Text>
              {earlier.map((r) => (
                <Pressable key={r.id} onPress={() => navigation.navigate('Activity', { id: r.id })} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{titleOf(r)}</Text>
                    <Text style={s.cardWhen}>{whenOf(r.startedAt)}</Text>
                  </View>
                  <Text style={s.rowStat}>
                    {formatKm(r.distance)}
                    <Text style={s.miniUnit}> km</Text>
                  </Text>
                  <Pressable onPress={() => confirmDelete(r)} hitSlop={10} style={{ paddingLeft: 14 }}>
                    <Ionicons name="trash-outline" size={16} color={colors.dim} />
                  </Pressable>
                </Pressable>
              ))}
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
        <View style={s.chips}>
          {(['run', 'walk'] as Sport[]).map((sp) => (
            <Pressable
              key={sp}
              onPress={() => {
                Haptics.selectionAsync();
                setSport(sp);
              }}
              style={[s.chip, sport === sp && s.chipOn]}
            >
              <Ionicons name={sp === 'run' ? 'walk' : 'footsteps'} size={14} color={sport === sp ? colors.onAccent : colors.mute} />
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

function Best({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.pb}>
      <Text style={s.pbK}>{k}</Text>
      <Text style={s.pbV}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 22 },
  title: { color: colors.text, fontFamily: font.d800, fontSize: 40, lineHeight: 42, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.hairline },

  recover: { backgroundColor: 'rgba(255,176,32,0.1)', borderColor: 'rgba(255,176,32,0.35)', borderWidth: 1, borderRadius: radius.md, padding: 16, marginBottom: 16 },
  recoverTitle: { color: colors.text, fontFamily: font.t700, fontSize: 14 },
  recoverSub: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 4 },
  recBtn: { flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  recBtnTxt: { color: colors.text, fontFamily: font.t700, fontSize: 14 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 18, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: colors.hairline },
  ringBox: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  ringCenter: { position: 'absolute', alignItems: 'center' },
  ringSub: { color: colors.mute, fontFamily: font.t500, fontSize: 12, marginTop: -2 },
  heroStats: { flex: 1, gap: 10 },
  heroStat: { flexDirection: 'row', alignItems: 'baseline', gap: 6, backgroundColor: colors.surface2, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12 },
  heroStatV: { color: colors.text, fontFamily: font.d700, fontSize: 24, lineHeight: 26 },
  heroStatU: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },

  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 6 },
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
  trash: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(11,11,12,0.7)', alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 18, paddingTop: 6 },
  cardTitle: { color: colors.text, fontFamily: font.t700, fontSize: 18 },
  cardWhen: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },
  emptySub: { color: colors.mute, fontFamily: font.t500, fontSize: 14, lineHeight: 20, marginTop: 6 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  miniUnit: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },

  pb: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 18, borderWidth: 1, borderColor: colors.hairline, minWidth: 110 },
  pbK: { color: colors.mute, fontFamily: font.t600, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  pbV: { color: colors.text, fontFamily: font.d700, fontSize: 26, marginTop: 4 },

  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: colors.hairline },
  rowTitle: { color: colors.text, fontFamily: font.t600, fontSize: 15 },
  rowStat: { color: colors.text, fontFamily: font.d700, fontSize: 24 },

  ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 36 },
  chips: { flexDirection: 'row', alignSelf: 'center', gap: 8, marginBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 13 },
  ctaGlow: { position: 'absolute', left: 30, right: 30, bottom: 24, height: 70, borderRadius: 40, backgroundColor: colors.accent },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.accent, borderRadius: radius.pill, padding: 10, paddingRight: 22 },
  ctaIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.onAccent, alignItems: 'center', justifyContent: 'center' },
  ctaTitle: { color: colors.onAccent, fontFamily: font.d800, fontSize: 28, lineHeight: 30, textTransform: 'uppercase' },
  ctaSub: { color: 'rgba(11,13,5,0.65)', fontFamily: font.t500, fontSize: 12 },
});
