import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Coord } from './geo';

export type Sport = 'run' | 'walk';

export type Run = {
  id: string;
  sport: Sport;
  startedAt: number;
  endedAt: number;
  distance: number; // metres
  elapsed: number; // moving ms
  steps: number;
  segments: Coord[][];
  splits: { km: number; ms: number }[];
  /** Per accepted GPS fix: [moving ms, cumulative metres, altitude m | null]. Absent on older runs. */
  track?: [number, number, number | null][];
  /** Cadence samples: [moving ms, steps per minute]. Absent on older runs or without a pedometer. */
  cadence?: [number, number][];
};

const RUNS = 'runs:v1';
const ACTIVE = 'run:active:v1';

const round = (c: Coord): Coord => ({
  latitude: +c.latitude.toFixed(5),
  longitude: +c.longitude.toFixed(5),
});
const pack = (r: Run): Run => ({ ...r, segments: r.segments.map((s) => s.map(round)) });

async function read<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function loadRuns(): Promise<Run[]> {
  const runs = await read<Run[]>(RUNS, []);
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

export async function saveRun(run: Run) {
  const runs = await read<Run[]>(RUNS, []);
  const next = [pack(run), ...runs.filter((r) => r.id !== run.id)];
  await AsyncStorage.setItem(RUNS, JSON.stringify(next));
}

export async function deleteRun(id: string) {
  const runs = await read<Run[]>(RUNS, []);
  await AsyncStorage.setItem(RUNS, JSON.stringify(runs.filter((r) => r.id !== id)));
}

/** In-progress checkpoint, written every few seconds so a crash never loses a run. */
export async function saveActive(run: Run) {
  try {
    await AsyncStorage.setItem(ACTIVE, JSON.stringify(pack(run)));
  } catch {}
}
export const loadActive = () => read<Run | null>(ACTIVE, null);
export async function clearActive() {
  try {
    await AsyncStorage.removeItem(ACTIVE);
  } catch {}
}

// ---------- profile (used only for the calorie estimate) ----------
const WEIGHT = 'profile:weightKg';
export const DEFAULT_WEIGHT_KG = 70;

export async function loadWeight(): Promise<number> {
  const v = await read<number | null>(WEIGHT, null);
  return v && v > 20 && v < 250 ? v : DEFAULT_WEIGHT_KG;
}
export async function saveWeight(kg: number) {
  try {
    await AsyncStorage.setItem(WEIGHT, JSON.stringify(Math.round(kg)));
  } catch {}
}

// ---------- account (local-only: nothing leaves the device) ----------
export type Profile = {
  name: string;
  weeklyGoalKm: number;
  /** Default for the "Hide start and finish" switch on the share screen. */
  hideEnds: boolean;
  /** First launch of the account screen, shown as "Member since". */
  since: number;
};
export const DEFAULT_GOAL_KM = 20;
const PROFILE = 'profile:v1';

export async function loadProfile(): Promise<Profile> {
  const p = await read<Partial<Profile> | null>(PROFILE, null);
  const goal = p?.weeklyGoalKm;
  const profile: Profile = {
    name: typeof p?.name === 'string' ? p.name : '',
    weeklyGoalKm: goal && goal >= 1 && goal <= 500 ? goal : DEFAULT_GOAL_KM,
    hideEnds: p?.hideEnds ?? true,
    since: p?.since ?? Date.now(),
  };
  if (!p?.since) await saveProfile(profile); // pin "member since" to the first load
  return profile;
}
export async function saveProfile(p: Profile) {
  try {
    await AsyncStorage.setItem(PROFILE, JSON.stringify(p));
  } catch {}
}

/** Everything the app stores, as one object (for export). */
export async function exportAll() {
  const [runs, profile, weightKg] = await Promise.all([loadRuns(), loadProfile(), loadWeight()]);
  return { app: 'strava-clone', exportedAt: new Date().toISOString(), profile, weightKg, runs };
}

/** Wipes runs, the in-progress checkpoint, profile and weight. */
export async function clearEverything() {
  await AsyncStorage.multiRemove([RUNS, ACTIVE, PROFILE, WEIGHT]);
}
