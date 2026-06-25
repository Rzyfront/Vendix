import { type ReactNode, type ComponentProps } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { motion } from '@/shared/theme';

const AnimatedPressableRoot = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable con feedback sutil basado en Reanimated.
 *
 * - **scale**: 1 → `pressedScale` (default 0.96) al pulsar, vuelve con resorte suave
 * - **opacity**: 1 → `pressedOpacity` (default 0.85) al pulsar
 *
 * Diseñado para tarjetas, botones de lista y CTAs. Más vivo que el feedback
 * plano de `Pressable`, pero sin la exageración de un "bounce" agresivo.
 *
 * Acepta las mismas props que `Pressable` + callbacks `onPressIn` / `onPressOut`
 * propios (los consume internamente para la animación, pero los expone vía
 * `onPressInExternal` / `onPressOutExternal` si necesitas reaccionar también).
 *
 * Uso:
 *   <AnimatedPressable onPress={...} style={styles.card}>
 *     {children}
 *   </AnimatedPressable>
 */
export interface AnimatedPressableProps extends Omit<PressableProps, 'onPressIn' | 'onPressOut' | 'style'> {
  children: ReactNode;
  style?: PressableProps['style'] | ((state: { pressed: boolean }) => PressableProps['style']);
  /** Scale final al pulsar. Default 0.96. */
  pressedScale?: number;
  /** Opacidad final al pulsar. Default 0.85. */
  pressedOpacity?: number;
  /** Si false, desactiva el efecto (ej: estado disabled). */
  active?: boolean;
}

export function AnimatedPressable({
  children,
  style,
  pressedScale = 0.96,
  pressedOpacity = 0.85,
  active = true,
  ...rest
}: AnimatedPressableProps) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const handlePressIn = () => {
    if (!active) return;
    scale.value = withSpring(pressedScale, motion.spring.gentle);
    opacity.value = withTiming(pressedOpacity, {
      duration: motion.duration.fast,
      easing: motion.easing.standard,
    });
  };

  const handlePressOut = () => {
    if (!active) return;
    scale.value = withSpring(1, motion.spring.firm);
    opacity.value = withTiming(1, {
      duration: motion.duration.fast,
      easing: motion.easing.standard,
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <AnimatedPressableRoot
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={typeof style === 'function'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (state: any) => [animatedStyle, (style as any)(state)]
        : [animatedStyle, style]}
    >
      {children}
    </AnimatedPressableRoot>
  );
}
