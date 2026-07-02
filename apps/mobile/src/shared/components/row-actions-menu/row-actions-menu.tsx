import { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Dimensions,
  type View as ViewType,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius, shadows } from '@/shared/theme';

export interface RowAction {
  /** Identificador único del action (e.g. 'edit', 'verify', 'delete'). */
  key: string;
  label: string;
  icon: string;
  variant?: 'primary' | 'secondary' | 'info' | 'warning' | 'danger' | 'default';
  /** Si retorna false, el menú no se cierra (útil para confirmaciones externas). */
  onPress: () => void | Promise<void>;
  /** Si retorna false, oculta el action (e.g. permisos). */
  visible?: boolean | (() => boolean);
  destructive?: boolean;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  /** Icono del trigger. Default `more-vertical` (3 puntos verticales — paridad web). */
  icon?: string;
  iconColor?: string;
  iconSize?: number;
  /** Etiqueta opcional para accesibilidad. */
  accessibilityLabel?: string;
}

const VARIANT_COLOR: Record<NonNullable<RowAction['variant']>, string> = {
  primary: colors.primary,
  secondary: colorScales.blue[600],
  info: colorScales.blue[600],
  warning: colorScales.amber[600],
  danger: colors.error,
  default: colors.text.primary,
};

// ── Popover sizing — paridad con `options-dropdown.component.scss` mobile ──
// Web mobile (<1024px): `min-width: 14rem` (224px) pero `max-width: min(18rem, 100vw-1rem)` (288px).
// Usamos 240px como punto medio; el modal se encarga de clamp en pantallas <512px.
const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_MARGIN = 12;
const DROPDOWN_WIDTH = Math.min(240, SCREEN_WIDTH - SCREEN_MARGIN * 2);
const DROPDOWN_GAP = 4; // web: `margin-top: 0.5rem`

