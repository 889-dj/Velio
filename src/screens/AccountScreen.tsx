import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { Pedometer } from 'expo-sensors';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, Easing, useReducedMotion } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors, font, label, radius } from '../theme';
import {
  DEFAULT_WEIGHT_KG,
  Profile,
  Run,
  clearEverything,
  exportAll,
  loadProfile,
  loadRuns,
  loadWeight,
  saveProfile,
  saveWeight,
} from '../lib/storage';

type Props = NativeStackScreenProps<RootStackParamList, 'Account'>;
type Perm = 'granted' | 'denied' | 'undetermined' | 'unavailable';
type PermState = { status: Perm; canAskAgain: boolean };

const GOAL_STEP = 5;
const GOAL_MIN = 5;
const GOAL_MAX = 200;
const WEIGHT_MIN = 30;
const WEIGHT_MAX = 200;

const AVATAR_HUES = ['#C6FF3D', '#5EEAD4', '#7DD3FC', '#FDBA74', '#F9A8D4', '#C4B5FD'];
const hueFor = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
};
const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

const fmtHours = (ms: number) => (ms >= 3600000 ? (ms / 3600000).toFixed(1) : String(Math.round(ms / 60000)));

export default function AccountScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const enter = (i: number) =>
    reduce ? undefined : FadeInDown.delay(40 + i * 70).duration(420).easing(Easing.out(Easing.cubic));

  const [profile, setProfile] = useState<Profile | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [weight, setWeight] = useState(DEFAULT_WEIGHT_KG);
  const [nameDraft, setNameDraft] = useState('');
  const [loc, setLoc] = useState<PermState>({ status: 'undetermined', canAskAgain: true });
  const [motion, setMotion] = useState<PermState>({ status: 'undetermined', canAskAgain: true });
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [wiping, setWiping] = useState(false);
  const profileRef = useRef<Profile | null>(null);

  const readPerms = useCallback(async () => {
    try {
      const p = await Location.getForegroundPermissionsAsync();
      setLoc({ status: p.status as Perm, canAskAgain: p.canAskAgain });
    } catch {
      setLoc({ status: 'unavailable', canAskAgain: false });
    }
    try {
      if (!(await Pedometer.isAvailableAsync())) return setMotion({ status: 'unavailable', canAskAgain: false });
      const p = await Pedometer.getPermissionsAsync();
      setMotion({ status: p.status as Perm, canAskAgain: p.canAskAgain });
    } catch {
      setMotion({ status: 'unavailable', canAskAgain: false });
    }
  }, []);

  const load = useCallback(async () => {
    const [p, r, w] = await Promise.all([loadProfile(), loadRuns(), loadWeight()]);
    profileRef.current = p;
    setProfile(p);
    setNameDraft(p.name);
    setRuns(r);
    setWeight(w);
    readPerms();
  }, [readPerms]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  // coming back from the OS settings app: refresh the permission rows
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && readPerms());
    return () => sub.remove();
  }, [readPerms]);

  const update = (patch: Partial<Profile>) => {
    const next = { ...(profileRef.current as Profile), ...patch };
    profileRef.current = next;
    setProfile(next);
    saveProfile(next);
  };

  const totals = useMemo(
    () => ({
      count: runs.length,
      km: runs.reduce((a, r) => a + r.distance, 0) / 1000,
      ms: runs.reduce((a, r) => a + r.elapsed, 0),
    }),
    [runs],
  );
  const since = useMemo(() => {
    const first = runs.length ? Math.min(...runs.map((r) => r.startedAt)) : Infinity;
    if (!profile) return '';
    return new Date(Math.min(first, profile.since)).toLocaleDateString([], { month: 'long', year: 'numeric' });
  }, [runs, profile]);

  const commitName = () => {
    const n = nameDraft.trim().slice(0, 30);
    setNameDraft(n);
    if (profile && n !== profile.name) update({ name: n });
  };

  const step = (kind: 'goal' | 'weight', dir: 1 | -1) => {
    Haptics.selectionAsync();
    if (kind === 'goal' && profile) {
      update({ weeklyGoalKm: Math.min(GOAL_MAX, Math.max(GOAL_MIN, profile.weeklyGoalKm + dir * GOAL_STEP)) });
    } else if (kind === 'weight') {
      const w = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight + dir));
      setWeight(w);
      saveWeight(w);
    }
  };

  const askPermission = async (kind: 'loc' | 'motion') => {
    const st = kind === 'loc' ? loc : motion;
    if (st.status === 'unavailable') return;
    if (st.status === 'denied' && !st.canAskAgain) return Linking.openSettings();
    try {
      if (kind === 'loc') {
        const p = await Location.requestForegroundPermissionsAsync();
        setLoc({ status: p.status as Perm, canAskAgain: p.canAskAgain });
      } else {
        const p = await Pedometer.requestPermissionsAsync();
        setMotion({ status: p.status as Perm, canAskAgain: p.canAskAgain });
      }
    } catch {
      Linking.openSettings();
    }
  };

  const doExport = async (): Promise<boolean> => {
    setExporting(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing isn’t available on this device.');
        return false;
      }
      const data = await exportAll();
      const f = new File(Paths.cache, `run-data-${new Date().toISOString().slice(0, 10)}.json`);
      f.create({ overwrite: true });
      f.write(JSON.stringify(data, null, 2));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export your data' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch {
      Alert.alert('Export failed', 'Nothing was changed. Please try again.');
      return false;
    } finally {
      setExporting(false);
    }
  };

  const openConfirm = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setTyped('');
    setConfirmOpen(true);
  };

  const wipe = async () => {
    setWiping(true);
    await clearEverything();
    setWiping(false);
    setConfirmOpen(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await load();
    navigation.goBack();
  };

  const name = profile?.name ?? '';
  const initials = initialsOf(name);
  const hue = name ? hueFor(name) : colors.accent;
  const version = Constants.expoConfig?.version ?? '1.0.0';

  if (!profile) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={s.topBar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={s.back} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={s.topTitle}>Account</Text>
          <View style={{ width: 44 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 + insets.bottom }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* identity */}
            <Animated.View entering={enter(0)} style={s.identity}>
              <View
                style={[s.avatarRing, { borderColor: hue }]}
                accessible
                accessibilityLabel={name ? `Avatar for ${name}` : 'Avatar'}
              >
                <View style={s.avatar}>
                  {initials ? (
                    <Text style={[s.avatarTxt, { color: hue }]}>{initials}</Text>
                  ) : (
                    <Ionicons name="person" size={34} color={colors.mute} />
                  )}
                </View>
              </View>
              <View style={s.nameWrap}>
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  onBlur={commitName}
                  onSubmitEditing={commitName}
                  placeholder="Add your name"
                  placeholderTextColor={colors.dim}
                  maxLength={30}
                  returnKeyType="done"
                  autoCapitalize="words"
                  autoCorrect={false}
                  accessibilityLabel="Your name"
                  style={s.nameInput}
                />
                <Ionicons name="pencil" size={14} color={colors.dim} />
              </View>
              <Text style={s.since}>Member since {since}</Text>
            </Animated.View>

            {/* lifetime totals */}
            <Animated.View entering={enter(1)} style={s.totals}>
              <Total big={String(totals.count)} unit="" k="Activities" />
              <View style={s.vr} />
              <Total big={totals.km >= 100 ? String(Math.round(totals.km)) : totals.km.toFixed(1)} unit="km" k="Distance" />
              <View style={s.vr} />
              <Total big={fmtHours(totals.ms)} unit={totals.ms >= 3600000 ? 'h' : 'min'} k="Moving" />
            </Animated.View>

            <Animated.View entering={enter(2)}>
              <Text style={s.caption}>Goals and body</Text>
              <View style={s.group}>
                <StepperRow
                  icon="flag"
                  title="Weekly goal"
                  hint="Drives the ring on Home"
                  value={profile.weeklyGoalKm}
                  unit="km"
                  onDec={() => step('goal', -1)}
                  onInc={() => step('goal', 1)}
                  decDisabled={profile.weeklyGoalKm <= GOAL_MIN}
                  incDisabled={profile.weeklyGoalKm >= GOAL_MAX}
                  decLabel="Decrease weekly goal"
                  incLabel="Increase weekly goal"
                />
                <View style={s.sep} />
                <StepperRow
                  icon="barbell"
                  title="Weight"
                  hint="Used for calorie estimates only"
                  value={weight}
                  unit="kg"
                  onDec={() => step('weight', -1)}
                  onInc={() => step('weight', 1)}
                  decDisabled={weight <= WEIGHT_MIN}
                  incDisabled={weight >= WEIGHT_MAX}
                  decLabel="Decrease weight"
                  incLabel="Increase weight"
                />
              </View>
            </Animated.View>

            <Animated.View entering={enter(3)}>
              <Text style={s.caption}>Privacy</Text>
              <View style={s.group}>
                <Pressable
                  style={s.row}
                  onPress={() => {
                    Haptics.selectionAsync();
                    update({ hideEnds: !profile.hideEnds });
                  }}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: profile.hideEnds }}
                >
                  <Chip icon="eye-off" />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>Hide start and finish</Text>
                    <Text style={s.rowHint}>Default for new share videos. Trims the first and last 200 m, so your front door isn’t shown.</Text>
                  </View>
                  <Switch
                    value={profile.hideEnds}
                    onValueChange={(v) => {
                      Haptics.selectionAsync();
                      update({ hideEnds: v });
                    }}
                    trackColor={{ false: colors.surface2, true: colors.accent }}
                    thumbColor={colors.text}
                    ios_backgroundColor={colors.surface2}
                  />
                </Pressable>
              </View>
              <Text style={s.note}>Nothing is posted anywhere automatically. Routes never leave this phone unless you share them.</Text>
            </Animated.View>

            <Animated.View entering={enter(4)}>
              <Text style={s.caption}>Permissions</Text>
              <View style={s.group}>
                <PermRow
                  icon="location"
                  title="Location"
                  hint="Only used while you record an activity"
                  st={loc}
                  onPress={() => askPermission('loc')}
                />
                <View style={s.sep} />
                <PermRow
                  icon="footsteps"
                  title="Motion and steps"
                  hint="Steps and cadence"
                  st={motion}
                  onPress={() => askPermission('motion')}
                />
              </View>
            </Animated.View>

            <Animated.View entering={enter(5)}>
              <Text style={s.caption}>Your data</Text>
              <View style={s.group}>
                <Pressable
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                  onPress={doExport}
                  disabled={exporting}
                  accessibilityRole="button"
                >
                  <Chip icon="download" />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>Export everything</Text>
                    <Text style={s.rowHint}>
                      {totals.count} {totals.count === 1 ? 'activity' : 'activities'}, profile and weight as a JSON file
                    </Text>
                  </View>
                  {exporting ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="share-outline" size={20} color={colors.mute} />}
                </Pressable>
              </View>
            </Animated.View>

            <Animated.View entering={enter(6)}>
              <Text style={[s.caption, { color: colors.danger }]}>Danger zone</Text>
              <View style={[s.group, { borderColor: 'rgba(255,77,79,0.28)' }]}>
                <Pressable style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={openConfirm} accessibilityRole="button">
                  <Chip icon="trash" danger />
                  <View style={s.rowText}>
                    <Text style={[s.rowTitle, { color: colors.danger }]}>Delete all data</Text>
                    <Text style={s.rowHint}>Removes every activity, your profile and weight from this phone. Can’t be undone.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.dim} />
                </Pressable>
              </View>
            </Animated.View>

            <Text style={s.footer}>Version {version} · Stored only on this device</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => !wiping && setConfirmOpen(false)}>
        <KeyboardAvoidingView style={s.scrim} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[s.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <View style={s.sheetIcon}>
              <Ionicons name="warning" size={22} color={colors.danger} />
            </View>
            <Text style={s.sheetTitle}>Delete everything?</Text>
            <Text style={s.sheetBody}>
              This permanently removes {totals.count} {totals.count === 1 ? 'activity' : 'activities'}, your name, goal and weight from this phone. There is no
              account or cloud copy, so it can’t be recovered.
            </Text>
            <Pressable
              onPress={async () => {
                await doExport();
              }}
              disabled={exporting || wiping}
              style={({ pressed }) => [s.sheetBtn, s.sheetBtnGhost, pressed && s.pressed]}
            >
              <Ionicons name="download" size={16} color={colors.text} />
              <Text style={s.sheetBtnTxt}>Export first</Text>
            </Pressable>
            <Text style={s.typeLabel}>Type DELETE to confirm</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="DELETE"
              placeholderTextColor={colors.dim}
              style={s.typeInput}
              accessibilityLabel="Type DELETE to confirm"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => setConfirmOpen(false)} disabled={wiping} style={[s.sheetBtn, s.sheetBtnGhost, { flex: 1 }]}>
                <Text style={s.sheetBtnTxt}>Keep my data</Text>
              </Pressable>
              <Pressable
                onPress={wipe}
                disabled={typed.trim().toUpperCase() !== 'DELETE' || wiping}
                style={[s.sheetBtn, { flex: 1, backgroundColor: colors.danger, opacity: typed.trim().toUpperCase() === 'DELETE' ? 1 : 0.35 }]}
              >
                {wiping ? <ActivityIndicator color="#fff" /> : <Text style={[s.sheetBtnTxt, { color: '#fff' }]}>Delete data</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Total({ big, unit, k }: { big: string; unit: string; k: string }) {
  return (
    <View style={s.total}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
        <Text style={s.totalBig} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {big}
        </Text>
        {unit ? <Text style={s.totalUnit}>{unit}</Text> : null}
      </View>
      <Text style={s.totalK}>{k}</Text>
    </View>
  );
}

function Chip({ icon, danger }: { icon: keyof typeof Ionicons.glyphMap; danger?: boolean }) {
  return (
    <View style={[s.chip, danger && { backgroundColor: 'rgba(255,77,79,0.14)' }]}>
      <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.accent} />
    </View>
  );
}

