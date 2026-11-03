import { formatPace } from '../lib/geo';
import { splitsFromTrack, splitsOf } from '../lib/splits';
import { M_PER_MI, formatDist, fromUnit, paceToUnit, setUnits, toUnit } from '../lib/units';
import type { Run } from '../lib/storage';

afterEach(() => setUnits('km'));

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r',
  sport: 'run',
  startedAt: 0,
  endedAt: 1,
  distance: 3000,
  elapsed: 900_000,
  steps: 0,
  segments: [],
  splits: [
    { km: 1, ms: 300_000 },
    { km: 2, ms: 300_000 },
    { km: 3, ms: 300_000 },
  ],
  ...over,
});

// steady 5:00/km: 1000 m every 300 s
const steady: [number, number, number | null][] = [0, 1, 2, 3].map((k) => [k * 300_000, k * 1000, null]);

describe('distance and pace in miles', () => {
  test('km is the identity', () => {
    expect(formatDist(5000)).toBe('5.00');
    expect(paceToUnit(300)).toBe(300);
    expect(formatPace(300)).toBe('5:00');
  });

  test('a 5:00/km pace is 8:03/mi', () => {
    setUnits('mi');
    expect(formatPace(300)).toBe('8:03');
    expect(formatDist(M_PER_MI)).toBe('1.00');
    expect(formatDist(5000)).toBe('3.11');
  });

  test('toUnit and fromUnit round-trip', () => {
    setUnits('mi');
    expect(toUnit(fromUnit(12.5))).toBeCloseTo(12.5, 10);
  });

  test('invalid paces still show a placeholder', () => {
    setUnits('mi');
    expect(formatPace(null)).toBe('--:--');
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(5000)).toBe('--:--');
  });
});

describe('splits from the GPS track', () => {
  test('kilometre splits of a steady run are 300 s each', () => {
    expect(splitsFromTrack(steady, 1000)).toEqual([
      { km: 1, ms: 300_000 },
      { km: 2, ms: 300_000 },
      { km: 3, ms: 300_000 },
    ]);
  });

  test('the first mile boundary is interpolated between fixes', () => {
    const [first] = splitsFromTrack(steady, M_PER_MI);
    expect(first.km).toBe(1);
    expect(first.ms).toBeCloseTo((M_PER_MI / 1000) * 300_000, -1);
  });

  test('a fix that jumps over several boundaries still yields every split', () => {
    const jump: [number, number, number | null][] = [[0, 0, null], [900_000, 3000, null]];
    expect(splitsFromTrack(jump, 1000)).toHaveLength(3);
  });

  test('no movement gives no splits', () => {
    expect(splitsFromTrack([[0, 0, null], [60_000, 0, null]], 1000)).toEqual([]);
  });
});

describe('splitsOf', () => {
  test('the run’s own splits are used when the unit matches', () => {
    const r = run();
    expect(splitsOf(r, 1000)).toEqual({ splits: r.splits, unitM: 1000 });
  });

  test('a km run viewed in miles is re-derived from its track', () => {
    const l = splitsOf(run({ track: steady }), M_PER_MI);
    expect(l.unitM).toBe(M_PER_MI);
    expect(l.splits).toHaveLength(1); // 3 km is 1.86 mi
  });

  test('without a track the run keeps its own unit instead of being mislabelled', () => {
    const l = splitsOf(run(), M_PER_MI);
    expect(l.unitM).toBe(1000);
    expect(l.splits).toHaveLength(3);
  });

  test('a mile-recorded run uses its splits directly in miles', () => {
    const r = run({ splitM: M_PER_MI, splits: [{ km: 1, ms: 480_000 }] });
    expect(splitsOf(r, M_PER_MI).splits).toEqual(r.splits);
  });
});
