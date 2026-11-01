import { Coord, haversine } from './geo';
import type { Run, Sport } from './storage';

// Thresholds from the research notes in design/DIRECTION.md.
export const MAX_ACCURACY_M = 20; // drop fixes worse than this
export const MAX_SPEED_MS = 12; // GPS-jump guard (~43 km/h)
export const MIN_STEP_M = 3; // ignore standstill jitter
export const GAP_MS = 15000; // a longer hole starts a new line segment, never a straight line across it
export const PACE_WINDOW_MS = 6000;
export const DEFAULT_STRIDE_M = 0.75;

export type Fix = { latitude: number; longitude: number; accuracy: number | null; altitude: number | null; timestamp: number };
export type Split = { km: number; ms: number };
export type EngineState = 'idle' | 'running' | 'paused' | 'finished';

/**
 * The run maths with no React, GPS or timers in it. Fixes arrive from the foreground watcher or the
 * background task (possibly in batches, possibly late), so every clock reading comes from the fix's own
 * timestamp. Rules:
 *  P1 accuracy worse than 20 m is dropped        P2 first fix of a segment only starts it
 *  P3 a >15 s hole starts a new segment          P4 steps <3 m or >12 m/s are dropped
 *  P5 accepted steps add to distance             P6 each full km records a split
 *  P7 current pace uses a 6 s rolling window     P8 stride calibrates from GPS once 100 steps / 100 m are in
 *  P9 steps fill distance while GPS is lost (addSteps)
 *  I1 a fix not newer than the last one is ignored (duplicates, out-of-order)
 *  I2 a fix older than the last start/resume is ignored
 *  I3 ingestBatch sorts by timestamp first      I4 hydrate() restores a saved run without wiping it
 */
export class RunEngine {
  state: EngineState = 'idle';
  sport: Sport = 'run';
  id = '';
  startedAt = 0;
  segments: Coord[][] = [];
  splits: Split[] = [];
  track: [number, number, number | null][] = [];
  cadence: [number, number][] = [];
  gpsDistance = 0;
  fallbackDistance = 0;
  steps = 0;
  stride = DEFAULT_STRIDE_M;
  currentPace: number | null = null;
  lastAccepted: { c: Coord; t: number } | null = null;
  lastFixAt = 0; // wall time of last accepted fix (for GPS-lost checks)

  private accMs = 0;
  private resumedAt = 0;
  private lastT = 0; // newest fix timestamp seen (I1)
  private trail: { t: number; d: number }[] = [];
  private splitsDone = 0;
  private splitMark = 0;

  get distance() {
    return this.gpsDistance + this.fallbackDistance;
  }

  elapsed(now: number) {
    return this.accMs + (this.state === 'running' ? Math.max(0, now - this.resumedAt) : 0);
  }

  start(now: number, sport: Sport = 'run', id = `${now}`) {
    Object.assign(this, new RunEngine());
    this.sport = sport;
    this.id = id;
    this.startedAt = now;
    this.resume(now);
  }

  /** Begins (or continues after a pause) a segment; the gap between pause and resume is never counted. */
  resume(now: number) {
    if (this.state === 'running') return;
    this.state = 'running';
    this.resumedAt = now;
    this.lastT = Math.max(this.lastT, 0);
    this.lastAccepted = null;
    this.lastFixAt = now;
    this.trail = [];
    this.currentPace = null;
    this.segments = [...this.segments, []];
  }

  pause(now: number) {
    if (this.state !== 'running') return;
    this.accMs = this.elapsed(now);
    this.state = 'paused';
    this.currentPace = null;
  }

  finish(now: number) {
    if (this.state === 'running') this.pause(now);
    this.state = 'finished';
  }

