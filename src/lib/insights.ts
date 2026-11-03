import type { Run } from './storage';
import { formatPace } from './geo';
import { splitsOf } from './splits';
import { paceToUnit, unitLabel, unitMeters } from './units';

export type Pt = { x: number; y: number }; // x = km into the run

// Thresholds. Sourced values are noted; "mine" means a judgement call, shown in the UI as an estimate.
const EVEN_SPLIT_PCT = 2; // even pacing = within ~2% (coaching literature, secondary source)
const ELEV_DEADBAND_M = 3; // hysteresis for gain; Strava reportedly uses ~10 m GPS-only (mine: 3 on smoothed data)
const ELEV_SMOOTH_WINDOW = 2; // +/-2 samples (mine)
const PACE_WINDOW_M = 100; // pace chart window (mine)
const SUSPICIOUS_CLIMB_M_PER_KM = 50; // mine: flag implausible gain
const KCAL_PER_KG_KM_RUN = 1.0; // net rule of thumb (Margaria), +/-10-25%
const KCAL_PER_KG_KM_WALK = 0.5; // mine, rule of thumb

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

export const avgPaceOf = (r: Run) => (r.distance > 20 ? r.elapsed / 1000 / (r.distance / 1000) : null);

function bucket(pts: Pt[], n: number): Pt[] {
  if (pts.length <= n) return pts;
  const size = pts.length / n;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * size);
    const e = Math.max(s + 1, Math.floor((i + 1) * size));
    const sl = pts.slice(s, e);
    out.push({ x: mean(sl.map((p) => p.x)), y: mean(sl.map((p) => p.y)) });
  }
  return out;
}

/** Pace (sec/km) along the run, from a rolling ~100 m window. */
export function paceSeries(run: Run): Pt[] {
  const tr = run.track;
  if (!tr || tr.length < 6) return [];
  const raw: Pt[] = [];
  let j = 0;
  for (let i = 1; i < tr.length; i++) {
    while (j + 1 < i && tr[i][1] - tr[j + 1][1] >= PACE_WINDOW_M) j++;
    const dd = tr[i][1] - tr[j][1];
    if (dd < PACE_WINDOW_M) continue;
    const pace = (tr[i][0] - tr[j][0]) / 1000 / (dd / 1000);
    if (pace < 150 || pace > 1200) continue; // 2:30 - 20:00 per km
    raw.push({ x: tr[i][1] / 1000, y: pace });
  }
  return bucket(raw, 80);
}

export type Elevation = {
  series: Pt[];
  gain: number;
  loss: number;
  min: number;
  max: number;
  suspicious: boolean;
  at: (distM: number) => number;
  /** Filtered climb (metres) between two distances. */
  gainIn: (d0: number, d1: number) => number;
};

export function elevationOf(run: Run): Elevation | null {
  const tr = run.track;
  if (!tr || tr.length < 8) return null;
  const pts = tr.filter((t) => t[2] != null) as [number, number, number][];
  if (pts.length < 8 || pts.length < tr.length * 0.7) return null;

  const alt = pts.map((p) => p[2]);
  const dist = pts.map((p) => p[1]);
  const sm = alt.map((_, i) => {
    const a = Math.max(0, i - ELEV_SMOOTH_WINDOW);
    const b = Math.min(alt.length - 1, i + ELEV_SMOOTH_WINDOW);
    return mean(alt.slice(a, b + 1));
  });

  let ref = sm[0];
  let gain = 0;
  let loss = 0;
  for (const v of sm) {
    if (v - ref >= ELEV_DEADBAND_M) {
      gain += v - ref;
      ref = v;
    } else if (ref - v >= ELEV_DEADBAND_M) {
      loss += ref - v;
      ref = v;
    }
  }

  const at = (d: number) => {
    if (d <= dist[0]) return sm[0];
    if (d >= dist[dist.length - 1]) return sm[sm.length - 1];
    let i = 1;
    while (dist[i] < d) i++;
    const t = (d - dist[i - 1]) / Math.max(dist[i] - dist[i - 1], 1e-6);
    return sm[i - 1] + (sm[i] - sm[i - 1]) * t;
  };

  const gainIn = (d0: number, d1: number) => {
    let ref = at(d0);
    let g = 0;
    for (let d = d0 + 20; d <= d1 + 20; d += 20) {
      const v = at(Math.min(d, d1));
      if (v - ref >= ELEV_DEADBAND_M) {
        g += v - ref;
        ref = v;
      } else if (ref - v >= ELEV_DEADBAND_M) {
        ref = v;
      }
    }
    return g;
  };

  const km = Math.max(run.distance / 1000, 0.1);
  return {
    series: bucket(pts.map((_, i) => ({ x: dist[i] / 1000, y: sm[i] })), 80),
    gain,
    loss,
    min: Math.min(...sm),
    max: Math.max(...sm),
    suspicious: gain / km > SUSPICIOUS_CLIMB_M_PER_KM,
    at,
    gainIn,
  };
}

