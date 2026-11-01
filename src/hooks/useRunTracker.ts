import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { Coord } from '../lib/geo';
import { Fix, RunEngine, Split } from '../lib/engine';
import { Run, Sport, saveActive } from '../lib/storage';
import {
  Access,
  readAccess,
  requestAccess,
  setLocationSink,
  startBackground,
  stopBackground,
  toFix,
} from '../lib/backgroundLocation';

export type RunStatus = 'idle' | 'running' | 'paused' | 'finished';
export type Permission = 'unknown' | 'granted' | 'denied';
export type Gps = 'searching' | 'good' | 'weak' | 'lost';

const GOOD_ACCURACY_M = 10;
const GPS_LOST_MS = 6000; // no fix for this long = signal lost
const AUTOSAVE_MS = 5000;

/**
 * Tracks a run. The maths lives in RunEngine; this hook wires it to the sensors and to React. GPS comes from
 * an OS background task when "Always" access is granted (it keeps delivering with the screen locked) and from
 * a foreground watcher otherwise. The pedometer keeps distance moving while the GPS signal is lost. State is
 * checkpointed to local storage every few seconds, and whenever the app goes to the background.
 */
export function useRunTracker() {
  const eng = useRef(new RunEngine());
  const [status, setStatus] = useState<RunStatus>('idle');
  const [permission, setPermission] = useState<Permission>('unknown');
  const [access, setAccess] = useState<Access>('denied');
  const [initial, setInitial] = useState<Coord | null>(null);
  const [segments, setSegments] = useState<Coord[][]>([]);
  const [distance, setDistance] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [steps, setSteps] = useState(0);
  const [cadence, setCadence] = useState(0);
  const [currentPace, setCurrentPace] = useState<number | null>(null);
  const [pedometerOk, setPedometerOk] = useState(false);
  const [splits, setSplits] = useState<Split[]>([]);
  const [gps, setGps] = useState<Gps>('searching');
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const locSub = useRef<Location.LocationSubscription | null>(null);
  const pedoSub = useRef<{ remove: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const saver = useRef<ReturnType<typeof setInterval> | null>(null);
  const usingBackground = useRef(false);
  const accessRef = useRef<Access>('denied');
  const ticks = useRef(0);

  const lastAnyFixAt = useRef(0);
  const lastAcc = useRef<number | null>(null);
  const stepBase = useRef(0);
  const lastWatchSteps = useRef(0);
  const stepTrail = useRef<{ t: number; s: number }[]>([]);
  const lastCadenceAt = useRef(0);
  /** Screens set this to react to a completed km (toast, haptic) without an effect. */
  const onSplit = useRef<((s: Split) => void) | null>(null);
  const setOnSplit = useCallback((fn: ((s: Split) => void) | null) => {
    onSplit.current = fn;
  }, []);

  const sync = useCallback(() => {
    const e = eng.current;
    setStatus(e.state);
    setSegments(e.segments);
    setDistance(e.distance);
    setSteps(e.steps);
    setSplits(e.splits);
    setCurrentPace(e.currentPace);
  }, []);

  const refreshAccess = useCallback(async () => {
    const a = await readAccess();
    accessRef.current = a;
    setAccess(a);
    setPermission(a === 'denied' ? 'denied' : 'granted');
    return a;
  }, []);

  // read (never request) permission and, if already granted, a first fix so the map can centre
  useEffect(() => {
    let alive = true;
    (async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      if (!alive) return;
      if (!fg.granted) return setPermission(fg.canAskAgain ? 'unknown' : 'denied');
      await refreshAccess();
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
  }, [refreshAccess]);

  /** First-run explainer has been shown: ask the OS, foreground then background. */
  const askPermission = useCallback(async () => {
    let a = await requestAccess();
    if (a === 'while-using') {
      // iOS can resolve the request before the user answers the "Always" upgrade prompt
      await new Promise((r) => setTimeout(r, 1200));
      a = await readAccess();
    }
    accessRef.current = a;
    setAccess(a);
    setPermission(a === 'denied' ? 'denied' : 'granted');
    if (a !== 'denied') {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setInitial({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch {}
    }
    return a;
  }, []);

  const checkpoint = useCallback(() => {
    const e = eng.current;
    if (!e.id || e.state === 'idle') return;
    saveActive(e.toRun(Date.now()));
  }, []);

  const receive = useCallback(
    (fixes: Fix[]) => {
      const e = eng.current;
      if (e.state !== 'running' || !fixes.length) return;
      const newest = fixes.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
      lastAnyFixAt.current = Date.now();
      lastAcc.current = newest.accuracy;
      setAccuracy(newest.accuracy);
      const made = e.ingestBatch(fixes);
      sync();
      made.forEach((sp) => onSplit.current?.(sp));
    },
    [sync],
  );

  const startSensors = useCallback(async () => {
    setLocationSink(receive);
    usingBackground.current = false;
    const a = await readAccess();
    accessRef.current = a;
    setAccess(a);
    if (a === 'always') usingBackground.current = await startBackground();
    if (!usingBackground.current) {
      locSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
        (l) => receive([toFix(l)]),
      );
    }

    try {
      const avail = await Pedometer.isAvailableAsync();
      setPedometerOk(avail);
      if (avail) {
        const perm = await Pedometer.requestPermissionsAsync();
        if (perm.granted) {
          lastWatchSteps.current = 0;
          pedoSub.current = Pedometer.watchStepCount(({ steps: n }) => {
            const e = eng.current;
            if (e.state !== 'running') return;
            const delta = n - lastWatchSteps.current;
            lastWatchSteps.current = n;
            const total = stepBase.current + n;
            const lost = Date.now() - e.lastFixAt > GPS_LOST_MS;
            const made = e.addSteps(total, delta, lost);
            setSteps(total);
            if (lost && delta > 0) {
              setDistance(e.distance);
              if (made) {
                setSplits(e.splits);
                onSplit.current?.(made);
              }
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
              e.cadence.push([Math.round(e.elapsed(now)), spm]);
            }
          });
        }
      }
    } catch {
      setPedometerOk(false);
    }
  }, [receive]);

  const stopSensors = useCallback(() => {
    locSub.current?.remove();
    locSub.current = null;
    pedoSub.current?.remove();
    pedoSub.current = null;
    if (usingBackground.current) stopBackground();
    usingBackground.current = false;
    setLocationSink(null);
    stepBase.current = eng.current.steps;
    lastWatchSteps.current = 0;
  }, []);

  const startTimers = useCallback(() => {
    timer.current = setInterval(() => {
      const now = Date.now();
      setElapsed(eng.current.elapsed(now));
      const since = now - lastAnyFixAt.current;
      const a = lastAcc.current;
      setGps(since > GPS_LOST_MS ? 'lost' : a != null && a <= GOOD_ACCURACY_M ? 'good' : 'weak');
      // keep the lock-screen banner honest if the user changes the permission mid-run
      if (accessRef.current !== 'always' && ++ticks.current % 6 === 0) refreshAccess();
    }, 500);
    saver.current = setInterval(checkpoint, AUTOSAVE_MS);
  }, [checkpoint, refreshAccess]);
  const stopTimers = () => {
    if (timer.current) clearInterval(timer.current);
    if (saver.current) clearInterval(saver.current);
    timer.current = null;
    saver.current = null;
  };

  // the OS may suspend or kill us once we are in the background: put the run on disk first
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') checkpoint();
      else {
        refreshAccess();
      }
      if (st === 'active' && eng.current.state === 'running') {
        setElapsed(eng.current.elapsed(Date.now()));
        sync();
      }
    });
    return () => sub.remove();
  }, [checkpoint, sync, refreshAccess]);

  const start = useCallback(
    async (sport: Sport = 'run') => {
      const now = Date.now();
      stepBase.current = 0;
      stepTrail.current = [];
      lastCadenceAt.current = 0;
      lastAnyFixAt.current = now;
      eng.current.start(now, sport);
      setElapsed(0);
      setCadence(0);
      sync();
      startTimers();
      await startSensors();
    },
    [startSensors, startTimers, sync],
  );

  const pause = useCallback(() => {
    if (eng.current.state !== 'running') return;
    eng.current.pause(Date.now());
    stopTimers();
    stopSensors();
    setElapsed(eng.current.elapsed(Date.now()));
    sync();
    checkpoint();
  }, [stopSensors, checkpoint, sync]);

  const resume = useCallback(async () => {
    if (eng.current.state !== 'paused') return;
    const now = Date.now();
    lastAnyFixAt.current = now;
    eng.current.resume(now);
    sync();
    startTimers();
    await startSensors();
  }, [startSensors, startTimers, sync]);

  const finish = useCallback(() => {
    const now = Date.now();
    stopTimers();
    stopSensors();
    eng.current.finish(now);
    setElapsed(eng.current.elapsed(now));
    sync();
    checkpoint(); // the finished run is on disk before the summary even renders
  }, [stopSensors, checkpoint, sync]);

  const buildRun = useCallback((): Run => eng.current.toRun(Date.now()), []);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (saver.current) clearInterval(saver.current);
      locSub.current?.remove();
      pedoSub.current?.remove();
      if (usingBackground.current) stopBackground();
      setLocationSink(null);
    },
    [],
  );

  const avgPace = distance > 20 ? elapsed / 1000 / (distance / 1000) : null;

  return {
    status,
    permission,
    access,
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
    askPermission,
    refreshAccess,
  };
}