function StepperRow(p: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  value: number;
  unit: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
  incDisabled: boolean;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <View style={s.row}>
      <Chip icon={p.icon} />
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{p.title}</Text>
        <Text style={s.rowHint}>{p.hint}</Text>
      </View>
      <View style={s.stepper}>
        <Pressable
          onPress={p.onDec}
          disabled={p.decDisabled}
          hitSlop={4}
          style={[s.stepBtn, p.decDisabled && { opacity: 0.3 }]}
          accessibilityRole="button"
          accessibilityLabel={p.decLabel}
        >
          <Ionicons name="remove" size={18} color={colors.text} />
        </Pressable>
        <View style={s.stepVal}>
          <Text style={s.stepNum}>{p.value}</Text>
          <Text style={s.stepUnit}>{p.unit}</Text>
        </View>
        <Pressable
          onPress={p.onInc}
          disabled={p.incDisabled}
          hitSlop={4}
          style={[s.stepBtn, p.incDisabled && { opacity: 0.3 }]}
          accessibilityRole="button"
          accessibilityLabel={p.incLabel}
        >
          <Ionicons name="add" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

function PermRow({
  icon,
  title,
  hint,
  st,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  st: PermState;
  onPress: () => void;
}) {
  const granted = st.status === 'granted';
  const unavailable = st.status === 'unavailable';
  const action = granted || unavailable ? null : st.status === 'denied' && !st.canAskAgain ? 'Open Settings' : 'Allow';
  const status = granted ? 'On' : unavailable ? 'Not available' : st.status === 'denied' ? 'Off' : 'Not asked';
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && !!action && s.pressed]}
      onPress={action ? onPress : granted ? () => Linking.openSettings() : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${status}`}
    >
      <Chip icon={icon} />
      <View style={s.rowText}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowHint}>{hint}</Text>
      </View>
      {action ? (
        <View style={s.actionPill}>
          <Text style={s.actionTxt}>{action}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {granted && <View style={s.dot} />}
          <Text style={[s.status, granted && { color: colors.text }]}>{status}</Text>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topTitle: { color: colors.text, fontFamily: font.t700, fontSize: 16 },

  identity: { alignItems: 'center', marginTop: 8 },
  avatarRing: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.d800, fontSize: 38, lineHeight: 42 },
  nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, minHeight: 44 },
  nameInput: { color: colors.text, fontFamily: font.d800, fontSize: 32, minWidth: 140, textAlign: 'center', paddingVertical: 4 },
  since: { color: colors.mute, fontFamily: font.t500, fontSize: 13, marginTop: 2 },

  totals: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  total: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  totalBig: { color: colors.text, fontFamily: font.d700, fontSize: 36, lineHeight: 38 },
  totalUnit: { color: colors.mute, fontFamily: font.t500, fontSize: 12 },
  totalK: { ...label, marginTop: 4 },
  vr: { width: 1, height: 36, backgroundColor: colors.hairline },

  caption: { ...label, marginTop: 26, marginBottom: 10, marginLeft: 4 },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline, marginLeft: 58 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12, paddingHorizontal: 14 },
  pressed: { backgroundColor: colors.surface2 },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontFamily: font.t600, fontSize: 15 },
  rowHint: { color: colors.mute, fontFamily: font.t500, fontSize: 12, lineHeight: 17, marginTop: 2 },
  note: { color: colors.dim, fontFamily: font.t500, fontSize: 12, lineHeight: 17, marginTop: 8, marginLeft: 4 },
  chip: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 58, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 3 },
  stepNum: { color: colors.text, fontFamily: font.d700, fontSize: 24 },
  stepUnit: { color: colors.mute, fontFamily: font.t500, fontSize: 11 },

  actionPill: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center' },
  actionTxt: { color: colors.onAccent, fontFamily: font.t700, fontSize: 13 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  status: { color: colors.mute, fontFamily: font.t600, fontSize: 13 },

  footer: { color: colors.dim, fontFamily: font.t500, fontSize: 12, textAlign: 'center', marginTop: 30 },

  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: colors.hairline },
  sheetIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,77,79,0.14)', alignItems: 'center', justifyContent: 'center' },
  sheetTitle: { color: colors.text, fontFamily: font.d800, fontSize: 30, marginTop: 12 },
  sheetBody: { color: colors.mute, fontFamily: font.t500, fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 16 },
  sheetBtn: { height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sheetBtnGhost: { backgroundColor: colors.surface2 },
  sheetBtnTxt: { color: colors.text, fontFamily: font.t700, fontSize: 15 },
  typeLabel: { ...label, marginTop: 18, marginBottom: 8 },
  typeInput: { height: 48, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.hairline, color: colors.text, fontFamily: font.t700, fontSize: 16, letterSpacing: 2, paddingHorizontal: 14 },
});
