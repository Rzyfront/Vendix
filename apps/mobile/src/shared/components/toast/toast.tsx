import { useEffect, useRef, type ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, colorScales, typography, motion } from '@/shared/theme';
import { Icon, type IconName } from '@/shared/components/icon/icon';
import { haptics } from '@/shared/utils/haptics';
import { useToastStore, type Toast, type ToastType } from './toast.store';

/**
 * Sistema de toasts animado — estilo glass minimalista.
 *
 * ## Diseño
 *
 * Tarjeta compacta, translúcida (efecto glass), con borde sutil y sombra
 * elevada. Padding reducido, texto 13px, ícono 16px. Ancho máximo 340px,
 * alineado a la DERECHA del viewport.
 *
 * ## Auto-dismiss
 *
 * Gestionado 100% por el STORE vía polling (ver `toast.store.ts`). El
 * componente sólo se ocupa de la animación de entrada/salida. Cuando el
 * polling marca un toast como expirado, llama `removeToast(id)` y el
 * componente se desmonta naturalmente.
 */

type TypeConfig = {
  accent: string;
  iconName: IconName;
};

const TYPE_CONFIG: Record<ToastType, TypeConfig> = {
  success: { accent: colorScales.green[600], iconName: 'check-circle' },
  error:   { accent: colorScales.red[600],   iconName: 'x-circle' },
  warning: { accent: colorScales.amber[600], iconName: 'alert-triangle' },
  info:    { accent: colorScales.blue[600],  iconName: 'info' },
};

const SLIDE_OFFSET = -60;

function triggerHaptic(type: ToastType): void {
  if (type === 'success') haptics.success();
  else if (type === 'error') haptics.error();
  else haptics.selection();
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const cfg = TYPE_CONFIG[toast.type];
  const offsetY = useSharedValue(SLIDE_OFFSET);
  const opacity = useSharedValue(0);
  // Guard contra doble-dismiss (tap × + polling simultáneos).
  const isDismissingRef = useRef(false);

  useEffect(() => {
    triggerHaptic(toast.type);
    offsetY.value = withSpring(0, motion.spring.gentle);
    opacity.value = withTiming(1, {
      duration: motion.duration.fast,
      easing: motion.easing.standard,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: offsetY.value }],
  }));

  const handleDismiss = (): void => {
    if (isDismissingRef.current) return;
    isDismissingRef.current = true;

    offsetY.value = withTiming(-8, {
      duration: motion.duration.fast,
      easing: motion.easing.accelerate,
    });
    opacity.value = withTiming(
      0,
      {
        duration: motion.duration.fast,
        easing: motion.easing.accelerate,
      },
      (done) => {
        if (done) runOnJS(onDismiss)();
      },
    );
  };

  const handleActionPress = (): void => {
    toast.action?.onPress();
    handleDismiss();
  };

  return (
    <Animated.View style={[styles.toastItem, animatedStyle]}>
      <View style={[styles.accent, { backgroundColor: cfg.accent }]} />
      <Icon name={cfg.iconName} size={16} color={cfg.accent} style={styles.icon} />
      <Text style={styles.message} numberOfLines={2}>
        {toast.message}
      </Text>
      {toast.action ? (
        <Pressable onPress={handleActionPress} hitSlop={6} style={styles.actionBtn}>
          <Text style={[styles.actionLabel, { color: cfg.accent }]}>{toast.action.label}</Text>
        </Pressable>
      ) : null}
      {toast.dismissible !== false ? (
        <Pressable onPress={handleDismiss} hitSlop={6} style={styles.dismissBtn}>
          <Icon name="x" size={14} color={colorScales.gray[500]} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export interface ToastContainerProps {
  children?: ReactNode;
}

export function ToastContainer({ children: _children }: ToastContainerProps = {}) {
  const insets = useSafeAreaInsets();
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) {
    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.containerEmpty,
          { paddingTop: insets.top + spacing[3] },
        ]}
      />
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.container,
        { paddingTop: insets.top + spacing[3] },
      ]}
    >
      {toasts.map((t) => (
        <View key={t.id} style={styles.row} pointerEvents="box-none">
          <ToastItem toast={t} onDismiss={() => removeToast(t.id)} />
        </View>
      ))}
      {Platform.OS === 'ios' && insets.top === 0 ? (
        <View style={{ height: spacing[8] }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'flex-end',
    paddingHorizontal: spacing[3],
    zIndex: 9999,
    elevation: 9999,
  },
  containerEmpty: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'flex-end',
    paddingHorizontal: spacing[3],
    zIndex: 9999,
    elevation: 9999,
  },
  row: {
    width: '100%',
    alignItems: 'flex-end',
    marginBottom: spacing[2],
  },
  toastItem: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 220,
    minWidth: 100,
    width: '100%',
    paddingLeft: 0,
    paddingRight: spacing[3],
    paddingVertical: spacing[2] + 2,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: spacing[2] + 2,
  },
  icon: {
    marginRight: spacing[2],
  },
  message: {
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    color: colorScales.gray[800],
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.medium,
  },
  actionBtn: {
    marginLeft: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
  },
  dismissBtn: {
    marginLeft: spacing[1],
    padding: 4,
  },
});

export { useToastStore, type Toast, type ToastType } from './toast.store';