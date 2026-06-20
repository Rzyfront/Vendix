import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { colorScales, borderRadius } from '@/shared/theme';

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
 */

export type OperatingScopeValue = 'STORE' | 'ORGANIZATION';

interface ScopeChipProps {
  scope: OperatingScopeValue | null | undefined;
}

export function ScopeChip({ scope }: ScopeChipProps) {
  const router = useRouter();
  const isOrg = scope === 'ORGANIZATION';
  const label = isOrg ? 'Modo operativo: Organización' : 'Modo operativo: Por tienda';

  return (
    <Pressable
      onPress={() => router.push('/(org-admin)/settings/operating-scope' as never)}
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Icon
        name={isOrg ? 'building' : 'store'}
        size={20}
        color={isOrg ? '#2563eb' : colorScales.gray[600]}
      />
    </Pressable>
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
  pressed: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
});
