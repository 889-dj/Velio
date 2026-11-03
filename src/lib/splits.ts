import type { Run } from './storage';

export type Split = { km: number; ms: number };
/** `unitM` is the length of each split in metres; a list is only comparable to others with the same unitM. */
export type SplitList = { splits: Split[]; unitM: number };

/**
 * Splits of `unitM` metres from the GPS track [movingMs, cumulativeM, alt]. Time at each boundary is
 * interpolated between the two fixes either side of it.
 */
export function splitsFromTrack(track: [number, number, number | null][], unitM: number): Split[] {
  const out: Split[] = [];
  let mark = 0;
  let n = 1;
  let next = unitM;
  for (let i = 1; i < track.length; i++) {
    const [t0, d0] = track[i - 1];
    const [t1, d1] = track[i];
    while (d1 > d0 && d1 >= next) {
      const t = t0 + ((next - d0) / (d1 - d0)) * (t1 - t0);
      out.push({ km: n, ms: Math.round(t - mark) });
      mark = t;
      n++;
      next = n * unitM;
    }
  }
  return out;
}

/**
 * A run's splits in the requested unit. A run recorded in the other unit is re-derived from its track;
 * if it has none (very old runs) its own splits are returned with their own `unitM`, never mislabelled.
 */
export function splitsOf(run: Run, unitM: number): SplitList {
  const own = run.splitM ?? 1000;
  if (own === unitM) return { splits: run.splits, unitM };
  if (run.track && run.track.length > 1) return { splits: splitsFromTrack(run.track, unitM), unitM };
  return { splits: run.splits, unitM: own };
}
