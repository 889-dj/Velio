import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { Coord, haversine } from '../lib/geo';
import { Run, Sport, saveActive } from '../lib/storage';

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';
export type Permission = 'unknown' | 'granted' | 'denied';
export type Gps = 'searching' | 'good' | 'weak' | 'lost';

// Thresholds from the research notes in design/DIRECTION.md. Starred ones are my own picks.
const MAX_ACCURACY_M = 20; // drop fixes worse than this
const GOOD_ACCURACY_M = 10;
const MAX_SPEED_MS = 12; // GPS-jump guard (~43 km/h)
const MIN_STEP_M = 3; // ignore standstill jitter
const GPS_LOST_MS = 6000; // no fix for this long = signal lost
const GAP_MS = 15000; // a longer hole starts a new line segment, never a straight line across it
const PACE_WINDOW_MS = 6000; // * short rolling window; 30-60s was reported as too slow
const AUTOSAVE_MS = 5000;
const DEFAULT_STRIDE_M = 0.75;

/**
 * Tracks a run. GPS draws the route and measures distance; the pedometer gives steps/cadence and keeps
 * distance moving (via a GPS-calibrated stride) while the GPS signal is lost. State is checkpointed to
 * local storage every few seconds so a crash can be recovered.
 */
export function useRunTracker() {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [permission, setPermission] = useState<Permission>('unknown');
  const [initial, setInitial] = useState<Coord | null>(null);
  const [segments, setSegments] = useState<Coord[][]>([]);
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [steps, setSteps] = useState(0);
  const [cadence, setCadence] = useState(0);
  const [currentPace, setCurrentPace] = useState<number | null>(null);
  const [pedometerOk, setPedometerOk] = useState(false);
  const [splits, setSplits] = useState<{ km: number; ms: number }[]>([]);
  const [gps, setGps] = useState<Gps>('searching');
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const locSub = useRef<Location.LocationSubscription | null>(null);
  const pedoSub = useRef<{ remove: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const saver = useRef<ReturnType<typeof setInterval> | null>(null);

  const statusRef = useRef<RunStatus>('idle');
  const sportRef = useRef<Sport>('run');
  const runId = useRef('');
  const startedAt = useRef(0);
  const lastPoint = useRef<{ c: Coord; t: number } | null>(null);
  const lastFixAt = useRef(0); // last accepted fix
  const lastAnyFixAt = useRef(0); // last fix of any quality
  const lastAcc = useRef<number | null>(null);
  const gpsDistance = useRef(0);
  const fallbackDistance = useRef(0);
  const stepBase = useRef(0);
  const stepsRef = useRef(0);
  const lastWatchSteps = useRef(0);
  const stride = useRef(DEFAULT_STRIDE_M);
  const accMs = useRef(0);
  const resumedAt = useRef(0);
  const trail = useRef<{ t: number; d: number }[]>([]);
  const stepTrail = useRef<{ t: number; s: number }[]>([]);
  const splitsDone = useRef(0);
  const splitMark = useRef(0);
  const segmentsRef = useRef<Coord[][]>([]);
  const splitsRef = useRef<{ km: number; ms: number }[]>([]);
  const paceRef = useRef<number | null>(null);
  const trackRef = useRef<[number, number, number | null][]>([]);
  const cadenceRef = useRef<[number, number][]>([]);
  const lastCadenceAt = useRef(0);
  /** Screens set this to react to a completed km (toast, haptic) without an effect. */
  const onSplit = useRef<((s: { km: number; ms: number }) => void) | null>(null);
  const setOnSplit = useCallback((fn: ((s: { km: number; ms: number }) => void) | null) => {
    onSplit.current = fn;
  }, []);

  const setStat = (s: RunStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    splitsRef.current = splits;
  }, [splits]);

  // permission + first fix so the map can centre before the run starts
  useEffect(() => {
    let alive = true;
    (async () => {
      const { status: st } = await Location.requestForegroundPermissionsAsync();
      if (!alive) return;
      if (st !== 'granted') return setPermission('denied');
      setPermission('granted');
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (!alive) return;
        setInitial({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        lastAcc.current = pos.coords.accuracy;
        lastAnyFixAt.current = Date.now();
        setAccuracy(pos.coords.accuracy);
        setGps(pos.coords.accuracy != null && pos.coords.accuracy <= GOOD_ACCURACY_M ? 'good' : 'weak');
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const elapsedNow = () =>
    accMs.current + (statusRef.current === 'running' ? Date.now() - resumedAt.current : 0);

  const buildRun = useCallback(
    (): Run => ({
      id: runId.current,
      sport: sportRef.current,
      startedAt: startedAt.current,
      endedAt: Date.now(),
      distance: gpsDistance.current + fallbackDistance.current,
      elapsed: elapsedNow(),
      steps: stepsRef.current,
      segments: segmentsRef.current,
      splits: splitsRef.current,
      track: trackRef.current,
      cadence: cadenceRef.current,
    }),
    [],
  );

  const checkpoint = useCallback(() => {
    if (!runId.current) return;
    saveActive(buildRun());
  }, [buildRun]);

  const publishDistance = useCallback(() => {
    const d = gpsDistance.current + fallbackDistance.current;
    setDistance(d);
    const km = Math.floor(d / 1000);
    if (km > splitsDone.current) {
      const now = elapsedNow();
      const ms = now - splitMark.current;
      splitMark.current = now;
      splitsDone.current = km;
      setSplits((s) => [...s, { km, ms }]);
      onSplit.current?.({ km, ms });
    }
  }, []);

  const pushSample = useCallback((alt: number | null) => {
    const d = gpsDistance.current + fallbackDistance.current;
    trackRef.current.push([Math.round(elapsedNow()), +d.toFixed(1), alt == null ? null : +alt.toFixed(1)]);
  }, []);

  const onLocation = useCallback((loc: Location.LocationObject) => {
    if (statusRef.current !== 'running') return;
    const { latitude, longitude, accuracy: acc } = loc.coords;
    lastAnyFixAt.current = Date.now();
    lastAcc.current = acc;
    setAccuracy(acc);
    if (acc != null && acc > MAX_ACCURACY_M) return;

    const c: Coord = { latitude, longitude };
    const t = loc.timestamp;
    const prev = lastPoint.current;
    lastFixAt.current = Date.now();

    // first fix of a segment, or we lost signal long enough that drawing a line would be a lie
    if (!prev || t - prev.t > GAP_MS) {
      lastPoint.current = { c, t };
      trail.current = [];
      pushSample(loc.coords.altitude);
      setSegments((s) => {
        const next = s.slice();
        if (!prev) next[next.length - 1] = [c];
        else next.push([c]);
        return next;
      });
      return;
    }

    const d = haversine(prev.c, c);
    const dt = Math.max((t - prev.t) / 1000, 0.001);
    if (d < MIN_STEP_M || d / dt > MAX_SPEED_MS) return;

    gpsDistance.current += d;
    lastPoint.current = { c, t };
    publishDistance();
    pushSample(loc.coords.altitude);

    // short rolling window for current pace, lightly smoothed
    trail.current.push({ t, d: gpsDistance.current });
    while (trail.current.length > 1 && t - trail.current[0].t > PACE_WINDOW_MS) trail.current.shift();
    const first = trail.current[0];
    const dd = gpsDistance.current - first.d;
    if (dd > 3) {
      const raw = (t - first.t) / 1000 / (dd / 1000);
      const smooth = paceRef.current == null ? raw : paceRef.current * 0.5 + raw * 0.5;
      paceRef.current = smooth;
      setCurrentPace(smooth);
    }

    if (stepsRef.current > 100 && gpsDistance.current > 100) {
      stride.current = gpsDistance.current / stepsRef.current;
    }

    setSegments((s) => {
      const next = s.slice();
      next[next.length - 1] = [...next[next.length - 1], c];
      return next;
    });
  }, [publishDistance, pushSample]);

  const startSensors = useCallback(async () => {
    locSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
      onLocation,
    );

    try {
      const avail = await Pedometer.isAvailableAsync();
      setPedometerOk(avail);
      if (avail) {
        const perm = await Pedometer.requestPermissionsAsync();
        if (perm.granted) {
          lastWatchSteps.current = 0;
          pedoSub.current = Pedometer.watchStepCount(({ steps: n }) => {
            if (statusRef.current !== 'running') return;
            const delta = n - lastWatchSteps.current;
            lastWatchSteps.current = n;
            const total = stepBase.current + n;
            stepsRef.current = total;
            setSteps(total);

            // GPS lost? keep distance ticking from steps so the run isn't short-changed
            if (Date.now() - lastFixAt.current > GPS_LOST_MS && delta > 0) {
              fallbackDistance.current += delta * stride.current;
              publishDistance();
            }

            const now = Date.now();
            stepTrail.current.push({ t: now, s: total });
            while (stepTrail.current.length > 1 && now - stepTrail.current[0].t > 30000) stepTrail.current.shift();
            const f = stepTrail.current[0];
            const mins = (now - f.t) / 60000;
            const spm = mins > 0.05 ? Math.round((total - f.s) / mins) : 0;
            setCadence(spm);
            if (spm > 0 && now - lastCadenceAt.current > 4000) {
              lastCadenceAt.current = now;
              cadenceRef.current.push([Math.round(elapsedNow()), spm]);
            }
          });
        }
      }
    } catch {
      setPedometerOk(false);
    }
  }, [onLocation, publishDistance]);

  const stopSensors = useCallback(() => {
    locSub.current?.remove();
    locSub.current = null;
    pedoSub.current?.remove();
    pedoSub.current = null;
    stepBase.current = stepsRef.current;
    lastWatchSteps.current = 0;
  }, []);

  const startTimers = useCallback(() => {
    resumedAt.current = Date.now();
    timer.current = setInterval(() => {
      setElapsed(accMs.current + (Date.now() - resumedAt.current));
      // derive GPS health once per tick
      const since = Date.now() - lastAnyFixAt.current;
      const a = lastAcc.current;
      setGps(since > GPS_LOST_MS ? 'lost' : a != null && a <= GOOD_ACCURACY_M ? 'good' : 'weak');
    }, 500);
    saver.current = setInterval(checkpoint, AUTOSAVE_MS);
  }, [checkpoint]);
  const stopTimers = () => {
    if (timer.current) clearInterval(timer.current);
    if (saver.current) clearInterval(saver.current);
    timer.current = null;
    saver.current = null;
    accMs.current += Date.now() - resumedAt.current;
    setElapsed(accMs.current);
  };

  const beginSegment = () => {
    lastPoint.current = null; // never count the gap between pause and resume
    lastFixAt.current = Date.now();
    lastAnyFixAt.current = Date.now();
    trail.current = [];
    paceRef.current = null;
    setSegments((s) => [...s, []]);
  };

  const start = useCallback(
    async (sport: Sport = 'run') => {
      sportRef.current = sport;
      runId.current = `${Date.now()}`;
      startedAt.current = Date.now();
      gpsDistance.current = 0;
      fallbackDistance.current = 0;
      stepBase.current = 0;
      stepsRef.current = 0;
      accMs.current = 0;
      stride.current = DEFAULT_STRIDE_M;
      stepTrail.current = [];
      splitsDone.current = 0;
      splitMark.current = 0;
      segmentsRef.current = [];
      splitsRef.current = [];
      trackRef.current = [];
      cadenceRef.current = [];
      lastCadenceAt.current = 0;
      setSplits([]);
      setSegments([]);
      setDistance(0);
      setSteps(0);
      setCadence(0);
      setElapsed(0);
      setCurrentPace(null);
      beginSegment();
      setStat('running');
      startTimers();
      await startSensors();
    },
    [startSensors, startTimers],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== 'running') return;
    stopTimers();
    setStat('paused');
    stopSensors();
    setCurrentPace(null);
    checkpoint();
  }, [stopSensors, checkpoint]);

  const resume = useCallback(async () => {
    if (statusRef.current !== 'paused') return;
    beginSegment();
    setStat('running');
    startTimers();
    await startSensors();
  }, [startSensors, startTimers]);

  const finish = useCallback(() => {
    if (statusRef.current === 'running') stopTimers();
    stopSensors();
    setStat('finished');
    checkpoint(); // the finished run is on disk before the summary even renders
  }, [stopSensors, checkpoint]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (saver.current) clearInterval(saver.current);
      locSub.current?.remove();
      pedoSub.current?.remove();
    },
    [],
  );

  const avgPace = distance > 20 ? elapsed / 1000 / (distance / 1000) : null;

  return {
    status,
    permission,
    initial,
    segments,
    distance,
    elapsed,
    steps,
    cadence,
    currentPace,
    avgPace,
    pedometerOk,
    splits,
    gps,
    accuracy,
    start,
    pause,
    resume,
    finish,
    buildRun,
    setOnSplit,
  };
}
