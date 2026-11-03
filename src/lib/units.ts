import { useSyncExternalStore } from 'react';

export type Units = 'km' | 'mi';
export const M_PER_MI = 1609.344;

let current: Units = 'km';
const subs = new Set<() => void>();

export const getUnits = () => current;
export function setUnits(u: Units) {
  if (u === current) return;
  current = u;
  subs.forEach((f) => f());
}
/** Re-renders the calling component when the unit changes. The format helpers below read the current unit. */
export const useUnits = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getUnits,
    getUnits,
  );

/** Metres in one display unit. */
export const unitMeters = (u: Units = current) => (u === 'km' ? 1000 : M_PER_MI);
export const unitLabel = (u: Units = current): string => u;
/** "KM" / "MI" for split labels. */
export const unitCaps = (u: Units = current) => (u === 'km' ? 'KM' : 'MI');
export const unitName = (u: Units = current, n = 2) => (u === 'km' ? 'kilometres' : n === 1 ? 'mile' : 'miles');

export const toUnit = (meters: number, u: Units = current) => meters / unitMeters(u);
export const fromUnit = (value: number, u: Units = current) => value * unitMeters(u);
export const formatDist = (meters: number, digits = 2, u: Units = current) => toUnit(meters, u).toFixed(digits);

/** Seconds per km -> seconds per display unit. */
export const paceToUnit = (secPerKm: number, u: Units = current) => (u === 'km' ? secPerKm : secPerKm * (M_PER_MI / 1000));
/** km/h -> display speed. */
export const speedToUnit = (kmh: number, u: Units = current) => (u === 'km' ? kmh : kmh * (1000 / M_PER_MI));
export const speedLabel = (u: Units = current) => (u === 'km' ? 'km/h' : 'mph');

/** Miles for US locales, kilometres elsewhere; only used until the user picks. */
export function defaultUnits(): Units {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    return /-(US|LR|MM)\b/i.test(loc) ? 'mi' : 'km';
  } catch {
    return 'km';
  }
}
