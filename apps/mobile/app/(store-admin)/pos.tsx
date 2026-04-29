import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Image,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { apiClient, Endpoints } from '@/core/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductService } from '@/features/store/services';
import { OrderService } from '@/features/store/services';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { formatCurrency } from '@/shared/utils/currency';
import { colors, colorScales, spacing, borderRadius, shadows, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import type { Product, ProductVariant, PosCustomer } from '@/features/store/types';

const ITEM_WIDTH = '48%';

const productCardStyles = StyleSheet.create({
  card: {
    width: '48%' as any,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginBottom: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    ...shadows.sm,
  },
  imageArea: {
    width: '100%',
    height: 96,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  name: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[1],
  },
  price: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  lowStock: {
    fontSize: typography.fontSize.xs,
    marginTop: spacing[1],
    color: colors.warning,
  },
  outOfStock: {
    fontSize: typography.fontSize.xs,
    marginTop: spacing[1],
    fontWeight: typography.fontWeight.medium,
    color: colors.error,
  },
  firstLetter: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
});

const s = StyleSheet.create({
  containerPad: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[1],
  },
  sectionSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[4],
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  flex1: { flex: 1 },
  variantName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
  },
  skuText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  itemsEnd: { alignItems: 'flex-end' },
  variantPrice: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  outOfStockText: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
  },
  stockText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  separator: {
    height: 1,
    backgroundColor: colorScales.gray[100],
  },
  cartItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  cartItemInfo: {
    flex: 1,
    marginRight: spacing[3],
  },
  cartItemName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  cartItemVariant: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  cartItemUnitPrice: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginTop: spacing[0.5],
  },
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing[3],
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnMinus: {
    backgroundColor: colorScales.gray[100],
  },
  qtyBtnPlus: {
    backgroundColor: colors.primary + '20',
  },
  qtyLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    marginHorizontal: spacing[3],
    width: 24,
    textAlign: 'center',
  },
  cartItemTotal: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    width: 80,
    textAlign: 'right',
  },
  removeBtn: {
    marginLeft: spacing[2],
    padding: spacing[1],
  },
  customerRow: {
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  customerName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  customerContact: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  noClientText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.error,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacing[4],
    color: colorScales.gray[400],
  },
  cartPanelContent: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  cartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[4],
  },
  cartTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  customerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  customerBtnText: {
    fontSize: typography.fontSize.sm,
    color: '#1D4ED8',
    fontWeight: typography.fontWeight.medium,
    marginLeft: spacing[2],
    flex: 1,
  },
  selectLabel: {
    fontSize: typography.fontSize.xs,
    color: '#2563EB',
    marginRight: spacing[2],
  },
  cartFlatList: {
    flex: 1,
  },
  summarySection: {
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing[1],
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  discountText: {
    fontSize: typography.fontSize.sm,
    color: '#16A34A',
  },
  addDiscountBtn: {
    paddingVertical: spacing[2],
  },
  addDiscountText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  totalLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  totalValue: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  chargeBtn: {
    marginTop: spacing[4],
  },
  paymentTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[4],
  },
  totalBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  totalBoxLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  totalBoxValue: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  methodBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 2,
  },
  methodBtnActive: {
    borderColor: colors.primary,
    backgroundColor: '#F0FDF4',
  },
  methodBtnInactive: {
    borderColor: colorScales.gray[200],
    backgroundColor: '#FFFFFF',
  },
  methodLabel: {
    marginLeft: spacing[2],
    fontWeight: typography.fontWeight.semibold,
  },
  methodLabelActive: {
    color: '#15803D',
  },
  methodLabelInactive: {
    color: colorScales.gray[500],
  },
  cashSection: {
    marginBottom: spacing[4],
  },
  changeBox: {
    marginTop: spacing[2],
    backgroundColor: '#EFF6FF',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  changeLabel: {
    fontSize: typography.fontSize.sm,
    color: '#2563EB',
    fontWeight: typography.fontWeight.medium,
  },
  changeValue: {
    fontSize: typography.fontSize.sm,
    color: '#1D4ED8',
    fontWeight: typography.fontWeight.bold,
  },
  successOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 50,
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius['2xl'],
    padding: spacing[6],
    marginHorizontal: spacing[8],
    alignItems: 'center',
    ...shadows.xl,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
    backgroundColor: colors.primary + '20',
  },
  successTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[1],
  },
  successSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  orderNumber: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
    marginBottom: spacing[4],
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing[3],
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  actionBtnText: {
    marginLeft: spacing[2],
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[600],
  },
  posRoot: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  searchWrapper: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical: 14,
    ...shadows.lg,
  },
  fabLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabBadge: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  fabBadgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: '#FFFFFF',
  },
  fabCountText: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
  },
  fabRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fabTotalText: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.bold,
    fontSize: typography.fontSize.lg,
    marginRight: spacing[2],
  },
  fabCartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  fabCartText: {
    color: '#FFFFFF',
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    marginRight: spacing[1],
  },
  discountSection: {
    marginTop: spacing[4],
  },
});

