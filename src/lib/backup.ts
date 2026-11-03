import { Run, loadRuns, saveRuns } from './storage';

// Runs live in one file each, so the library has no practical size limit; this only stops a wrong, huge file
// from being read into memory. A year of daily runs is roughly 30-40 MB of JSON.
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** "strava-clone" is the app's name before the rename; old exports still carry it. */
const ACCEPTED_APPS = ['velio', 'strava-clone'];

export type ImportResult = { imported: number; skipped: number };
export class ImportError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCoord = (c: unknown) =>
  !!c && typeof c === 'object' && isNum((c as { latitude: unknown }).latitude) && isNum((c as { longitude: unknown }).longitude);

export function isValidRun(r: unknown): r is Run {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    x.id.length > 0 &&
    (x.sport === 'run' || x.sport === 'walk') &&
    isNum(x.startedAt) &&
    isNum(x.endedAt) &&
    isNum(x.distance) &&
    x.distance >= 0 &&
    isNum(x.elapsed) &&
    x.elapsed >= 0 &&
    isNum(x.steps) &&
    Array.isArray(x.segments) &&
    x.segments.every((s) => Array.isArray(s) && s.every(isCoord)) &&
    Array.isArray(x.splits) &&
    x.splits.every((s) => !!s && isNum((s as { km: unknown }).km) && isNum((s as { ms: unknown }).ms)) &&
    (x.splitM === undefined || (isNum(x.splitM) && x.splitM > 0)) &&
    (x.track === undefined || Array.isArray(x.track)) &&
    (x.cadence === undefined || Array.isArray(x.cadence))
  );
}

/** Pure part of a restore: validates everything, writes nothing. */
export function planImport(text: string, existing: Run[]): { next: Run[]; fresh: Run[]; result: ImportResult } {
  if (text.length > MAX_FILE_BYTES) throw new ImportError('That file is larger than 64 MB, so it can’t be a Velio backup.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('That file isn’t valid JSON. Pick a backup exported from Velio.');
  }
  const d = data as { app?: unknown; runs?: unknown } | null;
  if (!d || typeof d !== 'object' || typeof d.app !== 'string' || !ACCEPTED_APPS.includes(d.app)) {
    throw new ImportError('That file isn’t a Velio backup.');
  }
  if (!Array.isArray(d.runs)) throw new ImportError('The backup has no list of runs.');
  const bad = d.runs.findIndex((r) => !isValidRun(r));
  if (bad >= 0) throw new ImportError(`Run ${bad + 1} in the backup is damaged. Nothing was imported.`);

  const have = new Set(existing.map((r) => r.id));
  const fresh: Run[] = [];
  for (const r of d.runs as Run[]) {
    if (have.has(r.id)) continue; // the phone's copy always wins
    have.add(r.id);
    fresh.push(r);
  }
  const next = [...existing, ...fresh];
  return { next, fresh, result: { imported: fresh.length, skipped: (d.runs as Run[]).length - fresh.length } };
}

export async function importRuns(text: string): Promise<ImportResult> {
  const existing = await loadRuns();
  const { fresh, result } = planImport(text, existing);
  if (fresh.length > 0) await saveRuns(fresh);
  return result;
}
