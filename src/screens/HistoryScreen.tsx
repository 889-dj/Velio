import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors, font, label, radius } from '../theme';
import { Digits, emWidth, fitSize } from '../components/Digits';
import { RoutePreview } from '../components/RoutePreview';
import { RouteThumb } from '../components/RouteThumb';
import { Run, deleteRun, loadRuns, saveRun } from '../lib/storage';
import { formatDuration, formatKm, formatPace } from '../lib/geo';
import { titleOf, whenOf } from '../lib/format';
import {
  Bar,
  HistorySort,
  MIN_RANKED_M,
  MonthSection,
  RunRecord,
  SportFilter,
  filterRuns,
  monthBars,
  monthSections,
  recordsIn,
  sortRuns,
  totalsOf,
  yearBars,
  yearsOf,
} from '../lib/history';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

const SPORTS: { key: SportFilter; text: string }[] = [
  { key: 'all', text: 'All' },
  { key: 'run', text: 'Runs' },
  { key: 'walk', text: 'Walks' },
];
const SORTS: { key: HistorySort; text: string }[] = [
  { key: 'newest', text: 'Newest' },
  { key: 'longest', text: 'Longest' },
  { key: 'fastest', text: 'Fastest' },
];
const MONTH_LETTERS = 'JFMAMJJASOND';
const BAR_H = 76;
const UNDO_MS = 5000;
const ENTER_ROWS = 8; // only the first screenful animates in, so scrolling back never replays it
const GUTTER = 20;

const monthName = (year: number, month: number) => new Date(year, month, 1).toLocaleDateString([], { month: 'long' });
const monthYear = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
const activities = (n: number) => `${n} ${n === 1 ? 'activity' : 'activities'}`;