  /** Returns the new split when this fix completed a kilometre. */
  ingest(f: Fix): Split | null {
    if (this.state !== 'running') return null;
    if (f.timestamp <= this.lastT) return null; // I1
    if (f.timestamp < this.resumedAt) return null; // I2
    this.lastT = f.timestamp;
    if (f.accuracy != null && f.accuracy > MAX_ACCURACY_M) return null; // P1

    const c: Coord = { latitude: f.latitude, longitude: f.longitude };
    const t = f.timestamp;
    const prev = this.lastAccepted;
    this.lastFixAt = Math.max(this.lastFixAt, t);

    if (!prev || t - prev.t > GAP_MS) {
      // P2 / P3
      this.lastAccepted = { c, t };
      this.trail = [];
      this.push(t, f.altitude);
      const segs = this.segments.slice();
      if (!prev) segs[segs.length - 1] = [c];
      else segs.push([c]);
      this.segments = segs;
      return null;
    }

    const d = haversine(prev.c, c);
    const dt = Math.max((t - prev.t) / 1000, 0.001);
    if (d < MIN_STEP_M || d / dt > MAX_SPEED_MS) return null; // P4

    this.gpsDistance += d; // P5
    this.lastAccepted = { c, t };
    const split = this.checkSplit(t);
    this.push(t, f.altitude);

    this.trail.push({ t, d: this.gpsDistance }); // P7
    while (this.trail.length > 1 && t - this.trail[0].t > PACE_WINDOW_MS) this.trail.shift();
    const first = this.trail[0];
    const dd = this.gpsDistance - first.d;
    if (dd > 3) {
      const raw = (t - first.t) / 1000 / (dd / 1000);
      this.currentPace = this.currentPace == null ? raw : this.currentPace * 0.5 + raw * 0.5;
    }

    if (this.steps > 100 && this.gpsDistance > 100) this.stride = this.gpsDistance / this.steps; // P8

    const segs = this.segments.slice();
    segs[segs.length - 1] = [...segs[segs.length - 1], c];
    this.segments = segs;
    return split;
  }

  /** I3: late background batches arrive together; process them oldest first. */
  ingestBatch(fixes: Fix[]): Split[] {
    return [...fixes]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((f) => this.ingest(f))
      .filter((s): s is Split => s != null);
  }

  /** P9: pedometer delta while the GPS has been silent. */
  addSteps(total: number, delta: number, gpsLost: boolean): Split | null {
    this.steps = total;
    if (gpsLost && delta > 0) {
      this.fallbackDistance += delta * this.stride;
      return this.checkSplit(Date.now());
    }
    return null;
  }

  /** I4: pick up a saved in-progress run. Comes back paused so the user decides when to continue. */
  hydrate(run: Run) {
    Object.assign(this, new RunEngine());
    this.id = run.id;
    this.sport = run.sport;
    this.startedAt = run.startedAt;
    this.gpsDistance = run.distance;
    this.steps = run.steps;
    this.segments = run.segments.map((s) => s.slice());
    this.splits = run.splits.slice();
    this.track = (run.track ?? []).slice();
    this.cadence = (run.cadence ?? []).slice();
    this.accMs = run.elapsed;
    this.splitsDone = run.splits.length;
    this.splitMark = run.splits.reduce((a, s) => a + s.ms, 0);
    this.state = 'paused';
  }

  toRun(now: number): Run {
    return {
      id: this.id,
      sport: this.sport,
      startedAt: this.startedAt,
      endedAt: now,
      distance: this.distance,
      elapsed: this.elapsed(now),
      steps: this.steps,
      segments: this.segments,
      splits: this.splits,
      track: this.track,
      cadence: this.cadence,
    };
  }

  private push(t: number, alt: number | null) {
    this.track.push([Math.round(this.elapsed(t)), +this.distance.toFixed(1), alt == null ? null : +alt.toFixed(1)]);
  }

  private checkSplit(at: number): Split | null {
    const km = Math.floor(this.distance / 1000);
    if (km <= this.splitsDone) return null;
    const now = this.elapsed(at);
    const split = { km, ms: now - this.splitMark };
    this.splitMark = now;
    this.splitsDone = km;
    this.splits = [...this.splits, split];
    return split;
  }
}
