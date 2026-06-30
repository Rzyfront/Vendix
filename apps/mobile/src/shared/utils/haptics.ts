import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Wrapper de `expo-haptics` con fallback silencioso.
 *
 * - En web y plataformas sin soporte (Android sin vibrador, iOS Simulator), las
 *   llamadas se vuelven no-ops. Esto evita que un `try/catch` se propague a los
 *   componentes que consumen el helper.
 * - Todos los helpers devuelven `void` — la API no debe bloquear el flujo de UI
 *   si el dispositivo no responde.
 */

const isSupported = Platform.OS === 'ios' || Platform.OS === 'android';

function safe(fn: () => unknown): void {
  if (!isSupported) return;
  try {
    fn();
  } catch {
    /* swallow — haptics is non-critical, nunca debe romper la UI */
  }
}

export const haptics = {
  /** Feedback de éxito (confirmación de acción completada). */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Feedback de error (validación fallida, acción rechazada). */
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Feedback de advertencia (acción riesgosa, requiere atención). */
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Feedback de selección (cambio de tab, switch, picker). */
  selection: () => safe(() => Haptics.selectionAsync()),
  /** Impacto ligero (tap en botón, list item). */
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Impacto medio (toggle, drag snap). */
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Impacto fuerte (confirmaciones pesadas, destrucción). */
  heavy: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
} as const;