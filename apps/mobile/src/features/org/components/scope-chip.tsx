import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Icon } from '@/shared/components/icon/icon';
import { AnimatedPressable } from '@/shared/components/animated-pressable';
import { colorScales, borderRadius, motion } from '@/shared/theme';

/**
 * Scope chip del header global — paridad 1:1 con el web `HeaderComponent`
 * (`button.md:hidden.inline-flex`).
 *
 * Muestra el modo operativo actual como icono:
 *   - `building`  azul (#2563eb) cuando scope = ORGANIZATION
 *   - `store`     gris (slate-600) cuando scope = STORE
 *
 * NO incluye el chip fiscal — el usuario decidió no mostrar el modo fiscal
 * en el header mobile (sólo el modo operativo).
 *
 * Tap → navega a `/(org-admin)/settings/operating-scope` para que el usuario
 * pueda cambiar el modo si lo necesita.
 *
 * Animación sutil: al cambiar de scope (org/store), el icono hace un pequeño
 * pulse (scale 1 → 1.15 → 1) para señalar el cambio sin ser intrusivo.
 */

export type OperatingScopeValue = 'STORE' | 'ORGANIZATION';

interface ScopeChipProps {
  scope: OperatingScopeValue | null | undefined;
}

export function ScopeChip({ scope }: ScopeChipProps) {
  const router = useRouter();
  const isOrg = scope === 'ORGANIZATION';
  const label = isOrg ? 'Modo operativo: Organización' : 'Modo operativo: Por tienda';

  // Pulse animation al cambiar scope.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withSequence(
      withSpring(1.15, { damping: 8, stiffness: 240, mass: 0.6 }),
      withSpring(1, motion.spring.firm),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const animatedIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <AnimatedPressable
      onPress={() => router.push('/(org-admin)/settings/operating-scope' as never)}
      hitSlop={6}
      style={styles.button}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Animated.View style={animatedIconStyle}>
        <Icon
          name={isOrg ? 'building' : 'store'}
          size={20}
          color={isOrg ? '#2563eb' : colorScales.gray[600]}
        />
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // Paridad con web: h-11 w-11 = 44×44; rounded-lg; hover:bg-black/5
  button: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
