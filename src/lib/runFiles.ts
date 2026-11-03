import { Directory, File, Paths } from 'expo-file-system';
import type { Run } from './storage';

/**
 * One JSON file per run in the app's document directory. Unlike a single AsyncStorage list this has no
 * size ceiling (Android's AsyncStorage is capped at about 6 MB in total and ~2 MB per row), and saving a
 * run only writes that run instead of rewriting every run ever recorded.
 */
const SAFE = /[^a-zA-Z0-9_-]/g;
const nameOf = (id: string) => `${id.replace(SAFE, '_')}.json`;

function runsDir() {
  const d = new Directory(Paths.document, 'runs');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export const fileRunStore = {
  async readAll(): Promise<Run[]> {
    const files = runsDir()
      .list()
      .filter((f): f is File => f instanceof File && f.name.endsWith('.json'));
    const runs = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(await f.text()) as Run;
        } catch {
          return null; // one damaged file must never hide the rest of the history
        }
      }),
    );
    return runs.filter((r): r is Run => !!r && typeof r.id === 'string');
  },

  async write(run: Run): Promise<void> {
    new File(runsDir(), nameOf(run.id)).write(JSON.stringify(run));
  },

  async remove(id: string): Promise<void> {
    const f = new File(runsDir(), nameOf(id));
    if (f.exists) f.delete();
  },

  async clear(): Promise<void> {
    const d = runsDir();
    for (const f of d.list()) f.delete();
  },
};
