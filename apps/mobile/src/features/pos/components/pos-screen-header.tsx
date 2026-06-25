import { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  Dimensions,
  type View as ViewType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius, shadows } from '@/shared/theme';
import type { PosCustomer, PosMode } from '@/features/store/types';

interface PosScreenHeaderProps {
  /** Modo actual del POS — controla título + badge. */
  mode: PosMode;
  /** Cliente seleccionado (muestra chip a la derecha). */
  customer: PosCustomer | null;
  /** Click en el chip de cliente (abre `PosCustomerModal`). */
  onOpenCustomer: () => void;
  /** Limpiar el cliente seleccionado. */
  onClearCustomer: () => void;
  /** Cambia el modo del POS. */
  onChangeMode: (mode: PosMode) => void;
  /** Total del carrito (mostrado en el badge del CTA si > 0). */
  cartItemCount?: number;
}

// ── Mode metadata (paridad con `pos.component.ts` web) ────────────────────

interface ModeMeta {
  title: string;
  subtitle: string;
  badgeLabel: string;
  badgeVariant: 'primary' | 'warning' | 'success';
  primaryCta: string;
  primaryCtaIcon: string;
}

const MODE_META: Record<PosMode, ModeMeta> = {
  sale: {
    title: 'POS',
    subtitle: 'Punto de venta',
    badgeLabel: 'Punto de venta',
    badgeVariant: 'success',
    primaryCta: 'Cobrar',
    primaryCtaIcon: 'credit-card',
  },
  quotation: {
    title: 'Modo Cotización',
    subtitle: 'Crear cotización',
    badgeLabel: 'Crear cotización',
    badgeVariant: 'primary',
    primaryCta: 'Crear cotización',
    primaryCtaIcon: 'file-text',
  },
  layaway: {
    title: 'Modo Plan Separé',
    subtitle: 'Crear plan separé',
    badgeLabel: 'Crear plan separé',
    badgeVariant: 'warning',
    primaryCta: 'Crear plan separé',
    primaryCtaIcon: 'calendar-clock',
  },
};

const BADGE_COLORS = {
  primary: { bg: 'rgba(34, 197, 94, 0.12)', fg: colors.primary, border: 'rgba(34, 197, 94, 0.3)' },
  success: { bg: 'rgba(22, 163, 74, 0.12)', fg: colorScales.green[600], border: 'rgba(22, 163, 74, 0.3)' },
  warning: { bg: 'rgba(245, 158, 11, 0.12)', fg: colorScales.amber[600], border: 'rgba(245, 158, 11, 0.3)' },
} as const;

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_MARGIN = 12;
const DROPDOWN_WIDTH = Math.min(220, SCREEN_WIDTH - SCREEN_MARGIN * 2);
const DROPDOWN_GAP = 4;

/**
 * Header específico del POS — paridad con el bloque inline del web
 * `pos.component.ts` (líneas 159-209):
 *
 * ```
 * [🛍 Vendix] POS                    [customer chip] [⋯ modes]
 *         [Punto de venta badge]
 * ```
 *
 * - **Logo tile**: 40×40, `bg-primary/10`, `shopping-bag` icon (espejo de
 *   `<div class="w-10 h-10 rounded-xl bg-primary/10">`).
 * - **Title**: varía por modo (`POS` / `Modo Cotización` / `Modo Plan Separé`).
 * - **Badge**: pill `xs` con variante `primary | warning | success`.
 * - **Customer chip**: avatar + nombre + email + X para limpiar — mismo
 *   patrón que el chip del header web (gradient `from-primary-light/50
 *   to-primary-light/30`).
 * - **Mode switcher**: ícono `more-horizontal` (⋮) que abre un popover con
 *   las 3 opciones — espejo del dropdown de modos del web.
 * - **iOS-blur**: aproximado con `rgba(255,255,255,0.92)` + `border-bottom`
 *   + `shadow-sm` (RN no soporta `backdrop-filter` cross-platform).
 *
 * @see `apps/frontend/src/app/private/modules/store/pos/pos.component.ts`
 */
