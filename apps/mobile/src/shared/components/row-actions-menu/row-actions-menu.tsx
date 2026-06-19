import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, BackHandler } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

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
  /** Cuando es true el menú usa un Icon `more-vertical`. Si quieres custom, pasa `icon`. */
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
  default: colorScales.gray[900],
};

/**
 * Menú de acciones por fila (3 puntos verticales).
 *
 * Espejo del `actionsDisplay="dropdown"` que el componente web usa en la
 * tabla de dominios (Editar / Verificar / Provisionar / Eliminar). Cada
 * `RowAction` declara su variante para colorear el ícono + texto.
 *
 * Usa un `Modal` nativo transparente con un sheet anclado abajo — el
 * patrón más cercano a un Popover en mobile sin agregar dependencias.
 *
 * No usa props de navegación; el padre controla qué modal abrir después
 * de que la action dispare (create/edit/verify/delete).
 */
export function RowActionsMenu({ actions, icon = 'more-vertical', iconColor, iconSize = 18, accessibilityLabel = 'Acciones' }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);

  const visibleActions = actions.filter((a) => {
    if (typeof a.visible === 'function') return a.visible();
    if (a.visible === undefined) return true;
    return a.visible;
  });

  const handleAction = async (action: RowAction) => {
    setOpen(false);
    // Pequeño delay para que el modal se cierre antes de la acción.
    setTimeout(() => {
      action.onPress();
    }, 120);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityLabel={accessibilityLabel}
        style={styles.trigger}
      >
        <Icon name={icon} size={iconSize} color={iconColor ?? colorScales.gray[500]} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <View style={styles.sheetContent}>
              {visibleActions.map((action, idx) => {
                const variant = action.variant ?? 'default';
                const isDestructive = action.destructive ?? variant === 'danger';
                const color = VARIANT_COLOR[variant];
                return (
                  <Pressable
                    key={action.key}
                    style={[
                      styles.action,
                      idx > 0 && styles.actionBorder,
                      isDestructive && styles.actionDestructive,
                    ]}
                    onPress={() => handleAction(action)}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: color + '15' }]}>
                      <Icon name={action.icon} size={16} color={color} />
                    </View>
                    <Text style={[styles.actionLabel, { color }]} numberOfLines={1}>
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setOpen(false)}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing[6],
    paddingTop: spacing[2],
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorScales.gray[300],
    alignSelf: 'center',
    marginBottom: spacing[2],
  },
  sheetContent: {
    paddingHorizontal: spacing[2],
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  actionBorder: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    borderRadius: 0,
  },
  actionDestructive: {},
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  cancelBtn: {
    marginTop: spacing[2],
    marginHorizontal: spacing[2],
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.gray[100],
  },
  cancelText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
});