interface TriggerPos {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Menú de acciones por fila (3 puntos verticales).
 *
 * **v2 — Paridad web responsive.** Antes era un bottom-sheet con handle + botón
 * "Cancelar". Ahora es un **popover anclado al trigger** (mismo patrón que
 * `app-options-dropdown` en `apps/frontend`):
 *
 *   - Trigger: botón cuadrado 40px con borde primary (border-radius 12px).
 *   - Dropdown: anclado debajo del trigger, alineado a la derecha del trigger
 *     (se expande hacia la izquierda) — invierte automáticamente si no cabría.
 *   - Header con título "Acciones" + border-bottom.
 *   - Lista compacta de acciones: ícono + label inline (sin background al ícono).
 *   - Variantes: `primary` (texto verde), `danger`/`destructive` (texto rojo,
 *     hover rojo claro).
 *   - Cierre: tap en backdrop o `onRequestClose` (back button en Android).
 *     **Sin botón Cancelar** — paridad web.
 *
 * El posicionamiento usa `measureInWindow` para coordenadas absolutas dentro
 * del `Modal` (que ocupa toda la pantalla). Si la pantalla es muy pequeña
 * (<512px), el dropdown se clampa a los márgenes para no desbordar.
 *
 * Afecta a **todos** los call-sites (domains, products, customers, etc.) —
 * cambio global para mantener paridad visual con la web.
 */
export function RowActionsMenu({
  actions,
  icon = 'more-vertical',
  iconColor,
  iconSize = 18,
  accessibilityLabel = 'Acciones',
}: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [triggerPos, setTriggerPos] = useState<TriggerPos | null>(null);
  const triggerRef = useRef<ViewType>(null);

  const visibleActions = useMemo(
    () =>
      actions.filter((a) => {
        if (typeof a.visible === 'function') return a.visible();
        if (a.visible === undefined) return true;
        return a.visible;
      }),
    [actions],
  );

  const handleOpen = () => {
    const node = triggerRef.current;
    if (!node) return;
    // measureInWindow da coords relativas a la ventana — compatible con Modal fullscreen.
    node.measureInWindow((x, y, width, height) => {
      setTriggerPos({ x, y, width, height });
      setOpen(true);
    });
  };

  const handleClose = () => setOpen(false);

  const dropdownPosition = useMemo(() => {
    if (!triggerPos) return null;
    // Alineación preferida: borde derecho del dropdown coincide con borde derecho
    // del trigger (se expande hacia la izquierda) — mismo patrón que la web.
    let left = triggerPos.x + triggerPos.width - DROPDOWN_WIDTH;
    if (left < SCREEN_MARGIN) {
      // No cabe expandiendo a la izquierda → expandir a la derecha.
      left = triggerPos.x;
      if (left + DROPDOWN_WIDTH > SCREEN_WIDTH - SCREEN_MARGIN) {
        // Última instancia: clampar al margen derecho de la pantalla.
        left = SCREEN_WIDTH - DROPDOWN_WIDTH - SCREEN_MARGIN;
      }
    }
    const top = triggerPos.y + triggerPos.height + DROPDOWN_GAP;
    return { top, left };
  }, [triggerPos]);

  const handleAction = async (action: RowAction) => {
    setOpen(false);
    // Pequeño delay para que la animación de salida termine antes de la acción.
    setTimeout(() => {
      action.onPress();
    }, 120);
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={handleOpen}
        hitSlop={8}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <Icon name={icon} size={iconSize} color={iconColor ?? colors.primary} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          {dropdownPosition && (
            <Pressable
              style={[
                styles.dropdown,
                { top: dropdownPosition.top, left: dropdownPosition.left },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              {/* Header — paridad con `<div class="dropdown-header">` web */}
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Acciones</Text>
              </View>

              {/* Action list — paridad con `<div class="actions-list">` web */}
              <View style={styles.actionList}>
                {visibleActions.map((action) => {
                  const variant = action.variant ?? 'default';
                  const isDestructive = action.destructive ?? variant === 'danger';
                  const isPrimary = variant === 'primary';
                  // El color base del icono coincide con el color del texto
                  // (en la web ambos usan el mismo variant class).
                  const color = isDestructive
                    ? colors.error
                    : isPrimary
                      ? colors.primary
                      : VARIANT_COLOR[variant];

                  return (
                    <Pressable
                      key={action.key}
                      style={({ pressed }) => [
                        styles.actionItem,
                        pressed && styles.actionItemPressed,
                        isDestructive && pressed && styles.actionItemDestructivePressed,
                      ]}
                      onPress={() => handleAction(action)}
                    >
                      <Icon name={action.icon} size={16} color={color} />
                      <Text
                        style={[
                          styles.actionLabel,
                          isPrimary && { color: colors.primary },
                          isDestructive && { color: colors.error },
                        ]}
                        numberOfLines={1}
                      >
                        {action.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── Trigger — paridad con `.options-dropdown-trigger` en mobile (<1024px) ──
  trigger: {
    width: 40, // web: `height: 2.5rem; width: 2.5rem`
    height: 40,
    borderRadius: borderRadius.lg, // web: `border-radius: 0.75rem` (12px)
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary, // web: `border-color: var(--color-primary)`
    backgroundColor: colors.card,
  },
  triggerPressed: {
    transform: [{ scale: 0.98 }], // web: `active: scale(0.98)`
  },

  // ── Backdrop — overlay semi-transparente ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)', // web no usa backdrop, pero
    //                                              en mobile el popover sí lo
    //                                              necesita para detectar "tap outside".
  },

  // ── Dropdown container — paridad con `.options-dropdown-content` ──
  dropdown: {
    position: 'absolute',
    width: DROPDOWN_WIDTH,
    backgroundColor: colors.card,
    borderRadius: borderRadius.md, // web: `var(--radius-md)` (8px)
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    ...shadows.lg,
  },

  // ── Header — paridad con `.dropdown-header` ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4], // web: `padding: 0.75rem 1rem` (12px / 16px)
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  headerTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },

  // ── Action list — paridad con `.actions-list` ──
  actionList: {
    padding: spacing[2], // web: `padding: 0.5rem` (8px)
    gap: 2, // web: `gap: 0.125rem` (2px)
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5], // web: `gap: 0.625rem` (10px)
    paddingVertical: spacing[2], // web: `padding: 0.5rem 0.625rem`
    paddingHorizontal: spacing[2.5],
    borderRadius: borderRadius.sm, // web: `border-radius: var(--radius-sm)` (4px)
  },
  actionItemPressed: {
    backgroundColor: colors.background, // web: `:hover { background-color: var(--color-background) }`
  },
  actionItemDestructivePressed: {
    backgroundColor: '#FEF2F2', // web: `.action-destructive:hover { background-color: rgba(239, 68, 68, 0.08) }`
  },
  actionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
});