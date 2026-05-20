import React from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, Image } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import type { CartItem as StoreCartItem } from '@/features/store/types';

type CartItem = StoreCartItem;

interface PosCartModalProps {
  visible: boolean;
  onClose: () => void;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  onIncreaseQuantity: (id: string) => void;
  onDecreaseQuantity: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onClearCart: () => void;
  onViewDetail: () => void;
  onSaveDraft: () => void;
  onCheckout: () => void;
}

export function PosCartModal({
  visible,
  onClose,
  items,
  subtotal,
  taxAmount,
  total,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onRemoveItem,
  onClearCart,
  onViewDetail,
  onSaveDraft,
  onCheckout,
}: PosCartModalProps) {
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.modalContent}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} style={styles.backBtn}>
            <Icon name="chevron-left" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <Text style={styles.modalTitle}>
            Carrito
            <Text style={styles.itemCount}>({items.length})</Text>
          </Text>
          <Pressable
            onPress={onClearCart}
            disabled={items.length === 0}
            style={[styles.clearBtn, items.length === 0 && styles.clearBtnDisabled]}
          >
            <Text style={styles.clearBtnText}>Vaciar</Text>
          </Pressable>
        </View>

        {/* Items List */}
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="shopping-cart" size={40} color={colorScales.gray[300]} />
            <Text style={styles.emptyText}>Tu carrito está vacío</Text>
            <Text style={styles.emptyHint}>Selecciona productos para comenzar</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={styles.itemsList}
            renderItem={({ item }) => (
              <View style={styles.cartItem}>
                {/* Product Image */}
                <View style={styles.itemImage}>
                  {item.product.image_url ? (
                    <Image
                      source={{ uri: item.product.image_url }}
                      style={styles.itemImageImg}
                    />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Icon name="image" size={18} color={colorScales.gray[400]} />
                    </View>
                  )}
                </View>

                {/* Item Info */}
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.product.name}
                  </Text>
                  {item.variant_display_name && (
                    <Text style={styles.variantName} numberOfLines={1}>
                      {item.variant_display_name}
                    </Text>
                  )}
                  <Text style={styles.unitPrice}>
                    {formatCurrency(item.finalPrice)} c/u
                  </Text>
                </View>

                {/* Remove Button */}
                <Pressable
                  onPress={() => onRemoveItem(item.id)}
                  style={styles.removeBtn}
                >
                  <Icon name="x" size={16} color={colorScales.gray[400]} />
                </Pressable>

                {/* Actions Row: Quantity + Total */}
                <View style={styles.itemActions}>
                  <View style={styles.qtyControls}>
                    <Pressable
                      onPress={() => onDecreaseQuantity(item.id)}
                      style={[styles.qtyBtn, styles.qtyBtnMinus]}
                    >
                      <Icon name="minus" size={14} color={colorScales.gray[600]} />
                    </Pressable>
                    <Text style={styles.qtyLabel}>{item.quantity}</Text>
                    <Pressable
                      onPress={() => onIncreaseQuantity(item.id)}
                      style={[styles.qtyBtn, styles.qtyBtnPlus]}
                    >
                      <Icon name="plus" size={14} color={colors.primary} />
                    </Pressable>
                  </View>
                  <Text style={styles.itemTotal}>
                    {formatCurrency(item.totalPrice)}
                  </Text>
                </View>
              </View>
            )}
          />
        )}

        {/* Summary Section */}
        {items.length > 0 && (
          <View style={styles.summarySection}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>IVA / impuestos</Text>
              <Text style={styles.summaryValue}>{formatCurrency(taxAmount)}</Text>
            </View>
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
            </View>

            <View style={styles.summaryActions}>
              <Pressable style={styles.summarySaveBtn} onPress={onSaveDraft}>
                <Icon name="save" size={16} color={colors.primary} />
                <Text style={styles.summarySaveText}>Guardar</Text>
              </Pressable>
              <Pressable style={styles.summaryCheckoutBtn} onPress={onCheckout}>
                <Icon name="credit-card" size={18} color="#FFFFFF" />
                <Text style={styles.summaryCheckoutText}>Finalizar Venta</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    zIndex: 100,
  },
  modalContent: {
    flex: 1,
    flexDirection: 'column',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  backBtn: {
    width: 40,
    alignItems: 'flex-start',
  },
  modalTitle: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    textAlign: 'center',
  },
  itemCount: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.normal as any,
    color: colorScales.gray[500],
  },
  clearBtn: {
    width: 60,
    alignItems: 'flex-end',
  },
  clearBtnDisabled: {
    opacity: 0.4,
  },
  clearBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colors.error,
    fontFamily: typography.fontFamily,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
  },
  emptyText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginTop: spacing[3],
  },
  emptyHint: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
  itemsList: {
    flex: 1,
  },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  itemImage: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[100],
    overflow: 'hidden',
    marginRight: spacing[3],
  },
  itemImageImg: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  itemName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  variantName: {
    fontSize: 11,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
    marginTop: 2,
  },
  unitPrice: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  removeBtn: {
    padding: spacing[1],
    marginRight: spacing[2],
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnMinus: {
    backgroundColor: colorScales.gray[100],
  },
  qtyBtnPlus: {
    backgroundColor: colorScales.green[100],
  },
  qtyLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    marginHorizontal: spacing[2],
    width: 20,
    textAlign: 'center',
  },
  itemTotal: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    width: 70,
    textAlign: 'right',
  },
  summarySection: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing[1],
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  totalRow: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  totalLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  totalAmount: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  summaryActions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[4],
  },
  summarySaveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  summarySaveText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  summaryCheckoutBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  summaryCheckoutText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
