import { filterRuns, monthBars, monthSections, recordsIn, sortRuns, totalsOf, yearBars, yearsOf } from '../lib/history';
import type { Run, Sport } from '../lib/storage';

const run = (id: string, y: number, m: number, d: number, km: number, min: number, sport: Sport = 'run'): Run => ({
  id,
  sport,
  startedAt: new Date(y, m, d, 8).getTime(),
  endedAt: new Date(y, m, d, 9).getTime(),
  distance: km * 1000,
  elapsed: min * 60000,
  steps: 0,
  segments: [],
  splits: [],
});

const runs = [
  run('a', 2026, 9, 20, 5, 25),
  run('b', 2026, 9, 2, 10, 60),
  run('c', 2026, 2, 14, 3, 30, 'walk'),
  run('d', 2025, 11, 31, 21, 110),
  run('short', 2026, 8, 1, 0.5, 1),
];

describe('history', () => {
  test('totals add up and average pace is distance-weighted', () => {
    const t = totalsOf([run('x', 2026, 0, 1, 5, 25), run('y', 2026, 0, 2, 5, 35)]);
    expect(t.count).toBe(2);
    expect(t.distance).toBe(10000);
    expect(t.pace).toBe(360);
  });

  test('totals of nothing have no pace', () => {
    expect(totalsOf([])).toEqual({ count: 0, distance: 0, elapsed: 0, pace: null });
  });

  test('years are unique and newest first', () => {
    expect(yearsOf(runs)).toEqual([2026, 2025]);
  });

  test('sport, year and month filter independently', () => {
    expect(filterRuns(runs, { sport: 'walk' }).map((r) => r.id)).toEqual(['c']);
    expect(filterRuns(runs, { year: 2025 }).map((r) => r.id)).toEqual(['d']);
    expect(filterRuns(runs, { year: 2026, month: 9 }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterRuns(runs, { sport: 'walk', year: 2026, month: 9 })).toEqual([]);
  });

  test('a month with no year is ignored', () => {
    expect(filterRuns(runs, { month: 9 })).toHaveLength(runs.length);
  });

  test('sorts cover the whole set', () => {
    expect(sortRuns(runs, 'newest').map((r) => r.id)).toEqual(['a', 'b', 'short', 'c', 'd']);
    expect(sortRuns(runs, 'longest').map((r) => r.id)).toEqual(['d', 'b', 'a', 'c', 'short']);
  });

  test('fastest ranks only activities of 1 km or more', () => {
    const ids = sortRuns(runs, 'fastest').map((r) => r.id);
    expect(ids[0]).toBe('a');
    expect(ids).not.toContain('short');
  });

  test('sorting does not mutate the input', () => {
    const copy = [...runs];
    sortRuns(runs, 'longest');
    expect(runs).toEqual(copy);
  });

  test('sections group by month, newest first, with month totals', () => {
    const secs = monthSections(runs);
    expect(secs.map((x) => x.key)).toEqual(['2026-9', '2026-8', '2026-2', '2025-11']);
    expect(secs[0].data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(secs[0].totals.distance).toBe(15000);
  });

  test('a run on the last day of the year stays in that year', () => {
    expect(monthSections(runs)[3].year).toBe(2025);
    expect(monthBars(runs, 2025)[11].value).toBe(21000);
  });

  test('month bars are always twelve', () => {
    const bars = monthBars(runs, 2026);
    expect(bars).toHaveLength(12);
    expect(bars[9].value).toBe(15000);
    expect(bars[0].value).toBe(0);
  });

  test('year bars run oldest to newest', () => {
    expect(yearBars(runs).map((b) => b.key)).toEqual([2025, 2026]);
  });

  test('records need something to compare against', () => {
    expect(recordsIn([run('only', 2026, 0, 1, 5, 25)]).size).toBe(0);
  });

  test('a walk never takes the fastest badge, and longest wins a tie for one run', () => {
    const r = recordsIn(runs);
    expect(r.get('d')).toBe('Longest');
    expect(r.get('a')).toBe('Fastest');
    expect([...r.entries()].filter(([, v]) => v === 'Fastest').map(([id]) => id)).not.toContain('c');
    const same = recordsIn([run('big', 2026, 0, 1, 10, 40), run('small', 2026, 0, 2, 5, 40)]);
    expect(same.get('big')).toBe('Longest');
  });
});