export type SplitRow = {
  km: number; // 1, 2, 3 ... (partial last row keeps the next integer); counts display units, not always km
  unitM: number; // metres in one full row: 1000 or 1609.344
  dist: number; // metres covered in this row
  ms: number;
  pace: number; // sec/km
  partial: boolean;
  climb: number | null; // filtered climb in metres within this km, null without altitude
  delta: number; // sec/km vs the run's average pace (negative = faster)
};

export function splitRows(run: Run, elev: Elevation | null, unitM = unitMeters()): SplitRow[] {
  const avg = avgPaceOf(run);
  if (avg == null) return [];
  const list = splitsOf(run, unitM);
  const u = list.unitM;
  const rows: SplitRow[] = list.splits.map((s, i) => {
    const pace = s.ms / u; // ms per metre = seconds per km
    return {
      km: s.km,
      unitM: u,
      dist: u,
      ms: s.ms,
      pace,
      partial: false,
      climb: elev ? elev.gainIn(i * u, (i + 1) * u) : null,
      delta: pace - avg,
    };
  });
  const done = rows.length * u;
  const rem = run.distance - done;
  if (rem >= 100) {
    const ms = run.elapsed - list.splits.reduce((a, s) => a + s.ms, 0);
    if (ms > 0) {
      const pace = ms / rem;
      rows.push({
        km: rows.length + 1,
        unitM: u,
        dist: rem,
        ms,
        pace,
        partial: true,
        climb: elev ? elev.gainIn(done, run.distance) : null,
        delta: pace - avg,
      });
    }
  }
  return rows;
}

export type Verdict = { kind: 'negative' | 'even' | 'positive'; pct: number } | null;
export function splitVerdict(rows: SplitRow[]): Verdict {
  const full = rows.filter((r) => !r.partial);
  if (full.length < 2) return null;
  const half = Math.floor(full.length / 2);
  const first = mean(full.slice(0, half).map((r) => r.pace));
  const second = mean(full.slice(full.length - half).map((r) => r.pace));
  const pct = ((second - first) / first) * 100;
  return { kind: pct <= -EVEN_SPLIT_PCT ? 'negative' : pct >= EVEN_SPLIT_PCT ? 'positive' : 'even', pct };
}

/** Coefficient of variation of per-km pace, in percent. Needs >= 3 full km. */
export function variability(rows: SplitRow[]): { cv: number; word: 'Steady' | 'Moderate' | 'Variable' } | null {
  const full = rows.filter((r) => !r.partial).map((r) => r.pace);
  if (full.length < 3) return null;
  const cv = (sd(full) / mean(full)) * 100;
  return { cv, word: cv < 3 ? 'Steady' : cv < 6 ? 'Moderate' : 'Variable' }; // word cut-offs are mine
}

export type CadenceInfo = { series: Pt[]; avg: number; trend: 'up' | 'down' | 'steady' | null; late: number | null };
export function cadenceOf(run: Run): CadenceInfo | null {
  const c = run.cadence;
  const tr = run.track;
  const fallbackAvg = run.steps > 50 && run.elapsed > 30000 ? Math.round(run.steps / (run.elapsed / 60000)) : null;
  if (!c || c.length < 3) return fallbackAvg ? { series: [], avg: fallbackAvg, trend: null, late: null } : null;

  const distAt = (e: number) => {
    if (!tr || tr.length < 2) return (run.distance * (e / Math.max(run.elapsed, 1))) / 1000;
    let i = 0;
    while (i < tr.length - 1 && tr[i][0] < e) i++;
    return tr[i][1] / 1000;
  };
  const raw = c.map(([e, spm]) => ({ x: distAt(e), y: spm }));
  const avg = Math.round(mean(c.map((v) => v[1])));
  const third = Math.max(1, Math.floor(c.length / 3));
  const early = mean(c.slice(0, third).map((v) => v[1]));
  const late = mean(c.slice(-third).map((v) => v[1]));
  const diff = late - early;
  return {
    series: bucket(raw, 60),
    avg,
    trend: c.length >= 6 ? (diff >= 4 ? 'up' : diff <= -4 ? 'down' : 'steady') : null,
    late: Math.round(late),
  };
}

export const strideOf = (run: Run) => (run.steps > 50 ? run.distance / run.steps : null);

export const caloriesOf = (run: Run, weightKg: number) =>
  Math.round(weightKg * (run.distance / 1000) * (run.sport === 'walk' ? KCAL_PER_KG_KM_WALK : KCAL_PER_KG_KM_RUN));

