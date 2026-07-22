import React, { useState, type ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon } from '@/shared/components/icon/icon';
import {
  borderRadius,
  colorScales,
  colors,
  spacing,
  typography,
} from '@/shared/theme';

export interface OrgOptionsAction {
  key: string;
  label: string;
  icon: string;
  variant?: 'default' | 'primary' | 'warning' | 'danger';
  destructive?: boolean;
  onPress: () => void | Promise<void>;
  disabled?: boolean;
  /** Si retorna false, oculta la acción. */
  visible?: boolean | (() => boolean);
}

interface OrgOptionsDropdownProps {
  /** Acciones a mostrar en el sheet de "Acciones". */
  actions?: OrgOptionsAction[];
  /** Número de filtros activos (badge sobre el botón "Filtros"). */
  activeFiltersCount?: number;
  /** Contenido custom para el sheet de filtros. */
  renderFiltersContent?: (ctx: { onClose: () => void }) => ReactNode;
  /** Etiqueta custom del trigger de acciones (default "Acciones"). */
  actionsLabel?: string;
  /** Ícono del trigger de acciones (default "more-horizontal"). */
  actionsIcon?: string;
  /** Mostrar trigger de acciones (default true si hay actions). */
  showActionsTrigger?: boolean;
  /** Mostrar trigger de filtros (default true si hay filters o activeFiltersCount). */
  showFiltersTrigger?: boolean;
  style?: StyleProp<ViewStyle>;
}

const ACTION_VARIANT_COLOR: Record<NonNullable<OrgOptionsAction['variant']>, string> = {
  default: colorScales.gray[700],
  primary: colors.primary,
  warning: colorScales.amber[600],
  danger: colors.error,
};

/**
 * Espejo mobile del `OptionsDropdownComponent` de la web.
 *
 * Layout:
 *   ┌────────────────┐ ┌─────────────────┐
 *   │ [icon] Acciones│ │ [⊟] Filtros [2] │ ← badge count si > 0
 *   └────────────────┘ └─────────────────┘
 *
 * - Tap "Acciones" → bottom sheet con lista de action buttons.
 * - Tap "Filtros"  → bottom sheet con `renderFiltersContent` (delegado
 *   al padre — el padre decide cómo organizar sus filtros).
 */
export function OrgOptionsDropdown({
  actions,
  activeFiltersCount = 0,
  renderFiltersContent,
  actionsLabel = 'Acciones',
  actionsIcon = 'more-horizontal',
  showActionsTrigger,
  showFiltersTrigger,
  style,
}: OrgOptionsDropdownProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const visibleActions = (actions ?? []).filter((a) => {
    if (typeof a.visible === 'function') return a.visible();
    if (a.visible === undefined) return true;
    return a.visible;
  });

  const hasActions = (showActionsTrigger ?? visibleActions.length > 0) && visibleActions.length > 0;
  const hasFilters =
    (showFiltersTrigger ?? !!renderFiltersContent) &&
    (!!renderFiltersContent || activeFiltersCount > 0);

  if (!hasActions && !hasFilters) return null;

  const handleActionPress = async (action: OrgOptionsAction) => {
    setActionsOpen(false);
    setTimeout(() => action.onPress(), 120);
  };

  return (
    <View style={[styles.row, style]}>
      {hasActions ? (
        <Pressable
          style={styles.trigger}
          onPress={() => setActionsOpen(true)}
          hitSlop={6}
          accessibilityLabel="Abrir acciones"
        >
          <Icon name={actionsIcon} size={16} color={colorScales.gray[700]} />
          <Text style={styles.triggerLabel} numberOfLines={1}>
            {actionsLabel}
          </Text>
          <Icon name="chevron-down" size={14} color={colorScales.gray[500]} />
        </Pressable>
      ) : null}

      {hasFilters ? (
        <Pressable
          style={styles.trigger}
          onPress={() => setFiltersOpen(true)}
          hitSlop={6}
          accessibilityLabel="Abrir filtros"
        >
          <Icon name="filter" size={16} color={colorScales.gray[700]} />
          <Text style={styles.triggerLabel} numberOfLines={1}>
            Filtros
          </Text>
          {activeFiltersCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeFiltersCount}</Text>
            </View>
          ) : null}
          <Icon name="chevron-down" size={14} color={colorScales.gray[500]} />
        </Pressable>
      ) : null}

      {/* Actions sheet */}
      <Modal
        visible={actionsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActionsOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{actionsLabel}</Text>
            </View>
            <ScrollView style={styles.sheetScroll}>
              {visibleActions.map((action, idx) => {
                const variant = action.variant ?? 'default';
                const color = ACTION_VARIANT_COLOR[variant];
                const isDestructive = action.destructive ?? variant === 'danger';
                return (
                  <Pressable
                    key={action.key}
                    style={[
                      styles.actionItem,
                      idx > 0 && styles.actionItemBorder,
                      action.disabled && styles.actionItemDisabled,
                    ]}
                    disabled={action.disabled}
                    onPress={() => handleActionPress(action)}
                  >
                    <View
                      style={[styles.actionIcon, { backgroundColor: color + '15' }]}
                    >
                      <Icon name={action.icon} size={16} color={color} />
                    </View>
                    <Text
                      style={[
                        styles.actionLabel,
                        { color },
                        isDestructive && styles.actionLabelDestructive,
                      ]}
                      numberOfLines={1}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setActionsOpen(false)}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Filters sheet */}
      <Modal
        visible={filtersOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFiltersOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setFiltersOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filtros</Text>
              {activeFiltersCount > 0 ? (
                <Pressable
                  onPress={() => {
                    setFiltersOpen(false);
                    // El padre puede capturar el evento a través de onClearAll
                    if (renderFiltersContent) {
                      // No auto-clear; el padre decide vía sus props.
                    }
                  }}
                  style={styles.clearAllBtn}
                >
                  <Icon name="x" size={14} color={colors.error} />
                  <Text style={styles.clearAllText}>Limpiar</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={styles.sheetScroll}>
              {renderFiltersContent
                ? renderFiltersContent({ onClose: () => setFiltersOpen(false) })
                : (
                  <Text style={styles.noFilters}>
                    No hay filtros configurados.
                  </Text>
                )}
            </ScrollView>
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setFiltersOpen(false)}
            >
              <Text style={styles.cancelText}>Cerrar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    height: 36,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  triggerLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
    color: '#FFFFFF',
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
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colorScales.gray[300],
    alignSelf: 'center',
    marginBottom: spacing[2],
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  sheetTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.md,
  },
  clearAllText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.error,
  },
  sheetScroll: {
    paddingHorizontal: spacing[2],
  },
  noFilters: {
    textAlign: 'center',
    color: colorScales.gray[500],
    fontStyle: 'italic',
    paddingVertical: spacing[6],
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  actionItemBorder: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    borderRadius: 0,
  },
  actionItemDisabled: {
    opacity: 0.5,
  },
  actionIcon: {
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
  actionLabelDestructive: {
    fontWeight: typography.fontWeight.bold,
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
