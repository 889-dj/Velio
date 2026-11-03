import AsyncStorage from '@react-native-async-storage/async-storage';
import { ImportError, MAX_FILE_BYTES, importRuns, planImport } from '../lib/backup';
import { LEGACY_RUNS_KEY, Run, loadRuns, saveRun, setRunStore } from '../lib/storage';
import { memoryStore } from './memoryStore';

const run = (id: string, over: Partial<Run> = {}): Run => ({
  id,
  sport: 'run',
  startedAt: 1_700_000_000_000 + Number(id.replace(/\D/g, '') || 0),
  endedAt: 1_700_000_900_000,
  distance: 5000,
  elapsed: 1_500_000,
  steps: 6000,
  segments: [[{ latitude: 51, longitude: 0 }, { latitude: 51.001, longitude: 0 }]],
  splits: [{ km: 1, ms: 300_000 }],
  ...over,
});
const file = (runs: unknown[], app = 'velio') => JSON.stringify({ app, exportedAt: 'x', runs });

let mem: ReturnType<typeof memoryStore>;
beforeEach(async () => {
  await AsyncStorage.clear();
  mem = memoryStore();
  setRunStore(mem);
});

const stored = () => loadRuns();

describe('importRuns', () => {
  test('malformed JSON is rejected', async () => {
    await expect(importRuns('{nope')).rejects.toBeInstanceOf(ImportError);
  });

  test('wrong app tag is rejected', async () => {
    await expect(importRuns(file([run('1')], 'other-app'))).rejects.toThrow(/isn’t a Velio backup/);
    expect(await stored()).toEqual([]);
  });

  test('legacy "strava-clone" tag is accepted', async () => {
    const r = await importRuns(file([run('1')], 'strava-clone'));
    expect(r).toEqual({ imported: 1, skipped: 0 });
  });

  test('a file over 64 MB is rejected', async () => {
    expect(() => planImport('x'.repeat(MAX_FILE_BYTES + 1), [])).toThrow(/64 MB/);
  });

  test('there is no total size cap: many large runs all import', async () => {
    const big = (id: string) => run(id, { segments: [Array.from({ length: 26_000 }, (_, i) => ({ latitude: 51 + i * 1e-5, longitude: i * 1e-5 }))] });
    await saveRun(big('1'));
    await saveRun(big('2'));
    expect(await importRuns(file([big('3'), big('4'), big('5')]))).toEqual({ imported: 3, skipped: 0 });
    expect(await stored()).toHaveLength(5);
  });

  test('one invalid run imports nothing', async () => {
    const bad = { ...run('2'), distance: 'far' };
    await expect(importRuns(file([run('1'), bad, run('3')]))).rejects.toThrow(/Run 2/);
    expect(await stored()).toEqual([]);
  });

  test('a duplicate id is skipped and the phone’s copy wins', async () => {
    await saveRun(run('1', { distance: 111 }));
    const r = await importRuns(file([run('1', { distance: 9999 }), run('2')]));
    expect(r).toEqual({ imported: 1, skipped: 1 });
    const s = await stored();
    expect(s.find((x) => x.id === '1')?.distance).toBe(111);
    expect(s).toHaveLength(2);
  });

  test('restoring the same file twice changes nothing the second time', async () => {
    const f = file([run('1'), run('2')]);
    expect(await importRuns(f)).toEqual({ imported: 2, skipped: 0 });
    const after = JSON.stringify(await stored());
    expect(await importRuns(f)).toEqual({ imported: 0, skipped: 2 });
    expect(JSON.stringify(await stored())).toBe(after);
  });

  test('an empty runs list is fine', async () => {
    expect(await importRuns(file([]))).toEqual({ imported: 0, skipped: 0 });
  });

  test('a new id is added alongside existing runs', async () => {
    await saveRun(run('1'));
    expect(await importRuns(file([run('2')]))).toEqual({ imported: 1, skipped: 0 });
    expect(await stored()).toHaveLength(2);
  });

  test('a failed write leaves the runs already saved intact', async () => {
    await saveRun(run('1'));
    mem.failWrites = true;
    await expect(importRuns(file([run('2')]))).rejects.toThrow();
    mem.failWrites = false;
    expect((await stored()).map((r) => r.id)).toEqual(['1']);
  });
});

describe('moving the old single list into per-run files', () => {
  test('every legacy run is migrated and the old key is removed', async () => {
    await AsyncStorage.setItem(LEGACY_RUNS_KEY, JSON.stringify([run('1'), run('2')]));
    setRunStore(mem); // fresh process: migration has not run yet
    expect((await stored()).map((r) => r.id).sort()).toEqual(['1', '2']);
    expect([...mem.files.keys()].sort()).toEqual(['1', '2']);
    expect(await AsyncStorage.getItem(LEGACY_RUNS_KEY)).toBeNull();
  });

  test('if the files cannot be written the old list is kept and still shown', async () => {
    await AsyncStorage.setItem(LEGACY_RUNS_KEY, JSON.stringify([run('1')]));
    mem.failWrites = true;
    setRunStore(mem);
    expect((await stored()).map((r) => r.id)).toEqual(['1']);
    expect(await AsyncStorage.getItem(LEGACY_RUNS_KEY)).not.toBeNull();
  });

  test('migrating twice never duplicates a run', async () => {
    await AsyncStorage.setItem(LEGACY_RUNS_KEY, JSON.stringify([run('1')]));
    setRunStore(mem);
    await stored();
    await AsyncStorage.setItem(LEGACY_RUNS_KEY, JSON.stringify([run('1')]));
    setRunStore(mem);
    expect(await stored()).toHaveLength(1);
  });
});
