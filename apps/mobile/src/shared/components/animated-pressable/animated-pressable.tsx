import { useState, type ReactNode, type ComponentProps } from 'react';
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
 * Acepta las mismas props que `Pressable`. Los callbacks `onPressIn` y
 * `onPressOut` nativos de RN son consumidos internamente por la animación,
 * por lo que este componente los omite de sus tipos públicos.
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
  const [isPressed, setIsPressed] = useState(false);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const handlePressIn = () => {
    if (!active) return;
    setIsPressed(true);
    scale.value = withSpring(pressedScale, motion.spring.gentle);
    opacity.value = withTiming(pressedOpacity, {
      duration: motion.duration.fast,
      easing: motion.easing.standard,
    });
  };

  const handlePressOut = () => {
    if (!active) return;
    setIsPressed(false);
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

  const resolvedStyle = typeof style === 'function'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (style as any)({ pressed: isPressed })
    : style;

  return (
    <AnimatedPressableRoot
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[resolvedStyle, animatedStyle]}
    >
      {children}
    </AnimatedPressableRoot>
  );
}
