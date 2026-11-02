import type { Run, Sport } from './storage';

export type SportFilter = 'all' | Sport;
export type HistorySort = 'newest' | 'longest' | 'fastest';
export type RunRecord = 'Longest' | 'Fastest';

/** Pace on a very short activity is noise, so "fastest" only ranks activities at least this long. */
export const MIN_RANKED_M = 1000;

export type Totals = { count: number; distance: number; elapsed: number; pace: number | null };
export type MonthSection = { key: string; year: number; month: number; totals: Totals; data: Run[] };
export type Bar = { key: number; value: number };

const paceOf = (distance: number, elapsed: number) => (distance > 20 ? elapsed / 1000 / (distance / 1000) : null);

export function totalsOf(runs: Run[]): Totals {
  const distance = runs.reduce((a, r) => a + r.distance, 0);
  const elapsed = runs.reduce((a, r) => a + r.elapsed, 0);
  return { count: runs.length, distance, elapsed, pace: paceOf(distance, elapsed) };
}

/** Years that hold at least one activity, newest first. */
export const yearsOf = (runs: Run[]) =>
  [...new Set(runs.map((r) => new Date(r.startedAt).getFullYear()))].sort((a, b) => b - a);

/** Sport, year and month filter independently of each other. A month only applies within a year. */
export function filterRuns(runs: Run[], f: { sport?: SportFilter; year?: number | null; month?: number | null }) {
  return runs.filter((r) => {
    const d = new Date(r.startedAt);
    if (f.sport && f.sport !== 'all' && r.sport !== f.sport) return false;
    if (f.year != null && d.getFullYear() !== f.year) return false;
    if (f.year != null && f.month != null && d.getMonth() !== f.month) return false;
    return true;
  });
}

/** Sorts the whole set, never a loaded page of it. Ties fall back to newest first. */
export function sortRuns(runs: Run[], sort: HistorySort) {
  const newest = (a: Run, b: Run) => b.startedAt - a.startedAt;
  if (sort === 'longest') return [...runs].sort((a, b) => b.distance - a.distance || newest(a, b));
  if (sort === 'fastest') {
    return runs
      .filter((r) => r.distance >= MIN_RANKED_M && r.elapsed > 0)
      .sort((a, b) => a.elapsed / a.distance - b.elapsed / b.distance || newest(a, b));
  }
  return [...runs].sort(newest);
}

/** Groups activities by calendar month, newest month and newest activity first. */
export function monthSections(runs: Run[]): MonthSection[] {
  const months = new Map<string, Run[]>();
  for (const r of sortRuns(runs, 'newest')) {
    const d = new Date(r.startedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    months.set(key, [...(months.get(key) ?? []), r]);
  }
  return [...months].map(([key, data]) => {
    const d = new Date(data[0].startedAt);
    return { key, year: d.getFullYear(), month: d.getMonth(), totals: totalsOf(data), data };
  });
}

/** Distance per month of `year`, always twelve bars. */
export function monthBars(runs: Run[], year: number): Bar[] {
  const bars: Bar[] = Array.from({ length: 12 }, (_, key) => ({ key, value: 0 }));
  for (const r of filterRuns(runs, { year })) bars[new Date(r.startedAt).getMonth()].value += r.distance;
  return bars;
}

/** Distance per year, oldest on the left, for the most recent `max` years with activity. */
export function yearBars(runs: Run[], max = 12): Bar[] {
  return yearsOf(runs)
    .slice(0, max)
    .reverse()
    .map((key) => ({ key, value: filterRuns(runs, { year: key }).reduce((a, r) => a + r.distance, 0) }));
}

/** Longest per sport and fastest run, once there are at least two activities to compare. */
export function recordsIn(runs: Run[]): Map<string, RunRecord> {
  const out = new Map<string, RunRecord>();
  const fastest = sortRuns(filterRuns(runs, { sport: 'run' }), 'fastest');
  if (fastest.length > 1) out.set(fastest[0].id, 'Fastest');
  (['run', 'walk'] as Sport[]).forEach((sport) => {
    const same = filterRuns(runs, { sport });
    if (same.length > 1) out.set(sortRuns(same, 'longest')[0].id, 'Longest');
  });
  return out;
}
