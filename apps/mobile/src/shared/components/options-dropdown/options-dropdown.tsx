import { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Dimensions,
  ScrollView,
  type View as ViewType,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius, shadows } from '@/shared/theme';

// ── Interfaces (paridad con `options-dropdown.interfaces.ts` web) ─────────

export type FilterType = 'select' | 'multi-select' | 'date';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  placeholder?: string;
  disabled?: boolean;
  helpText?: string;
  defaultValue?: string | string[];
}

export type DropdownActionVariant = 'primary' | 'outline' | 'destructive';

export interface DropdownAction {
  label: string;
  icon: string;
  /**
   * Identificador emitido en `onActionClick` cuando el usuario hace tap.
   * Opcional si se usa `onPress` directo (compatibilidad con brands/categories
   * que ya tenían este patrón antes de la migración a `action`+`onActionClick`).
   */
  action?: string;
  /**
   * Click handler directo. Si se provee, se invoca en lugar de `onActionClick`.
   * Útil cuando la acción solo necesita navegar o mutar estado local.
   */
  onPress?: () => void;
  variant?: DropdownActionVariant;
  disabled?: boolean;
}

export type FilterValues = Record<string, string | string[] | null>;

interface OptionsDropdownProps {
  /** Filtros a mostrar en el dropdown de filtros. */
  filters?: FilterConfig[];
  /** Acciones a mostrar en el dropdown de acciones. */
  actions?: DropdownAction[];
  /** Mostrar el trigger de acciones. Default `true`. */
  showActions?: boolean;
  /** Estado actual de los filtros. */
  filterValues?: FilterValues;
  /** Título del dropdown de acciones. Default `'Acciones'`. */
  actionsTitle?: string;
  /** Título del dropdown de filtros. Default `'Filtros'`. */
  filtersTitle?: string;
  /** Debounce (ms) entre cambios de filtro antes de emitir `onFilterChange`. Default `350`. */
  debounceMs?: number;
  /** Estado de carga (deshabilita interacciones y muestra spinner simple). */
  isLoading?: boolean;
  /** Callback cuando un filtro cambia (después del debounce). */
  onFilterChange?: (values: FilterValues) => void;
  /** Callback cuando se hace click en una acción. */
  onActionClick?: (actionKey: string) => void;
  /** Callback cuando se hace click en "Limpiar" filtros. */
  onClearAllFilters?: () => void;
}

// ── Tokens de tamaño ──────────────────────────────────────────────────────

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_MARGIN = 12;
const DROPDOWN_WIDTH = Math.min(280, SCREEN_WIDTH - SCREEN_MARGIN * 2);
const DROPDOWN_GAP = 4;
const TRIGGER_WIDTH = 40;
const TRIGGER_GAP = spacing[2]; // 8px (web: `gap: 0.5rem`)

// ── Color helpers ─────────────────────────────────────────────────────────

const VARIANT_COLOR = {
  primary: colors.primary,
  outline: colorScales.gray[700],
  destructive: colors.error,
} as const;

