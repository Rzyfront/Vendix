import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Image,
  Animated,
  Dimensions,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { CustomerService, OrderService, ProductService } from '@/features/store/services';
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
import { DrawerMenu } from '@/shared/layouts/drawer-menu';
import { HelpSearchModal } from '@/features/help/help-search-modal';
import { NotificationsModal } from '@/features/notifications/notifications-modal';
import { UserDropdownModal } from '@/features/user/user-dropdown-modal';
import {
  PosHeader,
  PosSearchBar,
  PosMobileFooter,
  PosCartModal,
  PosFilterDropdown,
  PosAddModal,
  PosCustomerModal,
} from '@/features/pos/components';
import { toastSuccess, toastError, toastWarning } from '@/shared/components/toast/toast.store';
import type {
  CreatePosPaymentDto,
  PaymentMethod,
  PosPaymentResponse,
  Product,
  ProductVariant,
  PosCustomer,
} from '@/features/store/types';

const GRID_HORIZONTAL_PADDING = spacing[3];
const GRID_COLUMN_GAP = spacing[3];
const PRODUCT_CARD_WIDTH =
  (Dimensions.get('window').width - GRID_HORIZONTAL_PADDING * 2 - GRID_COLUMN_GAP) / 2;

const productCardStyles = StyleSheet.create({
  card: {
    width: PRODUCT_CARD_WIDTH,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginBottom: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    ...shadows.sm,
    overflow: 'hidden',
  },
  imageArea: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: borderRadius.lg,
    marginBottom: spacing[2],
    overflow: 'hidden',
    backgroundColor: colorScales.gray[100],
  },
  imageGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colorScales.gray[100],
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgesContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  stockBadge: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    zIndex: 1,
  },
  variantsBadge: {
    position: 'absolute',
    top: spacing[2],
    left: spacing[2],
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  variantsBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  name: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    lineHeight: 18,
  },
  description: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    lineHeight: 16,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[1],
  },
  priceContainer: {
    flexDirection: 'column',
  },
  price: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginTop: spacing[0.5],
  },
  priceWeightUnit: {
    fontSize: 10,
    fontWeight: typography.fontWeight.normal as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  stockText: {
    fontSize: 10,
    fontFamily: typography.fontFamily,
    lineHeight: 14,
    marginTop: 1,
  },
  bottomSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  bottomLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minWidth: 0,
  },
  skuText: {
    fontSize: typography.fontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colorScales.gray[400],
    maxWidth: 80,
  },
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});

const s = StyleSheet.create({
  posRoot: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  drawerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
  },
  flex: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  containerPad: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
  },
  sheetFlex: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: spacing[1],
  },
  sectionSubtitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  skuText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  itemsEnd: { alignItems: 'flex-end' },
  variantPrice: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  outOfStockText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.error,
  },
  stockText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  cartItemVariant: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  cartItemUnitPrice: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    marginHorizontal: spacing[3],
    width: 24,
    textAlign: 'center',
  },
  cartItemTotal: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  customerContact: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  noClientText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    fontFamily: typography.fontFamily,
    color: colors.error,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacing[4],
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    marginLeft: spacing[2],
    flex: 1,
  },
  selectLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: '#2563EB',
    marginRight: spacing[2],
  },
  cartFlatList: {
    flex: 1,
  },
  cartItemsList: {
    paddingBottom: spacing[2],
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  discountText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: '#16A34A',
  },
  addDiscountBtn: {
    paddingVertical: spacing[2],
  },
  addDiscountText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  totalValue: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  chargeBtn: {
    marginTop: spacing[4],
  },
  paymentTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  totalBoxValue: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  methodBtn: {
    minWidth: '47%' as any,
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
    fontFamily: typography.fontFamily,
  },
  methodLabelActive: {
    color: '#15803D',
  },
  methodLabelInactive: {
    color: colorScales.gray[500],
  },
  fallbackPaymentBox: {
    flexDirection: 'row',
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.amber[200],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  fallbackPaymentTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colorScales.amber[900],
  },
  fallbackPaymentText: {
    marginTop: spacing[0.5],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.amber[700],
  },
  saleErrorBox: {
    flexDirection: 'row',
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.red[200],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  saleErrorTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colorScales.red[900],
  },
  saleErrorText: {
    marginTop: spacing[0.5],
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    lineHeight: 17,
    color: colorScales.red[700],
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
    fontFamily: typography.fontFamily,
    color: '#2563EB',
    fontWeight: typography.fontWeight.medium,
  },
  changeValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: spacing[1],
  },
  successSubtitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginBottom: spacing[1],
  },
  orderNumber: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
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
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  discountSection: {
    marginTop: spacing[4],
  },
});

