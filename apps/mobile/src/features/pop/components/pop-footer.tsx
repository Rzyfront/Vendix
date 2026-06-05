import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import type { PopCartSummary } from '../types';

interface PopFooterProps {
  summary: PopCartSummary;
  itemCount: number;
  onOpenCart: () => void;
  onSaveDraft: () => void;
  onCreateOrder: () => void;
  onCreateAndReceive: () => void;
  isLoading?: boolean;
}

export default function PopFooter({
  summary,
  itemCount,
  onOpenCart,
  onSaveDraft,
  onCreateOrder,
  onCreateAndReceive,
  isLoading,
}: PopFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) + 10 }]}>
      {/* Row 1: Cart Summary + View Order Button */}
      <View style={styles.summaryRow}>
        <View style={styles.cartSummary}>
          <View style={styles.cartIconWrapper}>
            <Icon name="shopping-bag" size={20} color="#FFFFFF" />
            {itemCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>
                  {itemCount > 99 ? '99+' : itemCount}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.cartTotals}>
            <Text style={styles.totalLabel}>Total Estimado</Text>
            <Text style={styles.totalAmount}>{formatCurrency(summary.total)}</Text>
          </View>
        </View>

        <Pressable
          style={styles.viewOrderBtn}
          onPress={onOpenCart}
          disabled={itemCount === 0}
        >
          <Text style={styles.viewOrderText}>Ver orden</Text>
          <Icon name="chevron-up" size={16} color={colorScales.gray[500]} />
        </Pressable>
      </View>

      {/* Row 2: Borrador + Crear */}
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionBtn, styles.draftBtn]}
          onPress={onSaveDraft}
          disabled={itemCount === 0 || isLoading}
        >
          <Icon name="save" size={16} color={colorScales.gray[700]} />
          <Text style={styles.draftText}>Borrador</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.createBtn]}
          onPress={onCreateOrder}
          disabled={itemCount === 0 || isLoading}
        >
          <Icon name="file-plus" size={16} color="#FFFFFF" />
          <Text style={styles.createText}>Crear</Text>
        </Pressable>
      </View>

      {/* Row 3: Crear + Recibir (full-width, green) */}
      <Pressable
        style={[styles.actionBtn, styles.receiveBtn, styles.receiveBtnFull]}
        onPress={onCreateAndReceive}
        disabled={itemCount === 0 || isLoading}
      >
        <Icon name="package-check" size={18} color="#FFFFFF" />
        <Text style={styles.receiveText}>Crear + Recibir</Text>
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
    zIndex: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    paddingHorizontal: 12,
    paddingTop: 10,
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
    minWidth: 0,
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
    paddingHorizontal: 4,
    backgroundColor: colors.error,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
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
    minWidth: 0,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[500],
    lineHeight: 11,
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
    lineHeight: 22,
    overflow: 'hidden',
  },
  viewOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colorScales.gray[100],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    flexShrink: 0,
  },
  viewOrderText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    borderRadius: 12,
  },
  draftBtn: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  draftText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  createBtn: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  createText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: '#FFFFFF',
  },
  receiveBtn: {
    backgroundColor: '#22C55E',
  },
  receiveBtnFull: {
    width: '100%',
    height: 46,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  receiveText: {
    fontSize: 15,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
});
