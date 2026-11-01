import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Linking, Platform } from 'react-native';
import type { Fix } from './engine';

export const TASK = 'velio-background-location';

type Sink = (fixes: Fix[]) => void;
let sink: Sink | null = null;
/** The active run registers here; the OS task hands it every batch of fixes. */
export const setLocationSink = (fn: Sink | null) => {
  sink = fn;
};

export const toFix = (l: Location.LocationObject): Fix => ({
  latitude: l.coords.latitude,
  longitude: l.coords.longitude,
  accuracy: l.coords.accuracy,
  altitude: l.coords.altitude,
  timestamp: l.timestamp,
});

// Must run at module scope, before React mounts (imported from index.ts).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  sink?.(data.locations.map(toFix));
});

export type Access = 'always' | 'while-using' | 'denied';

/** What the OS currently allows, without prompting. */
export async function readAccess(): Promise<Access> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.granted ? 'always' : 'while-using';
  } catch {
    return 'while-using';
  }
}

/**
 * Foreground prompt, then background prompt. A refused or silently-failed background request (iOS "Allow
 * Once", Android decline, Expo Go) is not an error: the run still works while the screen is on.
 */
export async function requestAccess(): Promise<Access> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.granted ? 'always' : 'while-using';
  } catch {
    return 'while-using';
  }
}

export const openSettings = () => (Platform.OS === 'ios' ? Linking.openURL('app-settings:') : Linking.openSettings());

/** Starts OS-level updates that keep arriving with the screen locked. Returns false when unavailable (Expo Go). */
export async function startBackground(): Promise<boolean> {
  try {
    if (!(await Location.isBackgroundLocationAvailableAsync())) return false;
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 1000,
      distanceInterval: 5,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Velio is recording',
        notificationBody: 'Tracking your route.',
        notificationColor: '#C6FF3D',
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackground() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch {}
}