interface TriggerPos {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Dropdown dual con dos triggers lado a lado — paridad exacta con
 * `<app-options-dropdown>` web (`apps/frontend/src/app/shared/components/options-dropdown/`).
 *
 * ## Estructura
 * ```
 * [⚡ Acciones] [⚙ Filtros (badge)]   ← triggers (icon-only mobile)
 *       ↓                  ↓
 *   popover A          popover B
 *   ┌────────┐         ┌────────┐
 *   │Acciones│         │Filtros 🧹│
 *   ├────────┤         ├────────┤
 *   │+ Nuevo │         │ Estado  │
 *   │⟳ Actual│         │ [select]│
 *   └────────┘         │ Tipo    │
 *                      │ [select]│
 *                      └────────┘
 * ```
 *
 * ## Comportamiento
 * - Cada trigger abre SU propio popover (no se interfieren).
 * - Click en backdrop cierra cualquier popover abierto.
 * - Cambios de filtro se emiten con debounce (default 350ms — paridad web).
 * - Variantes de action: `primary` (texto verde), `outline` (gris), `destructive` (rojo).
 * - Filter header muestra botón "Limpiar" sólo si hay filtros activos.
 *
 * ## Mobile responsive (< 1024px)
 * Los triggers son icon-only con borde primary (cuadrados 40px, radius 12px).
 * En desktop el web muestra trigger con label, pero en mobile-first ambos son icon-only.
 */
export function OptionsDropdown({
  filters = [],
  actions = [],
  showActions = true,
  filterValues = {},
  actionsTitle = 'Acciones',
  filtersTitle = 'Filtros',
  debounceMs = 350,
  isLoading = false,
  onFilterChange,
  onActionClick,
  onClearAllFilters,
}: OptionsDropdownProps) {
  const [openMenu, setOpenMenu] = useState<'actions' | 'filters' | null>(null);
  const [triggerPos, setTriggerPos] = useState<{ actions: TriggerPos | null; filters: TriggerPos | null }>({
    actions: null,
    filters: null,
  });
  const [localValues, setLocalValues] = useState<FilterValues>(filterValues);

  const actionsTriggerRef = useRef<ViewType>(null);
  const filtersTriggerRef = useRef<ViewType>(null);

  // ── Sync external filterValues → local state ─────────────────────────
  useMemo(() => {
    setLocalValues(filterValues);
  }, [filterValues]);

  // ── Active filters count ─────────────────────────────────────────────
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    for (const cfg of filters) {
      const value = localValues[cfg.key];
      if (Array.isArray(value)) {
        if (value.length > 0) count++;
      } else {
        if (value && value !== '') count++;
      }
    }
    return count;
  }, [filters, localValues]);

  const hasActiveFilter = (key: string): boolean => {
    const value = localValues[key];
    if (Array.isArray(value)) return value.length > 0;
    return !!value && value !== '';
  };

  // ── Trigger open/close ────────────────────────────────────────────────
  const measureTrigger = (ref: ViewType | null, which: 'actions' | 'filters') => {
    if (!ref) return;
    ref.measureInWindow((x, y, width, height) => {
      setTriggerPos((prev) => ({ ...prev, [which]: { x, y, width, height } }));
      setOpenMenu(which);
    });
  };

  const handleOpenActions = () => {
    if (openMenu === 'actions') {
      setOpenMenu(null);
      return;
    }
    measureTrigger(actionsTriggerRef.current, 'actions');
  };

  const handleOpenFilters = () => {
    if (openMenu === 'filters') {
      setOpenMenu(null);
      return;
    }
    measureTrigger(filtersTriggerRef.current, 'filters');
  };

  const handleClose = () => setOpenMenu(null);

  // ── Dropdown positioning (smart, evita overflow) ──────────────────────
  const dropdownPosition = useMemo(() => {
    if (!openMenu || !triggerPos[openMenu]) return null;
    const pos = triggerPos[openMenu]!;

    // Prefer right-aligned (matches web `right: 0`).
    let left = pos.x + pos.width - DROPDOWN_WIDTH;
    if (left < SCREEN_MARGIN) {
      left = pos.x;
      if (left + DROPDOWN_WIDTH > SCREEN_WIDTH - SCREEN_MARGIN) {
        left = SCREEN_WIDTH - DROPDOWN_WIDTH - SCREEN_MARGIN;
      }
    }
    const top = pos.y + pos.height + DROPDOWN_GAP;
    return { top, left };
  }, [openMenu, triggerPos]);

  // ── Action click ──────────────────────────────────────────────────────
  const handleActionClick = (actionKey: string) => {
    setOpenMenu(null);
    setTimeout(() => onActionClick?.(actionKey), 120);
  };

  // ── Filter change with debounce ───────────────────────────────────────
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFilterChange = (key: string, value: string | string[] | null) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      onFilterChange?.({ ...localValues, [key]: value });
    }, debounceMs);
  };

  const handleClearFilter = (key: string) => {
    const cfg = filters.find((f) => f.key === key);
    const cleared = cfg?.type === 'multi-select' ? [] : null;
    setLocalValues((prev) => ({ ...prev, [key]: cleared }));
    onFilterChange?.({ ...localValues, [key]: cleared });
  };

  const handleClearAll = () => {
    const cleared: FilterValues = {};
    for (const cfg of filters) {
      cleared[cfg.key] = cfg.type === 'multi-select' ? [] : null;
    }
    setLocalValues(cleared);
    onClearAllFilters?.();
  };

  return (
    <View style={styles.container}>
      {/* ── Actions trigger (order 1 — paridad web) ── */}
      {showActions && actions.length > 0 && (
        <Pressable
          ref={actionsTriggerRef}
          onPress={handleOpenActions}
          hitSlop={8}
          accessibilityLabel="Acciones"
          style={({ pressed }) => [
            styles.trigger,
            openMenu === 'actions' && styles.triggerActive,
            pressed && styles.triggerPressed,
          ]}
        >
          <Icon name="plus" size={iconSizeFor(actions.length)} color={colors.primary} />
        </Pressable>
      )}

      {/* ── Filters trigger (order 2 — paridad web) ── */}
      {filters.length > 0 && (
        <Pressable
          ref={filtersTriggerRef}
          onPress={handleOpenFilters}
          hitSlop={8}
          accessibilityLabel="Filtros"
          style={({ pressed }) => [
            styles.trigger,
            openMenu === 'filters' && styles.triggerActive,
            pressed && styles.triggerPressed,
          ]}
        >
          <Icon name="filter" size={18} color={colors.primary} />
          {activeFiltersCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeFiltersCount}</Text>
            </View>
          )}
        </Pressable>
      )}

      {/* ── Popover ── */}
      <Modal
        visible={openMenu !== null}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          {dropdownPosition && openMenu === 'actions' && (
            <Pressable
              style={[styles.dropdown, { top: dropdownPosition.top, left: dropdownPosition.left }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.header}>
                <Text style={styles.headerTitle}>{actionsTitle}</Text>
              </View>
              <View style={styles.actionList}>
                {actions.map((action) => {
                  const variant = action.variant ?? 'outline';
                  const isDestructive = variant === 'destructive';
                  const isPrimary = variant === 'primary';
                  const color = isDestructive
                    ? colors.error
                    : isPrimary
                      ? colors.primary
                      : VARIANT_COLOR.outline;

                  return (
                    <Pressable
                      key={action.action ?? action.label}
                      disabled={action.disabled}
                      style={({ pressed }) => [
                        styles.actionItem,
                        pressed && styles.actionItemPressed,
                        isDestructive && pressed && styles.actionItemDestructivePressed,
                      ]}
                      onPress={() => {
                        if (action.onPress) {
                          setOpenMenu(null);
                          setTimeout(() => action.onPress?.(), 120);
                        } else if (action.action) {
                          handleActionClick(action.action);
                        }
                      }}
                    >
                      <Icon name={action.icon} size={16} color={color} />
                      <Text
                        style={[
                          styles.actionLabel,
                          isPrimary && { color: colors.primary },
                          isDestructive && { color: colors.error },
                          action.disabled && { opacity: 0.5 },
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

          {dropdownPosition && openMenu === 'filters' && (
            <Pressable
              style={[styles.dropdown, { top: dropdownPosition.top, left: dropdownPosition.left }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.header}>
                <Text style={styles.headerTitle}>{filtersTitle}</Text>
                {activeFiltersCount > 0 && (
                  <Pressable
                    onPress={handleClearAll}
                    style={({ pressed }) => [styles.clearAllBtn, pressed && { opacity: 0.6 }]}
                  >
                    <Icon name="x" size={12} color={colorScales.gray[500]} />
                    <Text style={styles.clearAllText}>Limpiar</Text>
                  </Pressable>
                )}
              </View>

              <ScrollView style={styles.filtersBody} contentContainerStyle={styles.filtersBodyContent}>
                {filters.map((cfg) => (
                  <View key={cfg.key} style={styles.filterSection}>
                    <View style={styles.filterSectionHeader}>
                      <Text style={styles.filterLabel}>{cfg.label}</Text>
                      {hasActiveFilter(cfg.key) && (
                        <Pressable
                          onPress={() => handleClearFilter(cfg.key)}
                          style={({ pressed }) => [styles.clearFilterBtn, pressed && { opacity: 0.6 }]}
                        >
                          <Icon name="x" size={12} color={colorScales.gray[400]} />
                        </Pressable>
                      )}
                    </View>

                    {/* Select simple: lista de opciones como pressables */}
                    {cfg.type === 'select' && cfg.options && (
                      <View style={styles.optionsList}>
                        {cfg.options.map((opt) => {
                          const isActive = localValues[cfg.key] === opt.value;
                          return (
                            <Pressable
                              key={opt.value || '__empty__'}
                              onPress={() => handleFilterChange(cfg.key, opt.value || null)}
                              style={({ pressed }) => [
                                styles.optionItem,
                                pressed && styles.optionItemPressed,
                                isActive && styles.optionItemActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.optionLabel,
                                  isActive && styles.optionLabelActive,
                                ]}
                                numberOfLines={1}
                              >
                                {opt.label}
                              </Text>
                              {isActive && <Icon name="check" size={14} color={colors.primary} />}
                            </Pressable>
                          );
                        })}
                      </View>
                    )}

                    {cfg.helpText && (
                      <Text style={styles.filterHelpText}>{cfg.helpText}</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

// Web responsive usa iconos de 16px cuando hay pocas acciones, 18px cuando hay más.
// Como la mayoría de casos tendrá 1-3 acciones, usamos 16.
function iconSizeFor(actionCount: number): number {
  return actionCount > 3 ? 18 : 16;
}

const styles = StyleSheet.create({
  // ── Container — flex row con gap (paridad web `gap: 0.5rem`) ──
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TRIGGER_GAP,
  },

  // ── Triggers (icon-only mobile) — paridad con `.options-dropdown-trigger` <1024px ──
  trigger: {
    width: TRIGGER_WIDTH,
    height: TRIGGER_WIDTH,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    position: 'relative',
  },
  triggerActive: {
    backgroundColor: colors.primaryLight, // web: active visual feedback
  },
  triggerPressed: {
    transform: [{ scale: 0.98 }],
  },

  // ── Badge — paridad con `.filter-count-badge` web ──
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
  },

  // ── Backdrop ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },

  // ── Dropdown container — paridad con `.options-dropdown-content` ──
  dropdown: {
    position: 'absolute',
    width: DROPDOWN_WIDTH,
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
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
    paddingHorizontal: spacing[4],
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
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[1] + 1,
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.sm,
  },
  clearAllText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium,
  },

  // ── Action list — paridad con `.actions-list` ──
  actionList: {
    padding: spacing[2],
    gap: 2,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2.5],
    borderRadius: borderRadius.sm,
  },
  actionItemPressed: {
    backgroundColor: colors.background,
  },
  actionItemDestructivePressed: {
    backgroundColor: '#FEF2F2',
  },
  actionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },

  // ── Filters body — paridad con `.filters-body` ──
  filtersBody: {
    maxHeight: 320,
  },
  filtersBodyContent: {
    padding: spacing[3] + 2,
    gap: spacing[3],
  },
  filterSection: {
    gap: spacing[2],
  },
  filterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  filterLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
  clearFilterBtn: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
  },
  filterHelpText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  optionsList: {
    gap: 2,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2] + 2,
    borderRadius: borderRadius.sm,
  },
  optionItemPressed: {
    backgroundColor: colors.background,
  },
  optionItemActive: {
    backgroundColor: colors.primaryLight,
  },
  optionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
  optionLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
});