import { RunEngine, Fix, StepGate } from '../lib/engine';

const T0 = 1_700_000_000_000;
const M_PER_DEG = 111_195; // metres per degree of latitude on the engine's sphere
// a fix `metres` north of the origin at time T0 + ms
const fix = (metres: number, ms: number, over: Partial<Fix> = {}): Fix => ({
  latitude: 51 + metres / M_PER_DEG,
  longitude: 0,
  accuracy: 5,
  altitude: 10,
  timestamp: T0 + ms,
  ...over,
});
const started = () => {
  const e = new RunEngine();
  e.start(T0, 'run', 'r1');
  return e;
};

describe('RunEngine ingest rules', () => {
  test('P1 drops fixes with accuracy worse than 20 m', () => {
    const e = started();
    e.ingest(fix(0, 1000));
    e.ingest(fix(10, 2000, { accuracy: 25 }));
    expect(e.distance).toBe(0);
    e.ingest(fix(10, 3000));
    expect(e.distance).toBeCloseTo(10, 0);
  });

  test('P2 the first fix only starts the segment', () => {
    const e = started();
    e.ingest(fix(0, 1000));
    expect(e.distance).toBe(0);
    expect(e.segments).toHaveLength(1);
    expect(e.segments[0]).toHaveLength(1);
  });

  test('P3 a hole longer than 15 s starts a new segment and adds no distance', () => {
    const e = started();
    e.ingest(fix(0, 1000));
    e.ingest(fix(8, 2000));
    const before = e.distance;
    e.ingest(fix(500, 40_000));
    expect(e.distance).toBe(before);
    expect(e.segments).toHaveLength(2);
  });

  test('P4 jitter under 3 m and jumps over 12 m/s are dropped', () => {
    const e = started();
    e.ingest(fix(0, 1000));
    e.ingest(fix(1, 2000));
    expect(e.distance).toBe(0);
    e.ingest(fix(200, 3000)); // 200 m in 1 s
    expect(e.distance).toBe(0);
  });

  test('P5 accepted steps add up to the distance', () => {
    const e = started();
    for (let i = 0; i <= 10; i++) e.ingest(fix(i * 5, 1000 + i * 1000));
    expect(e.distance).toBeCloseTo(50, 0);
  });

  test('P7 current pace follows the recent window', () => {
    const e = started();
    for (let i = 0; i <= 10; i++) e.ingest(fix(i * 4, 1000 + i * 1000)); // 4 m/s = 250 s/km
    expect(e.currentPace).toBeCloseTo(250, -1);
  });

  test('P8 stride calibrates from GPS after 100 steps and 100 m', () => {
    const e = started();
    e.steps = 150;
    for (let i = 0; i <= 30; i++) e.ingest(fix(i * 4, 1000 + i * 1000));
    expect(e.stride).toBeCloseTo(e.gpsDistance / 150, 3);
  });

  test('P9 steps add distance only while GPS is lost', () => {
    const e = started();
    e.addSteps(10, 10, false);
    expect(e.fallbackDistance).toBe(0);
    e.addSteps(30, 20, true);
    expect(e.fallbackDistance).toBeCloseTo(20 * 0.75, 5);
  });

  test('I1 duplicate and out-of-order fixes are ignored', () => {
    const e = started();
    e.ingest(fix(0, 1000));
    e.ingest(fix(10, 3000));
    const d = e.distance;
    e.ingest(fix(10, 3000)); // duplicate
    e.ingest(fix(20, 2000)); // older
    expect(e.distance).toBe(d);
  });

  test('I2 a fix from before the resume is ignored', () => {
    const e = started();
    e.ingest(fix(0, 1000));
    e.pause(T0 + 5000);
    e.resume(T0 + 60_000);
    e.ingest(fix(300, 30_000));
    expect(e.distance).toBe(0);
    expect(e.segments[e.segments.length - 1]).toHaveLength(0);
  });

  test('I3 a late batch is processed oldest first', () => {
    const e = started();
    e.ingestBatch([fix(12, 4000), fix(0, 1000), fix(8, 3000), fix(4, 2000)]);
    expect(e.distance).toBeCloseTo(12, 0);
    expect(e.segments[0]).toHaveLength(4);
  });

  test('I4 hydrate restores a saved run and does not wipe it', () => {
    const a = started();
    for (let i = 0; i <= 20; i++) a.ingest(fix(i * 4, 1000 + i * 1000));
    const saved = a.toRun(T0 + 21_000);
    const b = new RunEngine();
    b.hydrate(saved);
    expect(b.state).toBe('paused');
    expect(b.distance).toBeCloseTo(saved.distance, 5);
    expect(b.segments).toEqual(saved.segments);
    expect(b.toRun(T0 + 99_000).elapsed).toBe(saved.elapsed);
    expect(b.toRun(T0 + 99_000).id).toBe('r1');
  });
});

describe('RunEngine scenario', () => {
  test('1.2 km at 4 m/s gives one split, ~1200 m and ~300 s', () => {
    const e = started();
    const splits = [];
    for (let i = 0; i <= 300; i++) {
      const s = e.ingest(fix(i * 4, 1000 + i * 1000));
      if (s) splits.push(s);
    }
    expect(e.distance).toBeGreaterThan(1190);
    expect(e.distance).toBeLessThan(1210);
    expect(splits).toHaveLength(1);
    expect(splits[0].km).toBe(1);
    expect(splits[0].ms).toBeGreaterThan(245_000);
    expect(splits[0].ms).toBeLessThan(255_000);
    expect(e.segments).toHaveLength(1);
  });

  test('a locked-screen batch arriving late has no straight-line gap', () => {
    const e = started();
    for (let i = 0; i <= 10; i++) e.ingest(fix(i * 4, 1000 + i * 1000));
    // phone locked: 60 s of fixes arrive together afterwards
    const late: Fix[] = [];
    for (let i = 11; i <= 70; i++) late.push(fix(i * 4, 1000 + i * 1000));
    e.ingestBatch(late);
    expect(e.segments).toHaveLength(1);
    expect(e.distance).toBeCloseTo(280, -1);
  });
});

describe('StepGate', () => {
  test('drops the phantom first step and short fidgets', () => {
    const g = new StepGate();
    expect(g.add(1, T0)).toBe(0);
    for (let i = 1; i <= 5; i++) expect(g.add(1, T0 + 20_000 + i * 500)).toBe(0);
    // a long pause: the fidget never turns into a walk
    for (let i = 1; i <= 5; i++) expect(g.add(1, T0 + 60_000 + i * 500)).toBe(0);
  });

  test('a sustained walk counts in full, backlog included', () => {
    const g = new StepGate();
    let total = 0;
    for (let i = 0; i < 30; i++) total += g.add(1, T0 + i * 500);
    expect(total).toBe(30);
  });

  test('a late batch from the sensor counts straight away', () => {
    expect(new StepGate().add(18, T0)).toBe(18);
  });

  test('stopping ends the bout, so standing still needs a new walk to count', () => {
    const g = new StepGate();
    for (let i = 0; i < 12; i++) g.add(1, T0 + i * 500);
    expect(g.add(1, T0 + 60_000)).toBe(0);
  });

  test('zero and negative deltas are ignored', () => {
    const g = new StepGate();
    expect(g.add(0, T0)).toBe(0);
    expect(g.add(-3, T0)).toBe(0);
  });
});