async function searchCustomers(query: string): Promise<PosCustomer[]> {
  if (!query.trim()) return [];
  try {
    const res = await CustomerService.searchCustomers(query, 20);
    const data = Array.isArray(res) ? res : res.data;
    return (data || []).map(toPosCustomer);
  } catch {
    return [];
  }
}

function toPosCustomer(customer: any): PosCustomer {
  return {
    id: Number(customer.id),
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    document_number: customer.document_number,
  };
}

function buildPosCustomerPayload(customer: {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  document_number: string;
}) {
  const stamp = Date.now();
  const documentNumber = customer.document_number.trim() || `POS-${stamp}`;

  return {
    first_name: customer.first_name.trim(),
    last_name: customer.last_name.trim() || 'Cliente',
    email: customer.email.trim() || `pos.${stamp}@vendix.app`,
    phone: customer.phone.trim() || undefined,
    document_number: documentNumber,
  };
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
        <div class="row" style="margin-top: 10px; font-size: 12px;"><span>Método:</span><span>${order.paymentMethod}</span></div>
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
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const hasVariants = (product.product_variants?.length ?? 0) > 0;
  const tracksInventory = product.track_inventory !== false;
  const stockQty = product.stock_quantity ?? 0;
  const variantStockTotal = hasVariants
    ? (product.product_variants ?? []).reduce(
        (sum, v) => sum + ((v.stock_quantity ?? 0) * ((v.effective_track_inventory ?? product.track_inventory ?? true) ? 1 : 0)),
        0,
      )
    : stockQty;
  const isOutOfStock = tracksInventory && variantStockTotal === 0;
  const isLowStock = tracksInventory && variantStockTotal > 0 && variantStockTotal <= 5;
  const isUnavailable = variantStockTotal === 0;

  const getStockText = () => {
    if (!tracksInventory) return 'Disponible';
    if (variantStockTotal === 0) return 'Sin stock';
    if (variantStockTotal <= 5) return `${variantStockTotal} en stock`;
    return 'Disponible';
  };

  const getStockTextColor = () => {
    if (!tracksInventory) return colorScales.blue[600];
    if (variantStockTotal === 0) return colors.error;
    if (variantStockTotal <= 5) return colors.warning;
    return colorScales.blue[600];
  };

  const getStockBadge = () => {
    if (tracksInventory) {
      if (variantStockTotal === 0) return { label: 'Agotado', variant: 'error' as const };
      if (variantStockTotal <= 5) return { label: `Últimas ${variantStockTotal}`, variant: 'warning' as const };
      return { label: 'Disponible', variant: 'info' as const };
    } else {
      return { label: 'Disponible', variant: 'info' as const };
    }
  };

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const stockBadge = getStockBadge();
  const stockText = getStockText();
  const stockTextColor = getStockTextColor();

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <Pressable
        onPress={isUnavailable ? undefined : () => onPress(product)}
        onPressIn={isUnavailable ? undefined : handlePressIn}
        onPressOut={isUnavailable ? undefined : handlePressOut}
        style={[
          productCardStyles.card,
          isUnavailable && { opacity: 0.6 },
        ]}
      >
        {/* Image Area */}
        <View style={productCardStyles.imageArea}>
          <View style={productCardStyles.imageGradient} />

          {product.image_url ? (
            <Image
              source={{ uri: product.image_url }}
              style={productCardStyles.productImage}
              resizeMode="cover"
            />
          ) : (
            <View style={productCardStyles.imageFallback}>
              <Icon name="image" size={32} color={colorScales.gray[400]} />
            </View>
          )}

          {/* Badges overlaid on image */}
          <View style={productCardStyles.badgesContainer} pointerEvents="none">
            {/* Stock badge - top center */}
            {stockBadge && (
              <View style={productCardStyles.stockBadge}>
                <Badge
                  label={stockBadge.label}
                  variant={stockBadge.variant}
                  size="sm"
                />
              </View>
            )}

            {/* Variants badge - top left */}
            {hasVariants && (
              <View style={productCardStyles.variantsBadge}>
                <Icon name="layers" size={12} color="#FFFFFF" />
                <Text style={productCardStyles.variantsBadgeText}>
                  {product.product_variants?.length}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Product Name */}
        <Text style={productCardStyles.name} numberOfLines={1} ellipsizeMode="tail">
          {product.name}
        </Text>

        {/* Description — siempre renderizada para mantener altura uniforme */}
        <Text style={productCardStyles.description} numberOfLines={1} ellipsizeMode="tail">
          {product.description || ' '}
        </Text>

        {/* Price + Stock row */}
        <View style={productCardStyles.row}>
          <View style={productCardStyles.priceContainer}>
            <Text style={productCardStyles.price}>
              {formatCurrency(product.final_price)}
              {product.pricing_type === 'weight' && (
                <Text style={productCardStyles.priceWeightUnit}>
                  {' /kg'}
                </Text>
              )}
            </Text>
            {stockText && (
              <Text style={[productCardStyles.stockText, { color: stockTextColor }]}>
                {stockText}
              </Text>
            )}
          </View>
        </View>

        {/* Bottom section: SKU + Add button */}
        <View style={productCardStyles.bottomSection}>
          <View style={productCardStyles.bottomLeft}>
            {product.sku ? (
              <Text style={productCardStyles.skuText} numberOfLines={1}>
                {product.sku}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              if (!isUnavailable) onPress(product);
            }}
            style={productCardStyles.addButton}
            disabled={isUnavailable}
          >
            <Icon name="plus" size={14} color="#FFFFFF" />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
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
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial" scrollable={false}>
      <View style={[s.containerPad, s.sheetFlex]}>
        <Text style={s.sectionTitle}>Seleccionar Variante</Text>
        <Text style={s.sectionSubtitle}>{product.name}</Text>
        <FlatList
          data={product.product_variants || []}
          keyExtractor={(item) => item.id.toString()}
          style={s.sheetFlex}
          renderItem={({ item }) => {
            const hasSale = item.is_on_sale === true && item.sale_price != null;
            const displayPrice = hasSale ? item.sale_price! : (item.price_override != null ? item.price_override : product.final_price);
            const comparePrice = hasSale ? (item.price_override ?? product.final_price) : null;
            const tracksInventory = item.effective_track_inventory ?? product.track_inventory ?? true;
            const isUnavailable = tracksInventory && item.stock_quantity === 0;

            return (
              <Pressable
                onPress={() => onSelect(item)}
                style={({ pressed }) => [
                  s.variantRow,
                  pressed ? { backgroundColor: colorScales.gray[50] } : undefined,
                ]}
              >
                <View style={s.flex1}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.variantName}>
                      {item.name || item.attributes || item.sku}
                    </Text>
                    {hasSale && (
                      <Badge label="OFERTA" variant="warning" size="sm" />
                    )}
                  </View>
                  <Text style={s.skuText}>SKU: {item.sku}</Text>
                </View>
                <View style={s.itemsEnd}>
                  {hasSale && comparePrice != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={[s.variantPrice, { color: colors.error }]}>
                        {formatCurrency(displayPrice)}
                      </Text>
                      <Text style={{ fontSize: 10, color: colorScales.gray[400], textDecorationLine: 'line-through' }}>
                        {formatCurrency(comparePrice)}
                      </Text>
                    </View>
                  ) : (
                    <Text style={s.variantPrice}>
                      {formatCurrency(displayPrice)}
                    </Text>
                  )}
                  {isUnavailable ? (
                    <Text style={[s.outOfStockText, { color: colors.error }]}>Agotado</Text>
                  ) : (
                    <Text style={[s.stockText, { color: colorScales.gray[500] }]}>Stock: {item.stock_quantity}</Text>
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
  const [creating, setCreating] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    document_number: '',
  });
  const queryClient = useQueryClient();

  const { data: recentCustomers, isLoading: loadingRecent } = useQuery({
    queryKey: ['pos-customers-recent'],
    queryFn: () => CustomerService.list({ limit: 20 }),
    enabled: visible && !creating,
  });

  const visibleCustomers = query.length >= 2
    ? results
    : (recentCustomers?.data ?? []).map(toPosCustomer);

  const createCustomerMutation = useMutation({
    mutationFn: () =>
      CustomerService.create(buildPosCustomerPayload(newCustomer)),
    onSuccess: (customer) => {
      const created = {
        id: Number(customer.id),
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        document_number: customer.document_number,
      };
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onSelect(created);
      onClose();
      setCreating(false);
      setNewCustomer({ first_name: '', last_name: '', email: '', phone: '', document_number: '' });
      toastSuccess('Cliente creado');
    },
    onError: () => toastError('Error al crear el cliente'),
  });

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
    <BottomSheet visible={visible} onClose={onClose} snapPoint="partial" scrollable={creating}>
      <View style={s.containerPad}>
        <Text style={[s.sectionTitle, { marginBottom: spacing[3] }]}>Seleccionar Cliente</Text>
        {creating ? (
          <View style={{ gap: spacing[3], marginBottom: spacing[4] }}>
            <Input label="Nombre" value={newCustomer.first_name} onChangeText={(first_name) => setNewCustomer((prev) => ({ ...prev, first_name }))} />
            <Input label="Apellido" value={newCustomer.last_name} onChangeText={(last_name) => setNewCustomer((prev) => ({ ...prev, last_name }))} />
            <Input label="Email" value={newCustomer.email} onChangeText={(email) => setNewCustomer((prev) => ({ ...prev, email }))} keyboardType="email-address" autoCapitalize="none" />
            <Input label="Teléfono" value={newCustomer.phone} onChangeText={(phone) => setNewCustomer((prev) => ({ ...prev, phone }))} keyboardType="phone-pad" />
            <Input label="Documento" value={newCustomer.document_number} onChangeText={(document_number) => setNewCustomer((prev) => ({ ...prev, document_number }))} />
            <View style={{ flexDirection: 'row', gap: spacing[3] }}>
              <Button title="Cancelar" variant="outline" onPress={() => setCreating(false)} style={{ flex: 1 }} />
              <Button
                title="Crear"
                onPress={() => createCustomerMutation.mutate()}
                loading={createCustomerMutation.isPending}
                disabled={!newCustomer.first_name.trim()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <>
            <Button
              title="Nuevo cliente"
              variant="outline"
              onPress={() => setCreating(true)}
              leftIcon={<Icon name="user-plus" size={16} color={colors.primary} />}
              fullWidth
              containerStyle={{ marginBottom: spacing[3] }}
            />
            <SearchBar
              placeholder="Buscar por nombre o email..."
              value={query}
              onChangeText={handleSearch}
            />
            <FlatList
              data={visibleCustomers}
              keyExtractor={(item) => item.id.toString()}
              style={{ maxHeight: 300, marginTop: spacing[3] }}
              keyboardShouldPersistTaps="handled"
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
                (query.length >= 2 && !searching) || (!loadingRecent && query.length < 2) ? (
                  <Text style={s.emptyText}>
                    No se encontraron clientes
                  </Text>
                ) : null
              }
              ListFooterComponent={searching || loadingRecent ? <Spinner /> : null}
            />
          </>
        )}
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

const DIRECT_PAYMENT_TYPES = new Set(['cash', 'card', 'bank_transfer', 'transfer', 'voucher']);

function getPaymentMethodType(method?: PaymentMethod | null): string {
  return method?.system_payment_method?.type || method?.type || '';
}

function getPaymentMethodLabel(method?: PaymentMethod | null): string {
  return (
    method?.display_name ||
    method?.name ||
    method?.system_payment_method?.display_name ||
    method?.system_payment_method?.name ||
    'Método de pago'
  );
}

function getPaymentMethodIcon(method?: PaymentMethod | null): string {
  const type = getPaymentMethodType(method);
  if (type === 'cash') return 'dollar-sign';
  if (type === 'card') return 'credit-card';
  if (type === 'bank_transfer' || type === 'transfer') return 'wallet';
  return 'credit-card';
}

function parseVariantAttributes(attributes?: unknown): Record<string, unknown> | undefined {
  if (!attributes) return undefined;
  if (typeof attributes === 'object') return attributes as Record<string, unknown>;
  if (typeof attributes !== 'string') return { value: attributes };
  try {
    const parsed = JSON.parse(attributes);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return { value: attributes };
  }
}

interface PosSaleResult {
  response: PosPaymentResponse;
  paymentMethodLabel: string;
  fallbackReason?: string;
}

class PosCheckoutError extends Error {
  details: string[];
  canFallback: boolean;

  constructor(message: string, details: string[] = [], canFallback = true) {
    super(message);
    this.name = 'PosCheckoutError';
    this.details = details;
    this.canFallback = canFallback;
  }
}

function flattenErrorDetails(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(flattenErrorDetails);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      const details = flattenErrorDetails(item);
      return details.length > 0 ? details.map((detail) => `${key}: ${detail}`) : [];
    });
  }
  return [String(value)];
}

function normalizePosErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('cash register') || lower.includes('caja registradora')) {
    return 'Se requiere una caja registradora abierta para vender.';
  }
  if (lower.includes('store context') || lower.includes('store_id')) {
    return 'La sesión no tiene una tienda activa. Cierra sesión y vuelve a entrar a la tienda.';
  }
  if (lower.includes('payment method')) {
    return 'El método de pago no está disponible o no está configurado.';
  }
  if (lower.includes('insufficient stock') || lower.includes('stock')) {
    return 'Hay un problema con el stock del producto seleccionado.';
  }
  if (lower.includes('network error')) {
    return 'No se pudo conectar con el servidor. Revisa internet o la URL de API.';
  }
  return message || 'No se pudo finalizar la venta.';
}

function parsePosCheckoutError(error: unknown, fallbackMessage = 'No se pudo finalizar la venta.'): PosCheckoutError {
  if (error instanceof PosCheckoutError) return error;

  const response = (error as any)?.response;
  const data = response?.data ?? (error as any)?.data;
  const status = Number(response?.status ?? data?.statusCode ?? 0);
  const rawMessage =
    flattenErrorDetails(data?.message)[0] ||
    flattenErrorDetails(data?.error)[0] ||
    (error instanceof Error ? error.message : '') ||
    fallbackMessage;

  const details = [
    ...flattenErrorDetails(data?.errors),
    ...flattenErrorDetails(data?.details),
  ].filter((detail, index, list) => detail && list.indexOf(detail) === index);

  return new PosCheckoutError(
    normalizePosErrorMessage(rawMessage),
    details,
    status !== 401 && status !== 403,
  );
}

