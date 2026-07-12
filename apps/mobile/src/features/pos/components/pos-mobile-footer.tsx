import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import type { PosMode } from '@/features/store/types';

interface PosMobileFooterProps {
  itemCount: number;
  total: number;
  taxAmount: number;
  mode: PosMode;
  onViewCart: () => void;
  onCustomItem: () => void;
  /** "Crear" — abre `pos-order-create-modal` (fulfillment + KDS guard). */
  onCreate: () => void;
  onShipping: () => void;
  /** Handler del CTA primario. Varía por modo: Cobrar / Crear cotización / Crear plan separé. */
  onPrimaryCta: () => void;
  canCreateCustomItems?: boolean;
}

// ── Mode-aware primary CTA metadata (paridad con `pos.component.ts` web) ──

interface PrimaryCtaMeta {
  label: string;
  icon: string;
  bg: string;
  shadow: string;
}

const PRIMARY_CTA_META: Record<PosMode, PrimaryCtaMeta> = {
  sale: {
    label: 'Cobrar',
    icon: 'credit-card',
    bg: colors.primary,
    shadow: colors.primary,
  },
  quotation: {
    label: 'Crear cotización',
    icon: 'file-text',
    bg: colors.primary,
    shadow: colors.primary,
  },
  layaway: {
    label: 'Crear plan separé',
    icon: 'calendar-clock',
    bg: colorScales.amber[600],
    shadow: colorScales.amber[600],
  },
};

export function PosMobileFooter({
  itemCount,
  total,
  taxAmount,
  mode,
  onViewCart,
  onCustomItem,
  onCreate,
  onShipping,
  onPrimaryCta,
  canCreateCustomItems = false,
}: PosMobileFooterProps) {
  const insets = useSafeAreaInsets();
  if (itemCount === 0) return null;

  const cta = PRIMARY_CTA_META[mode];

  return (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
      {/* Row 1: Cart Summary + View Detail Button */}
      <View style={styles.summaryRow}>
        <View style={styles.cartSummary}>
          <View style={styles.cartIconWrapper}>
            <Icon name="shopping-cart" size={20} color="#FFFFFF" />
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>
                {itemCount > 99 ? '99+' : itemCount}
              </Text>
            </View>
          </View>
          <View style={styles.cartTotals}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
            <Text style={styles.taxAmount}>
              IVA {formatCurrency(taxAmount)}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.viewDetailBtn}
          onPress={onViewCart}
        >
          <Text style={styles.viewDetailText}>Ver detalle</Text>
          <Icon name="chevron-up" size={16} color={colorScales.gray[500]} />
        </Pressable>
      </View>

      {/* Row 2: Secondary Action Buttons — paridad web: Ítem / Crear / Envío */}
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionBtn, styles.customItemBtn]}
          onPress={onCustomItem}
          disabled={!canCreateCustomItems}
        >
          <Icon name="file-plus" size={16} color={colors.primary} />
          <Text style={[styles.actionText, styles.customItemText]}>Ítem</Text>
        </Pressable>

        <Pressable
          style={[styles.actionBtn, styles.createBtn]}
          onPress={onCreate}
        >
          <Icon name="plus-circle" size={16} color={colorScales.gray[700]} />
          <Text style={styles.actionText}>Crear</Text>
        </Pressable>

        <Pressable
          style={[styles.actionBtn, styles.shippingBtn]}
          onPress={onShipping}
        >
          <Icon name="truck" size={16} color={colors.primary} />
          <Text style={[styles.actionText, styles.shippingText]}>Envío</Text>
        </Pressable>
      </View>

      {/* Row 3: Primary CTA — varía por modo */}
      <Pressable
        style={[styles.checkoutBtn, { backgroundColor: cta.bg, shadowColor: cta.shadow }]}
        onPress={onPrimaryCta}
      >
        <Icon name={cta.icon} size={18} color="#FFFFFF" />
        <Text style={styles.checkoutText}>{cta.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    padding: 10,
    paddingBottom: 20,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cartSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  cartIconWrapper: {
    position: 'relative',
    flexShrink: 0,
    width: 36,
    height: 36,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    backgroundColor: colors.error,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.background,
  },
  cartBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  cartTotals: {
    flexDirection: 'column',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[700],
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  taxAmount: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[600],
  },
  viewDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colorScales.gray[100],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  viewDetailText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
  },
  customItemBtn: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderColor: colorScales.green[200],
  },
  customItemText: {
    color: colorScales.green[700],
  },
  createBtn: {
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
  },
  shippingBtn: {
    backgroundColor: colors.background,
    borderColor: colorScales.green[200],
  },
  shippingText: {
    color: colorScales.green[700],
  },
  actionText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  checkoutText: {
    fontSize: 15,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
});