export default function HistoryScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [sport, setSport] = useState<SportFilter>('all');
  const [sort, setSort] = useState<HistorySort>('newest');
  const [yearPick, setYearPick] = useState<number | null | undefined>(undefined);
  const [month, setMonth] = useState<number | null>(null);
  const [undo, setUndo] = useState<Run | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve()); // storage writes are read-modify-write: run them in order
  const firstPaint = useRef(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      writes.current.then(loadRuns).then((r) => {
        if (alive) setRuns(r);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  useEffect(() => {
    if (!runs) return;
    const t = setTimeout(() => {
      firstPaint.current = false;
    }, 800);
    return () => clearTimeout(t);
  }, [runs]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const all = useMemo(() => runs ?? [], [runs]);
  const years = useMemo(() => yearsOf(all), [all]);
  // one year of history: "all time" and that year are the same thing, so there is nothing to choose
  const year = years.length <= 1 ? (years[0] ?? null) : yearPick != null && years.includes(yearPick) ? yearPick : null;
  const activeMonth = year == null ? null : month;

  const bySport = useMemo(() => filterRuns(all, { sport }), [all, sport]);
  const scoped = useMemo(() => filterRuns(bySport, { year, month: activeMonth }), [bySport, year, activeMonth]);
  const totals = useMemo(() => totalsOf(scoped), [scoped]);
  const bars = useMemo(() => (year == null ? yearBars(bySport) : monthBars(bySport, year)), [bySport, year]);
  const records = useMemo(() => recordsIn(all), [all]);
  const sections = useMemo<MonthSection[]>(() => {
    if (sort === 'newest') return monthSections(scoped);
    const data = sortRuns(scoped, sort);
    return data.length ? [{ key: sort, year: 0, month: 0, totals: totalsOf(data), data }] : [];
  }, [scoped, sort]);

  const scope = activeMonth != null && year != null ? monthYear(year, activeMonth) : year != null ? String(year) : 'All time';
  const filtered = sport !== 'all' || activeMonth != null || (years.length > 1 && year != null);

  const clearFilters = () => {
    Haptics.selectionAsync();
    setSport('all');
    setMonth(null);
    setYearPick(null);
  };

  const pickYear = (y: number | null) => {
    Haptics.selectionAsync();
    setYearPick(y);
    setMonth(null);
  };

  const pickBar = (key: number) => {
    if (year == null) return pickYear(key);
    Haptics.selectionAsync();
    setMonth((m) => (m === key ? null : key));
  };

  const open = useCallback((id: string) => navigation.navigate('Activity', { id }), [navigation]);

  const enqueue = useCallback((write: () => Promise<void>) => {
    writes.current = writes.current.then(write).catch(() => {});
  }, []);

  const remove = useCallback((run: Run) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRuns((r) => r?.filter((x) => x.id !== run.id) ?? r);
    enqueue(() => deleteRun(run.id));
    setUndo(run);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }, [enqueue]);

  const restore = () => {
    if (!undo) return;
    const run = undo;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
    setRuns((r) => (r ? [run, ...r] : r));
    enqueue(() => saveRun(run));
  };

  const firstSection = sections[0]?.key;
  const renderItem = useCallback(
    ({ item, index, section }: { item: Run; index: number; section: MonthSection }) => (
      <Row
        run={item}
        record={records.get(item.id)}
        enterDelay={!reduce && firstPaint.current && section.key === firstSection && index < ENTER_ROWS ? index * 40 : null}
        onOpen={open}
        onRemove={remove}
      />
    ),
    [records, reduce, firstSection, open, remove],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: MonthSection }) =>
      section.year ? (
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{monthYear(section.year, section.month)}</Text>
          <Text style={s.sectionSub}>
            {activities(section.totals.count)} · {formatKm(section.totals.distance)} km
          </Text>
        </View>
      ) : null,
    [],
  );

  const stats = [String(totals.count), formatDuration(totals.elapsed), formatPace(totals.pace)];
  const statSize = fitSize(stats, width - GUTTER * 2 - 36, 30);

  const noun = sport === 'run' ? 'runs' : sport === 'walk' ? 'walks' : 'activities';
  const header = (
    <View>
      {years.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={s.chips}>
          <Chip text="All time" on={year == null} onPress={() => pickYear(null)} />
          {years.map((y) => (
            <Chip key={y} text={String(y)} on={year === y} onPress={() => pickYear(y)} />
          ))}
        </ScrollView>
      )}

      {/* the total answers "how much?" for whatever is selected below it */}
      <View style={s.hero}>
        <Text style={label}>{scope}</Text>
        <View style={s.heroBig}>
          <Digits value={formatKm(totals.distance)} size={64} />
          <Text style={s.heroUnit}>km</Text>
        </View>
        <View style={s.heroStats}>
          {[
            { k: totals.count === 1 ? 'Activity' : 'Activities', v: stats[0] },
            { k: 'Moving', v: stats[1] },
            { k: 'Avg pace', v: stats[2] },
          ].map((st) => (
            <View key={st.k} style={{ flex: emWidth(st.v) + 1 }}>
              <Digits value={st.v} size={statSize} weight={font.d700} />
              <Text style={s.heroStatK}>{st.k}</Text>
            </View>
          ))}
        </View>

        <View style={s.bars}>
          {bars.map((b) => (
            <PeriodBar
              key={b.key}
              bar={b}
              max={Math.max(...bars.map((x) => x.value), 1)}
              text={year == null ? `'${String(b.key).slice(-2)}` : MONTH_LETTERS[b.key]}
              on={activeMonth === b.key}
              dim={activeMonth != null && activeMonth !== b.key}
              a11y={year == null ? String(b.key) : monthYear(year, b.key)}
              onPress={pickBar}
            />
          ))}
        </View>
        <Text style={s.barsHint}>
          {year == null ? 'Tap a year to open it' : activeMonth != null ? `Tap ${monthName(year, activeMonth)} again to see all of ${year}` : 'Tap a month to see just that month'}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll} contentContainerStyle={s.chips}>
        {SPORTS.map((o) => (
          <Chip
            key={o.key}
            text={o.text}
            on={sport === o.key}
            onPress={() => {
              Haptics.selectionAsync();
              setSport(o.key);
            }}
          />
        ))}
        <View style={s.chipRule} />
        {SORTS.map((o) => (
          <Chip
            key={o.key}
            text={o.text}
            on={sort === o.key}
            onPress={() => {
              Haptics.selectionAsync();
              setSort(o.key);
            }}
          />
        ))}
      </ScrollView>

      {sort === 'fastest' && sections.length > 0 && (
        <Text style={s.note}>Ranks activities of {MIN_RANKED_M / 1000} km or more</Text>
      )}
    </View>
  );

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={s.top}>
          <Pressable onPress={() => navigation.goBack()} style={s.back} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={s.title}>Activities</Text>
        </View>

        {runs === null ? (
          <View style={s.list}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[s.row, { height: 92, opacity: 0.5 - i * 0.1 }]} />
            ))}
          </View>
        ) : runs.length === 0 ? (
          <Animated.View entering={reduce ? undefined : FadeInDown.duration(400)} style={s.empty}>
            <View style={s.emptyRoute}>
              <RoutePreview points={GHOST_ROUTE} width="100%" height="100%" />
            </View>
            <Text style={s.emptyTitle}>Your history starts with one run</Text>
            <Text style={s.emptySub}>Every run and walk you record lands here, grouped by month with your totals.</Text>
            <Pressable
              onPress={() => navigation.replace('Tracking', { sport: 'run' })}
              style={({ pressed }) => [s.emptyBtn, pressed && { transform: [{ scale: 0.97 }] }]}
              accessibilityRole="button"
            >
              <Ionicons name="play" size={16} color={colors.onAccent} />
              <Text style={s.emptyBtnTxt}>Start a run</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <SectionList<Run, MonthSection>
            sections={sections}
            keyExtractor={(r) => r.id}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            ListHeaderComponent={header}
            ListEmptyComponent={
              <View style={s.none}>
                <Ionicons name="search-outline" size={24} color={colors.dim} />
                <Text style={s.noneTitle}>{sort === 'fastest' && scoped.length > 0 ? `Nothing of ${MIN_RANKED_M / 1000} km or more yet` : `No ${noun} in ${scope}`}</Text>
                {filtered && (
                  <Pressable onPress={clearFilters} style={s.noneBtn} accessibilityRole="button">
                    <Text style={s.noneBtnTxt}>Show everything</Text>
                  </Pressable>
                )}
              </View>
            }
            stickySectionHeadersEnabled
            removeClippedSubviews={false}
            initialNumToRender={10}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 96 }}
          />
        )}
      </SafeAreaView>

      {undo && (
        <Animated.View
          entering={reduce ? undefined : FadeInDown.duration(220)}
          exiting={reduce ? undefined : FadeOutDown.duration(160)}
          style={[s.toast, { bottom: insets.bottom + 16 }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={s.toastTxt} numberOfLines={1}>
            {titleOf(undo)} deleted
          </Text>
          <Pressable onPress={restore} hitSlop={10} style={s.toastBtn} accessibilityRole="button">
            <Text style={s.toastBtnTxt}>Undo</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const GHOST_ROUTE: [number, number][] = [
  [10, 44], [18, 36], [28, 40], [36, 26], [48, 30], [56, 18], [68, 22], [76, 32], [88, 28], [92, 40],
];

function Chip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.chipTxt, on && { color: colors.onAccent }]}>{text}</Text>
    </Pressable>
  );
}