export type Similar = { count: number; deltaSec: number } | null;
export function compareSimilar(run: Run, others: Run[]): Similar {
  const pace = avgPaceOf(run);
  if (pace == null) return null;
  const sim = others
    .filter((o) => o.id !== run.id && o.sport === run.sport && o.distance > 0 && Math.abs(o.distance - run.distance) / run.distance <= 0.4)
    .slice(0, 5);
  const paces = sim.map(avgPaceOf).filter((p): p is number => p != null);
  if (paces.length < 2) return null;
  return { count: paces.length, deltaSec: pace - mean(paces) };
}

export function recordsOf(run: Run, rows: SplitRow[], others: Run[]): string[] {
  const prior = others.filter((o) => o.id !== run.id);
  const out: string[] = [];
  const full = rows.filter((r) => !r.partial);
  if (full.length) {
    const best = Math.min(...full.map((r) => r.ms));
    const u = full[0].unitM;
    // only splits of the same length are comparable
    const prev = prior.flatMap((o) => {
      const l = splitsOf(o, u);
      return l.unitM === u ? l.splits.map((s) => s.ms) : [];
    });
    if (prev.length && best < Math.min(...prev)) out.push(`Fastest ${unitLabel()}`);
  }
  if (prior.length && run.distance > Math.max(...prior.map((o) => o.distance))) out.push('Longest run');
  if (!prior.length) out.push('First activity');
  return out;
}

export type Insight = { icon: 'trending-up' | 'flash' | 'trending-down' | 'pulse' | 'people' | 'speedometer'; tone: 'good' | 'warn' | 'info'; text: string };

/** A pace difference (given in seconds per km) as whole seconds per display unit. */
const secs = (n: number) => `${Math.round(Math.abs(paceToUnit(n)))} s`;
const rowName = (r: SplitRow) => `${r.unitM === 1000 ? 'Km' : 'Mi'} ${r.km}`;

export function insightsOf(args: {
  rows: SplitRow[];
  verdict: Verdict;
  cadence: CadenceInfo | null;
  similar: Similar;
  elev: Elevation | null;
}): Insight[] {
  const { rows, verdict, cadence, similar, elev } = args;
  const out: Insight[] = [];
  const full = rows.filter((r) => !r.partial);

  if (verdict) {
    const p = Math.abs(verdict.pct).toFixed(1);
    out.push(
      verdict.kind === 'negative'
        ? { icon: 'trending-up', tone: 'good', text: `Negative split: your second half was ${p}% faster than the first.` }
        : verdict.kind === 'positive'
          ? { icon: 'trending-down', tone: 'warn', text: `You started fast: the second half was ${p}% slower. Easing the first ${unitLabel()} usually helps.` }
          : { icon: 'pulse', tone: 'good', text: `Even pacing: both halves within ${EVEN_SPLIT_PCT}% of each other.` },
    );
  }

  if (full.length >= 2) {
    const fast = full.reduce((a, b) => (b.pace < a.pace ? b : a));
    const slow = full.reduce((a, b) => (b.pace > a.pace ? b : a));
    out.push({ icon: 'flash', tone: 'good', text: `${rowName(fast)} was your fastest at ${formatPace(fast.pace)}/${unitLabel()}, ${secs(fast.delta)} quicker than your average.` });
    if (slow.km !== fast.km && slow.delta > 5) {
      const hill = slow.climb != null && slow.climb >= 8;
      out.push({
        icon: 'trending-down',
        tone: 'warn',
        text: hill
          ? `${rowName(slow)} was slowest (+${Math.round(slow.climb as number)} m climb). Hills explain most of that drop.`
          : `${rowName(slow)} was slowest at ${formatPace(slow.pace)}/${unitLabel()}, ${secs(slow.delta)} off your average.`,
      });
    }
  }

  if (cadence?.trend) {
    out.push({
      icon: 'pulse',
      tone: 'info',
      text:
        cadence.trend === 'steady'
          ? `Cadence held steady around ${cadence.avg} steps/min.`
          : `Cadence ${cadence.trend === 'up' ? 'climbed' : 'dropped'} to about ${cadence.late} steps/min late in the run (average ${cadence.avg}).`,
    });
  }

  if (similar) {
    const faster = similar.deltaSec < -2;
    const slower = similar.deltaSec > 2;
    out.push({
      icon: 'people',
      tone: faster ? 'good' : 'info',
      text: faster
        ? `${secs(similar.deltaSec)}/${unitLabel()} faster than your last ${similar.count} similar runs.`
        : slower
          ? `${secs(similar.deltaSec)}/${unitLabel()} slower than your last ${similar.count} similar runs.`
          : `In line with your last ${similar.count} similar runs.`,
    });
  }

  if (elev && elev.suspicious) {
    out.push({ icon: 'speedometer', tone: 'warn', text: 'Phone altitude looks noisy on this run, so treat the climb numbers with caution.' });
  }

  return out.slice(0, 5);
}