function createResponseError(response: PosPaymentResponse): PosCheckoutError {
  return new PosCheckoutError(
    normalizePosErrorMessage(response.message || 'El backend rechazó la venta.'),
    response.errors ?? [],
    true,
  );
}

function resolvePositiveId(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function sanitizePhoneForDto(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const sanitized = phone.replace(/[^\d+#*\s()-]/g, '').trim();
  return sanitized ? sanitized.slice(0, 20) : undefined;
}

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
            <View style={s.cartItemsList}>
              {items.map((item) => (
                <CartItemRow
                  key={item.id}
                  item={item}
                  onIncrease={(id) => updateQuantity(id, items.find((i) => i.id === id)!.quantity + 1)}
                  onDecrease={(id) => updateQuantity(id, items.find((i) => i.id === id)!.quantity - 1)}
                  onRemove={removeItem}
                />
              ))}
            </View>
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
  const [selectedMethodId, setSelectedMethodId] = useState<number | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [saleError, setSaleError] = useState<{ message: string; details: string[] } | null>(null);
  const summary = useCartStore((s) => s.summary);
  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const notes = useCartStore((s) => s.notes);
  const clearCart = useCartStore((s) => s.clearCart);
  const tenantStoreId = useTenantStore((s) => s.storeId);
  const authStoreId = useAuthStore((s) => s.user?.store?.id ?? s.user?.main_store_id);
  const queryClient = useQueryClient();
  const storeId = resolvePositiveId(tenantStoreId, authStoreId);

  const { data: paymentMethods = [], isLoading: methodsLoading } = useQuery({
    queryKey: ['pos-payment-methods'],
    queryFn: () => OrderService.getPaymentMethods(),
  });

  const directMethods = useMemo(
    () =>
      paymentMethods.filter((method) => {
        const type = getPaymentMethodType(method);
        const enabled = !method.state || method.state === 'enabled' || method.state === 'active';
        return enabled && DIRECT_PAYMENT_TYPES.has(type);
      }),
    [paymentMethods],
  );

  const selectedMethod = useMemo(() => {
    return directMethods.find((method) => method.id === selectedMethodId) || directMethods[0] || null;
  }, [directMethods, selectedMethodId]);

  const selectedType = getPaymentMethodType(selectedMethod);
  const isCash = selectedType === 'cash';
  const closesWithoutPayment = !methodsLoading && directMethods.length === 0;
  const received = parseFloat(cashReceived) || 0;
  const change = received - summary.total;

  const mutation = useMutation({
    mutationFn: async (): Promise<PosSaleResult> => {
      const buildPayload = (
        requiresPayment: boolean,
        method: PaymentMethod | null,
        updateInventory: boolean,
      ): CreatePosPaymentDto => ({
        customer_id: customer?.id ? Number(customer.id) : undefined,
        customer_name: customer ? `${customer.first_name} ${customer.last_name}` : undefined,
        customer_email: customer?.email,
        customer_phone: sanitizePhoneForDto(customer?.phone),
        store_id: storeId,
        items: items.map((i) => ({
          product_id: Number(i.product.id),
          product_variant_id: i.variant?.id ? Number(i.variant.id) : undefined,
          product_name: i.product.name,
          product_sku: i.product.sku || undefined,
          variant_sku: i.variant?.sku || undefined,
          variant_attributes: parseVariantAttributes(i.variant?.attributes),
          quantity: i.quantity,
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number((i.unitPrice * i.quantity).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
        })),
        subtotal: Number(summary.subtotal.toFixed(2)),
        tax_amount: Number(summary.taxAmount.toFixed(2)),
        discount_amount: Number(summary.discountAmount.toFixed(2)),
        total_amount: Number(summary.total.toFixed(2)),
        requires_payment: requiresPayment,
        store_payment_method_id: method?.id,
        amount_received: requiresPayment
          ? isCash
            ? Number(received.toFixed(2))
            : Number(summary.total.toFixed(2))
          : undefined,
        payment_reference: paymentReference.trim() || undefined,
        delivery_type: 'direct_delivery',
        internal_notes: notes || undefined,
        update_inventory: updateInventory,
        allow_oversell: true,
        print_receipt: false,
        payment_form: requiresPayment ? '1' : '2',
        credit_type: requiresPayment ? undefined : 'free',
      });

      const processSale = async (payload: CreatePosPaymentDto) => {
        if (!payload.store_id) {
          throw new PosCheckoutError(
            'La sesión no tiene una tienda activa. Cierra sesión y vuelve a entrar a la tienda.',
            ['store_id faltante o inválido en mobile'],
            false,
          );
        }
        const response = await OrderService.processPosPayment(payload);
        if (!response.success) throw createResponseError(response);
        return response;
      };

      const requiresPayment = Boolean(selectedMethod);
      try {
        const response = await processSale(buildPayload(requiresPayment, selectedMethod, true));
        return {
          response,
          paymentMethodLabel: selectedMethod ? getPaymentMethodLabel(selectedMethod) : 'Venta sin pago',
        };
      } catch (primaryError) {
        const parsedPrimary = parsePosCheckoutError(primaryError);
        if (!requiresPayment || !parsedPrimary.canFallback) {
          throw parsedPrimary;
        }

        try {
          const response = await processSale(buildPayload(false, null, false));
          return {
            response,
            paymentMethodLabel: 'Venta sin pago',
            fallbackReason: parsedPrimary.message,
          };
        } catch (fallbackError) {
          const parsedFallback = parsePosCheckoutError(fallbackError);
          throw new PosCheckoutError(
            parsedFallback.message,
            [
              `Intento con pago: ${parsedPrimary.message}`,
              `Intento sin pago: ${parsedFallback.message}`,
              ...parsedFallback.details,
            ],
            false,
          );
        }
      }
    },
    onMutate: () => {
      setSaleError(null);
    },
    onSuccess: (result) => {
      const orderNumber = result.response.order?.order_number || result.response.order?.id?.toString() || '---';
      const receiptData = {
        items,
        summary,
        customer,
        paymentMethod: result.paymentMethodLabel,
      };
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      if (result.fallbackReason) {
        toastWarning(`Venta cerrada sin pago: ${result.fallbackReason}`, 6500);
      } else {
        toastSuccess('Venta finalizada');
      }
      onSuccess(orderNumber, receiptData);
    },
    onError: (error) => {
      const parsed = parsePosCheckoutError(error);
      setSaleError({ message: parsed.message, details: parsed.details });
      toastError(parsed.message, 7000);
    },
  });

  const handleConfirm = () => {
    if (selectedMethod && isCash && received < summary.total) {
      toastError('El monto recibido es insuficiente');
      return;
    }

    mutation.mutate();
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

        {methodsLoading ? (
          <View style={{ marginBottom: spacing[4] }}>
            <Spinner />
          </View>
        ) : directMethods.length === 0 ? (
          <View style={s.fallbackPaymentBox}>
            <Icon name="alert-triangle" size={18} color={colorScales.amber[600]} />
            <View style={{ flex: 1 }}>
              <Text style={s.fallbackPaymentTitle}>Sin métodos de pago configurados</Text>
              <Text style={s.fallbackPaymentText}>
                La venta se cerrará como venta sin pago para no bloquear el POS.
              </Text>
            </View>
          </View>
        ) : (
          <View style={s.methodGrid}>
            {directMethods.map((method) => {
              const active = selectedMethod?.id === method.id;
              return (
                <Pressable
                  key={method.id}
                  onPress={() => {
                    setSaleError(null);
                    setSelectedMethodId(method.id);
                  }}
                  style={[s.methodBtn, active ? s.methodBtnActive : s.methodBtnInactive]}
                >
                  <Icon name={getPaymentMethodIcon(method)} size={18} color={active ? colors.primary : colors.text.secondary} />
                  <Text style={[s.methodLabel, active ? s.methodLabelActive : s.methodLabelInactive]} numberOfLines={1}>
                    {getPaymentMethodLabel(method)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {isCash && (
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

        {!isCash && selectedMethod && (
          <View style={s.cashSection}>
            <Input
              label="Referencia"
              placeholder="Referencia opcional"
              value={paymentReference}
              onChangeText={setPaymentReference}
            />
          </View>
        )}

        {saleError && (
          <View style={s.saleErrorBox}>
            <Icon name="alert-circle" size={18} color={colorScales.red[600]} />
            <View style={{ flex: 1 }}>
              <Text style={s.saleErrorTitle}>No se pudo finalizar la venta</Text>
              <Text style={s.saleErrorText}>{saleError.message}</Text>
              {saleError.details.slice(0, 3).map((detail) => (
                <Text key={detail} style={s.saleErrorText}>
                  {detail}
                </Text>
              ))}
            </View>
          </View>
        )}

        <Button
          title={closesWithoutPayment ? 'Finalizar Venta' : 'Confirmar Pago'}
          onPress={handleConfirm}
          fullWidth
          size="lg"
          loading={mutation.isPending}
          disabled={mutation.isPending || methodsLoading}
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
    } catch {
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
    } catch {
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
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHelpSearch, setShowHelpSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [showVariants, setShowVariants] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    category_id: '',
    brand_id: '',
  });
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptData, setReceiptData] = useState<{
    items: any[];
    summary: any;
    customer: any;
    paymentMethod: string;
  } | null>(null);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const summary = useCartStore((s) => s.summary);
  const addItem = useCartStore((s) => s.addItem);

  const { data: products, isLoading } = useQuery({
    queryKey: ['pos-products', search, activeFilters],
    queryFn: () => {
      const params: any = {
        pos_optimized: true,
        limit: 50,
        state: 'active',
        include_variants: true,
      };

      if (search) {
        params.search = search;
      }

      if (activeFilters.category_id) {
        params.category_id = activeFilters.category_id;
      }

      if (activeFilters.brand_id) {
        params.brand_id = activeFilters.brand_id;
      }

      return search
        ? ProductService.search(search)
        : ProductService.list(params);
    },
  });

  const productList = useMemo(() => {
    if (!products) return [];
    return Array.isArray(products) ? products : (products as any).data || [];
  }, [products]);

  const handleProductPress = useCallback(
    (product: Product) => {
      const hasVariants = (product.product_variants?.length ?? 0) > 0;
      const tracksInventory = product.track_inventory !== false;
      const isUnavailable = !hasVariants && tracksInventory && product.stock_quantity === 0;

      if (isUnavailable) return;

      if (product.pricing_type === 'weight') {
        toastWarning('Ingresa el peso del producto');
        addItem(product, null, 1);
        return;
      }

      if (hasVariants) {
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

  const storeName = useTenantStore((s) => s.storeName);
  const user = useAuthStore((s) => s.user);
  const userInitials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  return (
    <View style={[s.posRoot, { paddingTop: insets.top }]}>
      {/* Drawer Overlay */}
      {drawerOpen && (
        <Pressable
          style={[s.drawerOverlay, { zIndex: 40 }]}
          onPress={closeDrawer}
        >
          <View style={s.flex} />
        </Pressable>
      )}

      {/* Drawer Menu */}
      {drawerOpen && (
        <View
          style={[
            s.drawer,
            {
              width: Dimensions.get('window').width * 0.8,
              paddingTop: insets.top,
              zIndex: 50,
            },
          ]}
        >
          <DrawerMenu currentRoute={pathname} onClose={closeDrawer} variant="store" />
        </View>
      )}

      {/* POS Header - Iconos separados como web */}
      <PosHeader
        onOpenDrawer={openDrawer}
        onOpenHelp={() => setShowHelpSearch(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenUserMenu={() => setShowUserMenu(true)}
        notificationCount={15}
        userInitials={userInitials}
      />

      {/* Search Bar - Con filtros y cliente como web */}
      <PosSearchBar
        onSearch={setSearch}
        onOpenFilters={() => setShowFilters(true)}
        onOpenAdd={() => setShowAddModal(true)}
        selectedCustomer={null}
      />

      {/* Product Grid - Cards exactamente igual que antes */}
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
          columnWrapperStyle={{ gap: GRID_COLUMN_GAP }}
          contentContainerStyle={{
            paddingTop: spacing[3],
            paddingHorizontal: GRID_HORIZONTAL_PADDING,
            paddingBottom: spacing[24],
          }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={handleProductPress} />
          )}
        />
      )}

      {/* Mobile Footer - 3 filas como web */}
      <PosMobileFooter
        itemCount={summary.totalItems}
        total={summary.total}
        taxAmount={summary.taxAmount}
        onViewCart={() => setShowCartModal(true)}
        onCustomItem={() => toastWarning('Ítem personalizado próximamente')}
        onSaveDraft={() => toastSuccess('Borrador guardado')}
        onShipping={() => toastSuccess('Envío próximamente')}
        onCheckout={() => {
          setShowCartModal(false);
          setShowPayment(true);
        }}
      />

      {/* Cart Modal - Bottom sheet como web */}
      <PosCartModal
        visible={showCartModal}
        onClose={() => setShowCartModal(false)}
        items={useCartStore.getState().items}
        subtotal={summary.subtotal}
        taxAmount={summary.taxAmount}
        total={summary.total}
        onIncreaseQuantity={(id) => {
          const item = useCartStore.getState().items.find((i) => i.id === id);
          if (item) useCartStore.getState().updateQuantity(id, item.quantity + 1);
        }}
        onDecreaseQuantity={(id) => {
          const item = useCartStore.getState().items.find((i) => i.id === id);
          if (item && item.quantity > 1) useCartStore.getState().updateQuantity(id, item.quantity - 1);
        }}
        onRemoveItem={(id) => useCartStore.getState().removeItem(id)}
        onClearCart={() => useCartStore.getState().clearCart()}
        onViewDetail={() => setShowCart(true)}
        onSaveDraft={() => toastSuccess('Borrador guardado')}
        onCheckout={() => {
          setShowCartModal(false);
          setShowPayment(true);
        }}
      />

      {/* Variant Picker */}
      <VariantPicker
        visible={showVariants}
        product={selectedProduct}
        onSelect={handleVariantSelect}
        onClose={() => {
          setShowVariants(false);
          setSelectedProduct(null);
        }}
      />

      {/* Cart Panel (legacy) */}
      <CartPanel
        visible={showCart}
        onClose={() => setShowCart(false)}
        onCharge={() => {
          setShowCart(false);
          setShowPayment(true);
        }}
      />

      {/* Payment Sheet */}
      <PaymentSheet
        visible={showPayment}
        onClose={() => setShowPayment(false)}
        onSuccess={handleChargeSuccess}
      />

      {/* Success Modal */}
      <SuccessModal
        visible={showSuccess}
        orderNumber={orderNumber}
        onClose={handleCloseSuccess}
        receiptData={receiptData}
      />

      {/* Help Search Modal */}
      <HelpSearchModal
        visible={showHelpSearch}
        onClose={() => setShowHelpSearch(false)}
        onSelectArticle={(article) => {
          toastSuccess(`Abriendo: ${article.title}`);
        }}
      />

      {/* Notifications Modal */}
      <NotificationsModal
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        onNavigate={(route) => {
          router.push(route as never);
        }}
      />

      {/* User Dropdown Modal */}
      <UserDropdownModal
        visible={showUserMenu}
        onClose={() => setShowUserMenu(false)}
      />

      {/* Filter Dropdown */}
      <PosFilterDropdown
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApplyFilters={(filters: any) => setActiveFilters(filters)}
        currentFilters={activeFilters}
      />

      {/* Add Customer Modal */}
      <PosAddModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSearchCustomer={() => {
          setShowAddModal(false);
          setShowCustomerModal(true);
        }}
        onCreateCustomer={() => {
          setShowAddModal(false);
          setShowCustomerModal(true);
        }}
      />

      {/* Customer Modal */}
      <PosCustomerModal
        visible={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSelectCustomer={(customer) => {
          toastSuccess(`Cliente seleccionado: ${customer.first_name} ${customer.last_name}`);
        }}
      />

      {/* Filter Dropdown */}
      <PosFilterDropdown
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApplyFilters={(filters: any) => setActiveFilters(filters)}
        currentFilters={activeFilters}
      />
    </View>
  );
};

export default PosScreen;