function PeriodBar({
  bar,
  max,
  text,
  on,
  dim,
  a11y,
  onPress,
}: {
  bar: Bar;
  max: number;
  text: string;
  on: boolean;
  dim: boolean;
  a11y: string;
  onPress: (key: number) => void;
}) {
  const h = useSharedValue(0);
  const target = bar.value > 0 ? Math.max((bar.value / max) * BAR_H, 5) : 0;
  useEffect(() => {
    h.value = withTiming(target, { duration: 300, easing: Easing.out(Easing.cubic) });
  }, [h, target]);
  const fill = useAnimatedStyle(() => ({ height: h.value }));
  const empty = bar.value === 0;
  return (
    <Pressable
      onPress={() => onPress(bar.key)}
      disabled={empty}
      style={s.barCol}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: empty }}
      accessibilityLabel={`${a11y}, ${formatKm(bar.value)} kilometres`}
    >
      <View style={s.barTrack}>
        <Animated.View style={[s.barFill, dim && { opacity: 0.28 }, fill]} />
      </View>
      <Text style={[s.barTxt, on && { color: colors.accent }, empty && { color: colors.dim }]}>{text}</Text>
    </Pressable>
  );
}

const Row = memo(function Row({
  run,
  record,
  enterDelay,
  onOpen,
  onRemove,
}: {
  run: Run;
  record?: RunRecord;
  enterDelay: number | null;
  onOpen: (id: string) => void;
  onRemove: (run: Run) => void;
}) {
  const pace = run.distance > 20 ? run.elapsed / 1000 / (run.distance / 1000) : null;
  return (
    <Animated.View entering={enterDelay == null ? undefined : FadeInDown.delay(enterDelay).duration(300)}>
      <View style={s.row}>
        <Pressable
          onPress={() => onOpen(run.id)}
          style={({ pressed }) => [s.rowMain, pressed && { transform: [{ scale: 0.98 }] }]}
          accessibilityRole="button"
          accessibilityLabel={`${titleOf(run)}, ${whenOf(run.startedAt)}, ${formatKm(run.distance)} kilometres`}
        >
          <RouteThumb segments={run.segments} size={68} />
          <View style={{ flex: 1 }}>
            <View style={s.rowTop}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {titleOf(run)}
              </Text>
              {record && (
                <View style={s.badge}>
                  <Ionicons name="trophy" size={10} color={colors.accent} />
                  <Text style={s.badgeTxt}>{record}</Text>
                </View>
              )}
            </View>
            <Text style={s.rowWhen} numberOfLines={1}>
              {whenOf(run.startedAt)}
            </Text>
            <View style={s.rowStats}>
              <Text style={s.rowBig}>
                {formatKm(run.distance)}
                <Text style={s.rowUnit}> km</Text>
              </Text>
              <Text style={s.rowMid}>{formatDuration(run.elapsed)}</Text>
              <Text style={s.rowMid}>
                {formatPace(pace)}
                <Text style={s.rowUnit}> /km</Text>
              </Text>
            </View>
          </View>
        </Pressable>
        <Pressable onPress={() => onRemove(run)} style={s.trash} accessibilityRole="button" accessibilityLabel={`Delete ${titleOf(run)}`}>
          <Ionicons name="trash-outline" size={16} color={colors.dim} />
        </Pressable>
      </View>
    </Animated.View>
  );
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: GUTTER, paddingTop: 10, paddingBottom: 14 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontFamily: font.d800, fontSize: 40, lineHeight: 44 },

  chipScroll: { marginHorizontal: -GUTTER, flexGrow: 0 },
  chips: { paddingHorizontal: GUTTER, gap: 8, alignItems: 'center' },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 13 },
  chipRule: { width: 1, height: 22, backgroundColor: colors.hairline, marginHorizontal: 4 },

  hero: { marginTop: 12, marginBottom: 14, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, padding: 18 },
  heroBig: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  heroUnit: { color: colors.mute, fontFamily: font.d700, fontSize: 24 },
  heroStats: { flexDirection: 'row', marginTop: 12, gap: 8 },
  heroStatK: { color: colors.mute, fontFamily: font.t500, fontSize: 12, marginTop: 2 },
  bars: { flexDirection: 'row', marginTop: 20, gap: 2, justifyContent: 'center' },
  barCol: { flex: 1, maxWidth: 56, minHeight: 44, alignItems: 'center', gap: 8 },
  barTrack: { height: BAR_H, width: '72%', backgroundColor: colors.surface2, borderRadius: 5, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: colors.accent, borderRadius: 5 },
  barTxt: { color: colors.mute, fontFamily: font.t600, fontSize: 11 },
  barsHint: { color: colors.dim, fontFamily: font.t500, fontSize: 12, marginTop: 12, textAlign: 'center' },

  note: { color: colors.mute, fontFamily: font.t500, fontSize: 12, marginTop: 12 },

  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, backgroundColor: colors.bg, paddingTop: 18, paddingBottom: 10 },
  sectionTitle: { color: colors.text, fontFamily: font.d700, fontSize: 24, lineHeight: 28, flexShrink: 1 },
  sectionSub: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },

  list: { paddingHorizontal: GUTTER, paddingTop: 4 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, paddingLeft: 12, paddingVertical: 12, marginBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { color: colors.text, fontFamily: font.t700, fontSize: 15, flexShrink: 1 },
  rowWhen: { color: colors.mute, fontFamily: font.t500, fontSize: 12, marginTop: 2 },
  rowStats: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 6 },
  rowBig: { color: colors.text, fontFamily: font.d700, fontSize: 24, lineHeight: 26 },
  rowMid: { color: colors.text, fontFamily: font.d600, fontSize: 17, lineHeight: 26 },
  rowUnit: { color: colors.mute, fontFamily: font.t500, fontSize: 11 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.accentDim, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { color: colors.accent, fontFamily: font.t700, fontSize: 10 },
  trash: { width: 44, alignSelf: 'stretch', minHeight: 44, alignItems: 'center', justifyContent: 'center' },

  empty: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 12, alignItems: 'center' },
  emptyRoute: { width: '100%', height: 190, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden', opacity: 0.7 },
  emptyTitle: { color: colors.text, fontFamily: font.d700, fontSize: 28, lineHeight: 32, marginTop: 24, textAlign: 'center' },
  emptySub: { color: colors.mute, fontFamily: font.t500, fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center' },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 26, marginTop: 22, borderRadius: radius.pill, backgroundColor: colors.accent },
  emptyBtnTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 15 },

  none: { alignItems: 'center', paddingVertical: 42, gap: 10 },
  noneTitle: { color: colors.mute, fontFamily: font.t600, fontSize: 14, textAlign: 'center' },
  noneBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  noneBtnTxt: { color: colors.accent, fontFamily: font.t700, fontSize: 14 },

  toast: { position: 'absolute', left: GUTTER, right: GUTTER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 8, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  toastTxt: { color: colors.text, fontFamily: font.t600, fontSize: 14, flexShrink: 1 },
  toastBtn: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  toastBtnTxt: { color: colors.accent, fontFamily: font.t700, fontSize: 14 },
});