async function searchCustomers(query: string): Promise<PosCustomer[]> {
  if (!query.trim()) return [];
  try {
    const res = await apiClient.get(`${Endpoints.STORE.CUSTOMERS.SEARCH}?search=${encodeURIComponent(query)}&limit=20`);
    const data = (res.data as any);
    if (data?.success !== false && Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    return [];
  } catch {
    return [];
  }
}

function generateReceiptHtml(order: { orderNumber: string; items: any[]; summary: any; customer?: PosCustomer | null; paymentMethod: string }): string {
  const date = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const itemsHtml = order.items.map((item: any) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.product?.name || ''} ${item.variant_display_name ? `(${item.variant_display_name})` : ''}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${item.unitPrice.toLocaleString('es-CO')}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${item.totalPrice.toLocaleString('es-CO')}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; }
        h1 { font-size: 18px; text-align: center; margin-bottom: 5px; }
        .header { text-align: center; margin-bottom: 20px; }
        .order-info { font-size: 12px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { background: #f5f5f5; padding: 8px; text-align: left; }
        .totals { margin-top: 20px; }
        .row { display: flex; justify-content: space-between; padding: 5px 0; }
        .total-row { font-weight: bold; font-size: 16px; border-top: 1px solid #333; padding-top: 10px; margin-top: 5px; }
        .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #999; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Vendix</h1>
        <div class="order-info">Orden #${order.orderNumber}<br>${date}</div>
      </div>
      ${order.customer ? `<p><strong>Cliente:</strong> ${order.customer.first_name} ${order.customer.last_name}</p>` : ''}
      <table>
        <thead>
          <tr>
            <th style="padding: 8px;">Producto</th>
            <th style="padding: 8px; text-align: center;">Cant</th>
            <th style="padding: 8px; text-align: right;">Precio</th>
            <th style="padding: 8px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="totals">
        <div class="row"><span>Subtotal:</span><span>$${order.summary.subtotal.toLocaleString('es-CO')}</span></div>
        <div class="row"><span>IVA:</span><span>$${order.summary.taxAmount.toLocaleString('es-CO')}</span></div>
        ${order.summary.discountAmount > 0 ? `<div class="row" style="color: green;"><span>Descuento:</span><span>-$${order.summary.discountAmount.toLocaleString('es-CO')}</span></div>` : ''}
        <div class="row total-row"><span>Total:</span><span>$${order.summary.total.toLocaleString('es-CO')}</span></div>
        <div class="row" style="margin-top: 10px; font-size: 12px;"><span>Método:</span><span>${order.paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</span></div>
      </div>
      <div class="footer">¡Gracias por su compra!</div>
    </body>
    </html>
  `;
}

const ProductCard = ({
  product,
  onPress,
}: {
  product: Product;
  onPress: (product: Product) => void;
}) => {
  const firstLetter = product.name?.charAt(0)?.toUpperCase() || '?';
  const hasVariants = (product.product_variants?.length ?? 0) > 0;
  const isLowStock = product.stock_quantity != null && product.stock_quantity > 0 && product.stock_quantity <= 5;
  const isOutOfStock = product.stock_quantity === 0;

  return (
    <Pressable
      onPress={() => !isOutOfStock && onPress(product)}
      style={productCardStyles.card}
      disabled={isOutOfStock}
    >
      <View
        style={[productCardStyles.imageArea, { backgroundColor: isOutOfStock ? '#E5E7EB' : colors.primary + '20' }]}
      >
        {product.image_url ? (
          <Image
            source={{ uri: product.image_url }}
            style={{ width: 48, height: 48, borderRadius: 8 }}
          />
        ) : (
          <Text
            style={[productCardStyles.firstLetter, { color: isOutOfStock ? '#9CA3AF' : colors.primary }]}
          >
            {firstLetter}
          </Text>
        )}
      </View>

      <Text style={productCardStyles.name} numberOfLines={2}>
        {product.name}
      </Text>

      <View style={productCardStyles.row}>
        <Text style={productCardStyles.price}>
          {formatCurrency(product.final_price)}
        </Text>
        {hasVariants && (
          <Badge label="Var." variant="info" size="sm" />
        )}
      </View>

      {isLowStock && (
        <Text style={productCardStyles.lowStock}>
          Stock: {product.stock_quantity}
        </Text>
      )}
      {isOutOfStock && (
        <Text style={productCardStyles.outOfStock}>
          Agotado
        </Text>
      )}
    </Pressable>
  );
};

const VariantPicker = ({
  visible,
  product,
  onSelect,
  onClose,
}: {
  visible: boolean;
  product: Product | null;
  onSelect: (variant: ProductVariant) => void;
  onClose: () => void;
}) => {
  if (!product) return null;

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <View style={s.containerPad}>
        <Text style={s.sectionTitle}>Seleccionar Variante</Text>
        <Text style={s.sectionSubtitle}>{product.name}</Text>
        <FlatList
          data={product.product_variants || []}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => {
            const price = item.price_override != null ? item.price_override : product.final_price;
            const isUnavailable = item.stock_quantity === 0;

            return (
              <Pressable
                onPress={() => !isUnavailable && onSelect(item)}
                style={({ pressed }) => [
                  s.variantRow,
                  pressed ? { backgroundColor: colorScales.gray[50] } : undefined,
                ]}
                disabled={isUnavailable}
              >
                <View style={s.flex1}>
                  <Text style={s.variantName}>
                    {item.name || item.attributes || item.sku}
                  </Text>
                  <Text style={s.skuText}>SKU: {item.sku}</Text>
                </View>
                <View style={s.itemsEnd}>
                  <Text style={s.variantPrice}>
                    {formatCurrency(price)}
                  </Text>
                  {isUnavailable ? (
                    <Text style={s.outOfStockText}>Agotado</Text>
                  ) : (
                    <Text style={s.stockText}>Stock: {item.stock_quantity}</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      </View>
    </BottomSheet>
  );
};

const CartItemRow = ({
  item,
  onIncrease,
  onDecrease,
  onRemove,
}: {
  item: any;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
  onRemove: (id: string) => void;
}) => (
  <View style={s.cartItemRow}>
    <View style={s.cartItemInfo}>
      <Text style={s.cartItemName} numberOfLines={1}>
        {item.product.name}
      </Text>
      {item.variant_display_name && (
        <Text style={s.cartItemVariant} numberOfLines={1}>
          {item.variant_display_name}
        </Text>
      )}
      <Text style={s.cartItemUnitPrice}>
        {formatCurrency(item.finalPrice)} c/u
      </Text>
    </View>

    <View style={s.qtyControls}>
      <Pressable
        onPress={() => onDecrease(item.id)}
        style={({ pressed }) => [
          s.qtyBtn,
          s.qtyBtnMinus,
          pressed ? { backgroundColor: colorScales.gray[200] } : undefined,
        ]}
      >
        <Icon name="minus" size={14} color={colors.text.secondary} />
      </Pressable>
      <Text style={s.qtyLabel}>{item.quantity}</Text>
      <Pressable
        onPress={() => onIncrease(item.id)}
        style={({ pressed }) => [
          s.qtyBtn,
          s.qtyBtnPlus,
          pressed ? { opacity: 0.8 } : undefined,
        ]}
      >
        <Icon name="plus" size={14} color={colors.primary} />
      </Pressable>
    </View>

    <Text style={s.cartItemTotal}>
      {formatCurrency(item.totalPrice)}
    </Text>

    <Pressable
      onPress={() => onRemove(item.id)}
      style={({ pressed }) => [
        s.removeBtn,
        pressed ? { opacity: 0.5 } : undefined,
      ]}
    >
      <Icon name="trash" size={16} color={colors.error} />
    </Pressable>
  </View>
);

const CustomerSearchSheet = ({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (customer: PosCustomer | null) => void;
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const customers = await searchCustomers(text);
    setResults(customers);
    setSearching(false);
  }, []);

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <View style={s.containerPad}>
        <Text style={[s.sectionTitle, { marginBottom: spacing[3] }]}>Seleccionar Cliente</Text>
        <SearchBar
          placeholder="Buscar por nombre o email..."
          value={query}
          onChangeText={handleSearch}
        />
        <FlatList
          data={results}
          keyExtractor={(item) => item.id.toString()}
          style={{ maxHeight: 300, marginTop: spacing[3] }}
          ListHeaderComponent={
            <Pressable
              onPress={() => { onSelect(null); onClose(); }}
              style={s.customerRow}
            >
              <Text style={s.noClientText}>
                Sin cliente
              </Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { onSelect(item); onClose(); }}
              style={s.customerRow}
            >
              <Text style={s.customerName}>
                {item.first_name} {item.last_name}
              </Text>
              <Text style={s.customerContact}>
                {item.email} {item.phone ? `• ${item.phone}` : ''}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            query.length >= 2 && !searching ? (
              <Text style={s.emptyText}>
                No se encontraron clientes
              </Text>
            ) : null
          }
        />
      </View>
    </BottomSheet>
  );
};

const DiscountSheet = ({
  visible,
  onClose,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (amount: number) => void;
}) => {
  const [amount, setAmount] = useState('');

  const handleApply = () => {
    const value = parseFloat(amount.replace(',', '.'));
    if (isNaN(value) || value <= 0) return;
    onApply(value);
    setAmount('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <View style={s.containerPad}>
        <Text style={[s.sectionTitle, { marginBottom: spacing[3] }]}>Agregar Descuento</Text>
        <Input
          label="Monto del descuento"
          placeholder="0.00"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <View style={s.discountSection}>
          <Button title="Aplicar" onPress={handleApply} fullWidth disabled={!amount} />
        </View>
      </View>
    </BottomSheet>
  );
};

const CartPanel = ({
  visible,
  onClose,
  onCharge,
}: {
  visible: boolean;
  onClose: () => void;
  onCharge: () => void;
}) => {
  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const summary = useCartStore((s) => s.summary);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const applyDiscount = useCartStore((s) => s.applyDiscount);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);

  return (
    <>
      <CustomerSearchSheet
        visible={showCustomerSearch}
        onClose={() => setShowCustomerSearch(false)}
        onSelect={(c) => setCustomer(c)}
      />
      <DiscountSheet
        visible={showDiscount}
        onClose={() => setShowDiscount(false)}
        onApply={(amount) => applyDiscount('fixed', amount, 'Descuento manual')}
      />
      <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
        <View style={s.cartPanelContent}>
          <View style={s.cartHeader}>
            <Text style={s.cartTitle}>Carrito</Text>
            <Pressable onPress={onClose}>
              <Icon name="x" size={24} color={colors.text.secondary} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowCustomerSearch(true)}
            style={({ pressed }) => [
              s.customerBtn,
              pressed ? { backgroundColor: '#DBEAFE' } : undefined,
            ]}
          >
            <Icon name="user" size={16} color="#3B82F6" />
            <Text style={s.customerBtnText}>
              {customer ? `${customer.first_name} ${customer.last_name}` : 'Sin cliente'}
            </Text>
            <Text style={s.selectLabel}>Seleccionar</Text>
          </Pressable>

          {items.length === 0 ? (
            <EmptyState
              title="Carrito vacío"
              description="Agrega productos desde el catálogo"
              icon="shopping-cart"
            />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              style={s.cartFlatList}
              renderItem={({ item }) => (
                <CartItemRow
                  item={item}
                  onIncrease={(id) => updateQuantity(id, items.find((i) => i.id === id)!.quantity + 1)}
                  onDecrease={(id) => updateQuantity(id, items.find((i) => i.id === id)!.quantity - 1)}
                  onRemove={removeItem}
                />
              )}
            />
          )}

          {items.length > 0 && (
            <View style={s.summarySection}>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>Subtotal</Text>
                <Text style={s.summaryValue}>{formatCurrency(summary.subtotal)}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryLabel}>IVA</Text>
                <Text style={s.summaryValue}>{formatCurrency(summary.taxAmount)}</Text>
              </View>
              {summary.discountAmount > 0 ? (
                <View style={s.summaryRow}>
                  <Text style={s.summaryLabel}>Descuento</Text>
                  <Text style={s.discountText}>-{formatCurrency(summary.discountAmount)}</Text>
                </View>
              ) : (
                <Pressable onPress={() => setShowDiscount(true)} style={s.addDiscountBtn}>
                  <Text style={s.addDiscountText}>
                    + Agregar descuento
                  </Text>
                </Pressable>
              )}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total</Text>
                <Text style={s.totalValue}>
                  {formatCurrency(summary.total)}
                </Text>
              </View>

              <Button
                title="COBRAR"
                onPress={onCharge}
                fullWidth
                size="lg"
                containerStyle={s.chargeBtn}
              />
            </View>
          )}
        </View>
      </BottomSheet>
    </>
  );
};

const PaymentSheet = ({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: (orderNumber: string, receiptData: { items: any[]; summary: any; customer: any; paymentMethod: string }) => void;
}) => {
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const summary = useCartStore((s) => s.summary);
  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const discounts = useCartStore((s) => s.discounts);
  const notes = useCartStore((s) => s.notes);
  const clearCart = useCartStore((s) => s.clearCart);
  const queryClient = useQueryClient();

  const received = parseFloat(cashReceived) || 0;
  const change = received - summary.total;

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/store/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Error al crear la orden');
      return res.json();
    },
    onSuccess: (data) => {
      const orderNumber = data?.order_number || data?.id?.toString() || '---';
      const receiptData = { items, summary, customer, paymentMethod };
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      onSuccess(orderNumber, receiptData);
    },
    onError: () => {
      toastError('Error al procesar el pago. Intenta de nuevo.');
    },
  });

  const handleConfirm = () => {
    if (paymentMethod === 'cash' && received < summary.total) {
      toastError('El monto recibido es insuficiente');
      return;
    }

    mutation.mutate({
      items: items.map((i) => ({
        product_id: i.product.id,
        variant_id: i.variant?.id,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        total_price: i.totalPrice,
        tax_amount: i.taxAmount,
      })),
      customer_id: customer?.id,
      discounts: discounts.map((d) => ({
        type: d.type,
        value: d.value,
        amount: d.amount,
        description: d.description,
      })),
      notes,
      payment: {
        method: paymentMethod,
        amount: summary.total,
        cash_received: paymentMethod === 'cash' ? received : undefined,
        change: paymentMethod === 'cash' ? Math.max(0, change) : undefined,
      },
    });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.containerPad}
      >
        <Text style={s.paymentTitle}>Cobrar</Text>

        <View style={s.totalBox}>
          <Text style={s.totalBoxLabel}>Total a cobrar</Text>
          <Text style={s.totalBoxValue}>
            {formatCurrency(summary.total)}
          </Text>
        </View>

        <View style={s.methodRow}>
          <Pressable
            onPress={() => setPaymentMethod('cash')}
            style={[s.methodBtn, paymentMethod === 'cash' ? s.methodBtnActive : s.methodBtnInactive]}
          >
            <Icon name="dollar-sign" size={18} color={paymentMethod === 'cash' ? colors.primary : colors.text.secondary} />
            <Text style={[s.methodLabel, paymentMethod === 'cash' ? s.methodLabelActive : s.methodLabelInactive]}>
              Efectivo
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPaymentMethod('card')}
            style={[s.methodBtn, paymentMethod === 'card' ? s.methodBtnActive : s.methodBtnInactive]}
          >
            <Icon name="credit-card" size={18} color={paymentMethod === 'card' ? colors.primary : colors.text.secondary} />
            <Text style={[s.methodLabel, paymentMethod === 'card' ? s.methodLabelActive : s.methodLabelInactive]}>
              Tarjeta
            </Text>
          </Pressable>
        </View>

        {paymentMethod === 'cash' && (
          <View style={s.cashSection}>
            <Input
              label="Efectivo recibido"
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={cashReceived}
              onChangeText={setCashReceived}
            />
            {received > 0 && received >= summary.total && (
              <View style={s.changeBox}>
                <Text style={s.changeLabel}>Cambio</Text>
                <Text style={s.changeValue}>{formatCurrency(change)}</Text>
              </View>
            )}
          </View>
        )}

        <Button
          title="Confirmar Pago"
          onPress={handleConfirm}
          fullWidth
          size="lg"
          loading={mutation.isPending}
          disabled={mutation.isPending}
        />
      </KeyboardAvoidingView>
    </BottomSheet>
  );
};

const SuccessModal = ({
  visible,
  orderNumber,
  onClose,
  receiptData,
}: {
  visible: boolean;
  orderNumber: string;
  onClose: () => void;
  receiptData?: {
    items: any[];
    summary: any;
    customer: any;
    paymentMethod: string;
  } | null;
}) => {
  const [printing, setPrinting] = useState(false);

  const handlePrint = useCallback(async () => {
    if (!receiptData) return;
    setPrinting(true);
    try {
      const html = generateReceiptHtml({ orderNumber, ...receiptData });
      await Print.printAsync({ html });
    } catch (e) {
      toastError('Error al imprimir');
    }
    setPrinting(false);
  }, [orderNumber, receiptData]);

  const handleShare = useCallback(async () => {
    if (!receiptData) return;
    setPrinting(true);
    try {
      const html = generateReceiptHtml({ orderNumber, ...receiptData });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync('data:text/html,' + encodeURIComponent(html), {
          mimeType: 'text/html',
          dialogTitle: 'Compartir recibo',
        });
      } else {
        await Print.printAsync({ html });
      }
    } catch (e) {
      toastError('Error al compartir');
    }
    setPrinting(false);
  }, [orderNumber, receiptData]);

  if (!visible) return null;

  return (
    <View style={s.successOverlay}>
      <View style={s.successCard}>
        <View style={s.successIcon}>
          <Icon name="check" size={32} color={colors.primary} />
        </View>
        <Text style={s.successTitle}>¡Venta exitosa!</Text>
        <Text style={s.successSubtitle}>Orden</Text>
        <Text style={s.orderNumber}>#{orderNumber}</Text>
        <View style={s.actionRow}>
          <Pressable
            onPress={handleShare}
            style={({ pressed }) => [
              s.actionBtn,
              pressed ? { backgroundColor: colorScales.gray[50] } : undefined,
            ]}
            disabled={printing}
          >
            <Icon name="share" size={16} color={colors.text.secondary} />
            <Text style={s.actionBtnText}>Compartir</Text>
          </Pressable>
          <Pressable
            onPress={handlePrint}
            style={({ pressed }) => [
              s.actionBtn,
              pressed ? { backgroundColor: colorScales.gray[50] } : undefined,
            ]}
            disabled={printing}
          >
            <Icon name="printer" size={16} color={colors.text.secondary} />
            <Text style={s.actionBtnText}>Imprimir</Text>
          </Pressable>
        </View>
        <Button title="Nueva venta" onPress={onClose} fullWidth containerStyle={s.chargeBtn} />
      </View>
    </View>
  );
};

const PosScreen = () => {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [showVariants, setShowVariants] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptData, setReceiptData] = useState<{
    items: any[];
    summary: any;
    customer: any;
    paymentMethod: string;
  } | null>(null);

  const summary = useCartStore((s) => s.summary);
  const addItem = useCartStore((s) => s.addItem);

  const { data: products, isLoading } = useQuery({
    queryKey: ['pos-products', search],
    queryFn: () =>
      search
        ? ProductService.search(search)
        : ProductService.list({ pos_optimized: true, limit: 50, state: 'active' }),
  });

  const productList = useMemo(() => {
    if (!products) return [];
    return Array.isArray(products) ? products : (products as any).data || [];
  }, [products]);

  const handleProductPress = useCallback(
    (product: Product) => {
      if (product.product_variants && product.product_variants.length > 0) {
        setSelectedProduct(product);
        setShowVariants(true);
      } else {
        addItem(product, null, 1);
        toastSuccess(`${product.name} agregado`);
      }
    },
    [addItem],
  );

  const handleVariantSelect = useCallback(
    (variant: ProductVariant) => {
      if (selectedProduct) {
        addItem(selectedProduct, variant, 1);
        toastSuccess(`${selectedProduct.name} agregado`);
      }
      setShowVariants(false);
      setSelectedProduct(null);
    },
    [selectedProduct, addItem],
  );

  const handleChargeSuccess = useCallback((num: string, data: any) => {
    setOrderNumber(num);
    setReceiptData(data);
    setShowPayment(false);
    setShowSuccess(true);
  }, []);

  const handleCloseSuccess = useCallback(() => {
    setShowSuccess(false);
    setOrderNumber('');
    setReceiptData(null);
  }, []);

  return (
    <View style={[s.posRoot, { paddingTop: insets.top }]}>
      <View style={s.searchWrapper}>
        <SearchBar
          placeholder="Buscar productos..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {isLoading ? (
        <View style={s.centerContent}>
          <Spinner />
        </View>
      ) : productList.length === 0 ? (
        <EmptyState
          title="Sin productos"
          description={search ? 'No se encontraron resultados' : 'No hay productos disponibles'}
          icon="package"
        />
      ) : (
        <FlatList
          data={productList}
          keyExtractor={(item) => item.id.toString()}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between', paddingHorizontal: spacing[4] }}
          contentContainerStyle={{ paddingBottom: spacing[24] }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={handleProductPress} />
          )}
        />
      )}

      {summary.itemCount > 0 && (
        <Pressable
          onPress={() => setShowCart(true)}
          style={[
            s.fabBar,
            {
              backgroundColor: colors.primary,
              paddingBottom: insets.bottom + spacing[3],
            },
          ]}
        >
          <View style={s.fabLeft}>
            <View style={s.fabBadge}>
              <Text style={s.fabBadgeText}>{summary.totalItems}</Text>
            </View>
            <Text style={s.fabCountText}>
              {summary.itemCount} {summary.itemCount === 1 ? 'producto' : 'productos'}
            </Text>
          </View>
          <View style={s.fabRight}>
            <Text style={s.fabTotalText}>
              {formatCurrency(summary.total)}
            </Text>
            <View style={s.fabCartBtn}>
              <Text style={s.fabCartText}>Ver Carrito</Text>
              <Icon name="shopping-cart" size={14} color="#fff" />
            </View>
          </View>
        </Pressable>
      )}

      <VariantPicker
        visible={showVariants}
        product={selectedProduct}
        onSelect={handleVariantSelect}
        onClose={() => {
          setShowVariants(false);
          setSelectedProduct(null);
        }}
      />

      <CartPanel
        visible={showCart}
        onClose={() => setShowCart(false)}
        onCharge={() => {
          setShowCart(false);
          setShowPayment(true);
        }}
      />

      <PaymentSheet
        visible={showPayment}
        onClose={() => setShowPayment(false)}
        onSuccess={handleChargeSuccess}
      />

      <SuccessModal
        visible={showSuccess}
        orderNumber={orderNumber}
        onClose={handleCloseSuccess}
        receiptData={receiptData}
      />
    </View>
  );
};

export default PosScreen;
