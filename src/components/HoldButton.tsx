import { ReactNode, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, { Easing, cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Press-and-hold button with a ring that fills; fires onComplete when full. */
export function HoldButton({
  size = 68,
  duration = 1100,
  color = colors.danger,
  onComplete,
  children,
}: {
  size?: number;
  duration?: number;
  color?: string;
  onComplete: () => void;
  children: ReactNode;
}) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.value) }));

  const down = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    p.value = withTiming(1, { duration, easing: Easing.linear });
    timer.current = setTimeout(() => {
      timer.current = null;
      onComplete();
    }, duration);
  };
  const up = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    cancelAnimation(p);
    p.value = withTiming(0, { duration: 220 });
  };

  return (
    <Pressable onPressIn={down} onPressOut={up} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.hairline} strokeWidth={stroke} fill={colors.surface2} />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={[c, c]}
          animatedProps={props}
        />
      </Svg>
      {children}
    </Pressable>
  );
}
