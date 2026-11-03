import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Coord } from './geo';
import { Units, defaultUnits } from './units';

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
  /** Each split is `splitM` metres long (1000 when absent: runs recorded before the units option). `km` is the split's number. */
  splits: { km: number; ms: number }[];
  splitM?: number;
  /** Per accepted GPS fix: [moving ms, cumulative metres, altitude m | null]. Absent on older runs. */
  track?: [number, number, number | null][];
  /** Cadence samples: [moving ms, steps per minute]. Absent on older runs or without a pedometer. */
  cadence?: [number, number][];
};

/** The old single-list key. Only read once, to move existing runs into per-run files. */
export const LEGACY_RUNS_KEY = 'runs:v1';
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

// ---------- run storage: one file per run ----------
export interface RunStore {
  readAll(): Promise<Run[]>;
  write(run: Run): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

let store: RunStore | null = null;
/** Swap the backing store (tests use an in-memory one). */
export function setRunStore(next: RunStore | null) {
  store = next;
  cache = null;
  migrated = null;
}
function backing(): RunStore {
  // required lazily so importing this module never touches the native file system
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (store ??= require('./runFiles').fileRunStore as RunStore);
}

let cache: Map<string, Run> | null = null;
let migrated: Promise<void> | null = null;

/** Moves runs from the old AsyncStorage list into files. The old list is only deleted once every run reads back. */
async function migrateLegacy() {
  const legacy = await read<unknown>(LEGACY_RUNS_KEY, null);
  if (!Array.isArray(legacy)) return;
  if (legacy.length === 0) {
    await AsyncStorage.removeItem(LEGACY_RUNS_KEY).catch(() => {});
    return;
  }
  const runs = legacy as Run[];
  const have = new Set((await backing().readAll()).map((r) => r.id));
  for (const r of runs) if (r && typeof r.id === 'string' && !have.has(r.id)) await backing().write(pack(r));
  const after = new Set((await backing().readAll()).map((r) => r.id));
  if (runs.every((r) => r && after.has(r.id))) await AsyncStorage.removeItem(LEGACY_RUNS_KEY);
}

async function ready() {
  if (!migrated) migrated = migrateLegacy().catch(() => {});
  await migrated;
  if (!cache) {
    const all = await backing().readAll();
    // if migration could not finish, the old list still holds runs: show them too rather than hide them
    const legacy = await read<Run[]>(LEGACY_RUNS_KEY, []);
    cache = new Map([...(Array.isArray(legacy) ? legacy : []), ...all].map((r) => [r.id, r] as const));
  }
  return cache;
}

export async function loadRuns(): Promise<Run[]> {
  const map = await ready();
  return [...map.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export async function saveRun(run: Run) {
  const map = await ready();
  const packed = pack(run);
  await backing().write(packed);
  map.set(packed.id, packed);
}

/** Saves several runs (used by restore). Stops at the first failure, keeping what was already written. */
export async function saveRuns(runs: Run[]) {
  for (const r of runs) await saveRun(r);
}

export async function deleteRun(id: string) {
  const map = await ready();
  await backing().remove(id);
  map.delete(id);
  // a run still sitting in the un-migrated legacy list would otherwise come back
  const legacy = await read<Run[]>(LEGACY_RUNS_KEY, []);
  if (Array.isArray(legacy) && legacy.some((r) => r.id === id)) {
    await AsyncStorage.setItem(LEGACY_RUNS_KEY, JSON.stringify(legacy.filter((r) => r.id !== id)));
  }
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

// ---------- first-run explainer ----------
const EXPLAINED = 'tracking:explained:v1';
export const hasSeenExplainer = async () => (await read<boolean>(EXPLAINED, false)) === true;
export async function markExplainerSeen() {
  try {
    await AsyncStorage.setItem(EXPLAINED, 'true');
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
  /** Distance and pace units shown everywhere. Stored data is always metres. */
  units: Units;
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
    units: p?.units === 'mi' || p?.units === 'km' ? p.units : defaultUnits(),
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
  return { app: 'velio', exportedAt: new Date().toISOString(), profile, weightKg, runs };
}

/** Wipes runs, the in-progress checkpoint, profile and weight. */
export async function clearEverything() {
  await AsyncStorage.multiRemove([LEGACY_RUNS_KEY, ACTIVE, PROFILE, WEIGHT, EXPLAINED]);
  await backing().clear();
  cache = null;
}