export function PosScreenHeader({
  mode,
  customer,
  onOpenCustomer,
  onClearCustomer,
  onChangeMode,
}: PosScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [triggerPos, setTriggerPos] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<ViewType>(null);

  const meta = MODE_META[mode];
  const badgeColors = BADGE_COLORS[meta.badgeVariant];

  const handleOpenModeMenu = () => {
    const node = triggerRef.current;
    if (!node) return;
    if (modeMenuOpen) {
      setModeMenuOpen(false);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setTriggerPos({ x, y, width, height });
      setModeMenuOpen(true);
    });
  };

  const handleSelectMode = (next: PosMode) => {
    setModeMenuOpen(false);
    setTimeout(() => onChangeMode(next), 120);
  };

  // Dropdown position (right-aligned, mirrors RowActionsMenu pattern)
  const dropdownPosition = (() => {
    if (!triggerPos) return null;
    let left = triggerPos.x + triggerPos.width - DROPDOWN_WIDTH;
    if (left < SCREEN_MARGIN) left = SCREEN_MARGIN;
    if (left + DROPDOWN_WIDTH > SCREEN_WIDTH - SCREEN_MARGIN) {
      left = SCREEN_WIDTH - DROPDOWN_WIDTH - SCREEN_MARGIN;
    }
    return { top: triggerPos.y + triggerPos.height + DROPDOWN_GAP, left };
  })();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      {/* ── Left: Logo + Title + Badge ── */}
      <View style={styles.left}>
        <View style={styles.logoTile}>
          <Icon name="shopping-bag" size={20} color={colors.primary} />
        </View>
        <View style={styles.titleStack}>
          <Text style={styles.title} numberOfLines={1}>
            {meta.title}
          </Text>
          <View style={[styles.badge, { backgroundColor: badgeColors.bg, borderColor: badgeColors.border }]}>
            <Text style={[styles.badgeText, { color: badgeColors.fg }]} numberOfLines={1}>
              {meta.badgeLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* ── Right: Customer chip + Mode switcher ── */}
      <View style={styles.right}>
        {customer ? (
          <Pressable
            onPress={onOpenCustomer}
            style={({ pressed }) => [styles.customerChip, pressed && styles.customerChipPressed]}
          >
            <View style={styles.customerAvatar}>
              <Icon name="user" size={14} color={colors.primary} />
            </View>
            <View style={styles.customerText}>
              <Text style={styles.customerName} numberOfLines={1}>
                {customer.first_name} {customer.last_name}
              </Text>
              {customer.email ? (
                <Text style={styles.customerEmail} numberOfLines={1}>
                  {customer.email}
                </Text>
              ) : null}
            </View>
            <Pressable
              hitSlop={6}
              onPress={(e) => {
                e.stopPropagation?.();
                onClearCustomer();
              }}
              style={({ pressed }) => [styles.customerClear, pressed && { opacity: 0.6 }]}
            >
              <Icon name="x" size={14} color={colorScales.gray[500]} />
            </Pressable>
          </Pressable>
        ) : (
          <Pressable
            onPress={onOpenCustomer}
            style={({ pressed }) => [styles.customerAdd, pressed && styles.customerAddPressed]}
          >
            <Icon name="user-plus" size={16} color={colors.primary} />
          </Pressable>
        )}

        <Pressable
          ref={triggerRef}
          onPress={handleOpenModeMenu}
          hitSlop={8}
          accessibilityLabel="Cambiar modo POS"
          style={({ pressed }) => [styles.modeBtn, pressed && styles.modeBtnPressed]}
        >
          <Icon name="more-vertical" size={18} color={colorScales.gray[700]} />
        </Pressable>
      </View>

      {/* ── Mode switcher popover ── */}
      <Modal
        visible={modeMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModeMenuOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setModeMenuOpen(false)}>
          {dropdownPosition && (
            <Pressable
              style={[styles.dropdown, { top: dropdownPosition.top, left: dropdownPosition.left }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.dropdownHeader}>
                <Text style={styles.dropdownHeaderTitle}>Modo</Text>
              </View>
              <View style={styles.dropdownList}>
                {(Object.keys(MODE_META) as PosMode[]).map((m) => {
                  const mMeta = MODE_META[m];
                  const isActive = m === mode;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => handleSelectMode(m)}
                      style={({ pressed }) => [
                        styles.dropdownItem,
                        pressed && styles.dropdownItemPressed,
                      ]}
                    >
                      <Icon name={mMeta.primaryCtaIcon} size={16} color={isActive ? colors.primary : colorScales.gray[700]} />
                      <Text style={[styles.dropdownItemLabel, isActive && styles.dropdownItemLabelActive]} numberOfLines={1}>
                        {mMeta.subtitle}
                      </Text>
                      {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Container — iOS-blur approximation ──
  // Web: `backdrop-filter: blur(20px); background: rgba(255,255,255,0.85)`.
  // RN no soporta backdrop-filter cross-platform → aproximamos con
  // background translúcido + border-bottom + shadow-sm.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[3],
    ...shadows.sm,
  },

  // ── Left: logo + title + badge ──
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    flex: 1,
    minWidth: 0,
  },
  // Web: `w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-primary/10`. Mobile usa 40.
  logoTile: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  titleStack: {
    flexDirection: 'column',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  // Web: `<h1 class="font-bold text-text-primary text-base lg:text-lg">`.
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    letterSpacing: -0.2,
    lineHeight: 20,
  },
  // Web: `<app-badge variant="primary|warning|success" size="xs">`.
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    letterSpacing: 0.2,
  },

  // ── Right: customer chip + mode switcher ──
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexShrink: 0,
  },
  // Web: `bg-gradient-to-r from-primary-light/50 to-primary-light/30
  //       border border-primary/30 rounded-lg shadow-sm`.
  customerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[1.5],
    paddingLeft: spacing[1.5],
    paddingRight: spacing[1],
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.30)',
    maxWidth: 200,
  },
  customerChipPressed: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
  },
  customerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(34, 197, 94, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  customerText: {
    flex: 1,
    minWidth: 0,
  },
  customerName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    lineHeight: 14,
  },
  customerEmail: {
    fontSize: 10,
    color: colorScales.gray[500],
    lineHeight: 12,
    marginTop: 2,
  },
  customerClear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  customerAdd: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerAddPressed: {
    backgroundColor: 'rgba(34, 197, 94, 0.18)',
  },
  modeBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  modeBtnPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: colorScales.gray[100],
  },

  // ── Mode switcher dropdown ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
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
  dropdownHeader: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  dropdownHeaderTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dropdownList: {
    padding: spacing[2],
    gap: 2,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2.5],
    borderRadius: borderRadius.sm,
  },
  dropdownItemPressed: {
    backgroundColor: colors.background,
  },
  dropdownItemLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
  dropdownItemLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
});