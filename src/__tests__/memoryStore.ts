import type { Run, RunStore } from '../lib/storage';

/** In-memory stand-in for the per-run file store. `failWrites` simulates a full disk. */
export function memoryStore(): RunStore & { files: Map<string, Run>; failWrites: boolean } {
  const files = new Map<string, Run>();
  const self = {
    files,
    failWrites: false,
    async readAll() {
      return [...files.values()].map((r) => JSON.parse(JSON.stringify(r)) as Run);
    },
    async write(run: Run) {
      if (self.failWrites) throw new Error('disk full');
      files.set(run.id, JSON.parse(JSON.stringify(run)) as Run);
    },
    async remove(id: string) {
      files.delete(id);
    },
    async clear() {
      files.clear();
    },
  };
  return self;
}
