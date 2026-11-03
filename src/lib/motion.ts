import { Easing, FadeInDown, useReducedMotion } from 'react-native-reanimated';

/**
 * Staggered fade-in for a screen's sections. With "Reduce Motion" on, nothing animates in:
 * the returned function gives `undefined`, which Animated views treat as "no entering animation".
 */
export function useEnter(base = 60, step = 80, duration = 500) {
  const reduced = useReducedMotion();
  return (i: number) =>
    reduced ? undefined : FadeInDown.delay(base + i * step).duration(duration).easing(Easing.out(Easing.cubic));
}

/** Wraps a one-off layout animation (entering / exiting) so it is skipped when "Reduce Motion" is on. */
export function useAnim() {
  const reduced = useReducedMotion();
  return <T,>(a: T): T | undefined => (reduced ? undefined : a);
}
