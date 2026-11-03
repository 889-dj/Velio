import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { Digits } from './Digits';

/** Counts from 0 to `to` (ease-out) and renders it with fixed-width digits. */
export function CountUp({ to, size, decimals = 1, delay = 300, duration = 1300 }: {
  to: number;
  size: number;
  decimals?: number;
  delay?: number;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduced) return; // shown as-is below
    let raf = 0;
    const t0 = Date.now() + delay;
    const tick = () => {
      const t = Math.min(Math.max((Date.now() - t0) / duration, 0), 1);
      setV(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, duration, reduced]);
  return <Digits value={(reduced ? to : v).toFixed(decimals)} size={size} />;
}
