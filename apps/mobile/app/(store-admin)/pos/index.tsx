import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { CustomerService, OrderService, ProductService, ShippingService } from '@/features/store/services';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { CashRegisterService } from '@/features/pos/services/cash-register.service';
import { useCashRegisterStore } from '@/features/pos/store/cash-register.store';
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
import {
  PosSearchBar,
  PosScreenHeader,
  PosMobileFooter,
  PosCartModal,
  PosFilterDropdown,
  PosCustomerModal,
  ShippingModal,
  PosCustomItemModal,
  PosPaymentModal,
  PosOrderCreateModal,
  PosCashOpenModal,
  PosCashCloseModal,
  PosCashMovementModal,
  PosCashDetailModal,
} from '@/features/pos/components';
import { toastSuccess, toastError, toastWarning } from '@/shared/components/toast/toast.store';
import { useResponsive } from '@/shared/hooks';
import type {
  CreatePosPaymentDto,
  PaymentMethod,
  PosPaymentResponse,
  PosMode,
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
  // Estado presionado: borde primary (paridad web `hover:border-primary` +
  // `active:scale-[0.97]`). Se controla vía prop `pressed`.
  cardPressed: {
    borderColor: colors.primary,
  },
  imageArea: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: borderRadius.lg,
    marginBottom: spacing[2],
    overflow: 'hidden',
    // Gradient bg approximate — paridad web `bg-gradient-to-br from-surface
    // to-muted/30`. RN no soporta linear-gradient cross-platform sin expo,
    // así que usamos una capa overlay semitransparente encima de gray[100].
    backgroundColor: colorScales.gray[100],
  },
  imageGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.55)', // top-light layer sobre gray[100]
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
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
  nameContainer: {
    height: 38,
    marginTop: spacing[1.5],
    justifyContent: 'flex-start',
  },
  // Nombre — paridad web `text-xs sm:text-sm font-medium line-clamp-2`.
  name: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
    lineHeight: 18,
  },
  namePressed: {
    color: colors.primary, // paridad web `group-hover:text-primary`
  },
  // Descripción — paridad web `hidden sm:block text-xs text-text-secondary
  // line-clamp-1`. En mobile NO se renderiza (sólo en sm+).
  description: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[50],
    lineHeight: 14,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2],
    height: 38,
  },
  priceContainer: {
    flexDirection: 'column',
    flexShrink: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing[1],
    flexWrap: 'wrap',
  },
  // Precio — paridad web `text-xs sm:text-sm font-bold text-text-primary`.
  price: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginTop: spacing[0.5],
  },
  // Precio en promoción — paridad web `text-success` (verde).
  priceOnSale: {
    color: colors.primary, // success color
  },
  // Precio compare-at tachado — paridad web `text-text-muted line-through`.
  priceCompareAt: {
    fontSize: 10,
    fontWeight: typography.fontWeight.normal as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    textDecorationLine: 'line-through',
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
  addToCartBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  addToCartBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.92 }],
  },
  addToCartBtnDisabled: {
    backgroundColor: colorScales.gray[200],
    shadowOpacity: 0,
    elevation: 0,
  },
  cartIconContainer: {
    position: 'relative',
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
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
  // Spinner + texto — paridad web `inline-block animate-spin rounded-full
  // h-8 w-8 border-b-2 border-primary` + `<p>Cargando productos...</p>`.
  loadingSpinner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.primary,
    borderLeftColor: 'transparent',
  },
  loadingText: {
    marginTop: spacing[3],
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium as any,
  },
  // Empty state POS — paridad web `flex flex-col items-center justify-center h-64 text-center p-8`.
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[16],
    gap: spacing[3],
  },
  emptyTile: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  emptyTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  emptyAction: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.background,
  },
  emptyActionText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
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
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: borderRadius.lg, // rounded-xl web
    marginBottom: spacing[2], // gap-2 web
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
  // ─── VariantPicker — Modal centrado (paridad web) ────────────────────────
  // Reemplaza el BottomSheet anterior. Layout replica `fixed inset-0 z-50
  // flex items-center justify-center` de apps/frontend pos-variant-selector.
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  modalBackdropLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '100%',
    maxWidth: 448, // web max-w-md (28rem = 448px)
    maxHeight: '80%',
    backgroundColor: colors.card,
    borderRadius: 16, // rounded-2xl web
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    // shadow-2xl web (~25px blur, 10% black)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantListContent: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  variantRowPressed: {
    backgroundColor: colorScales.gray[50],
    borderColor: colors.primary,
  },
  variantRowDisabled: {
    opacity: 0.5,
  },
  // Thumbnail 56×56 (paridad web `w-14 h-14 rounded-lg bg-muted/50`).
  variantThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  variantThumbImg: {
    width: '100%',
    height: '100%',
  },
  // Precio compareAt (line-through) — paridad web `text-[10px] text-text-muted line-through`.
  variantComparePrice: {
    fontSize: 10,
    color: colorScales.gray[400],
    textDecorationLine: 'line-through',
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

/**
 * Escape user-controlled values before interpolating into receipt HTML.
 * expo-print renders the string in a WebView; without escaping, a customer
 * name like `</td><script>...</script>` would break the layout or inject markup.
 */
function escapeReceiptHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateReceiptHtml(order: { orderNumber: string; items: any[]; summary: any; customer?: PosCustomer | null; paymentMethod: string }): string {
  const date = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const itemsHtml = order.items.map((item: any) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeReceiptHtml(item.product?.name || '')}${item.variant_display_name ? ` (${escapeReceiptHtml(item.variant_display_name)})` : ''}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${Number(item.quantity) || 0}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${Number(item.unitPrice).toLocaleString('es-CO')}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">$${Number(item.totalPrice).toLocaleString('es-CO')}</td>
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
        <div class="order-info">Orden #${escapeReceiptHtml(order.orderNumber)}<br>${date}</div>
      </div>
      ${order.customer ? `<p><strong>Cliente:</strong> ${escapeReceiptHtml(order.customer.first_name)} ${escapeReceiptHtml(order.customer.last_name)}</p>` : ''}
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
        <div class="row" style="margin-top: 10px; font-size: 12px;"><span>Método:</span><span>${escapeReceiptHtml(order.paymentMethod)}</span></div>
      </div>
      <div class="footer">¡Gracias por su compra!</div>
    </body>
    </html>
  `;
}

const ProductCard = ({
  product,
  onPress,
  width,
}: {
  product: Product;
  onPress: (product: Product) => void;
  width: number;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
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

  // Sale/promo logic — paridad web `hasActivePromoOrSale()`:
  //   is_on_sale === true AND sale_price > 0 AND sale_price < base_price
  // (active_promotion del backend todavía no está mapeada en el Product type
  // mobile — pendiente de Fase 4 cuando el payload `pos_optimized` lo incluya).
  const isOnSale =
    product.is_on_sale === true &&
    typeof product.sale_price === 'number' &&
    product.sale_price > 0 &&
    product.sale_price < (product.base_price ?? Infinity);
  const salePrice = isOnSale ? product.sale_price : null;

  const getStockText = () => {
    if (!tracksInventory) return null; // Web: oculta el inline label
    if (variantStockTotal === 0) return 'Sin stock';
    return `${variantStockTotal} en stock`;
  };

  const getStockTextColor = () => {
    if (!tracksInventory) return colorScales.blue[600];
    if (variantStockTotal === 0) return colors.error;
    if (variantStockTotal <= 5) return colors.warning;
    return colorScales.gray[500]; // Web: text-text-muted
  };

  const getStockBadge = () => {
    if (tracksInventory) {
      if (variantStockTotal === 0) return { label: 'AGOTADO', variant: 'error' as const }; // Web: uppercase
      if (variantStockTotal <= 5) return { label: `Últimas ${variantStockTotal}`, variant: 'warning' as const };
      return null; // Web: no muestra badge cuando hay stock normal
    } else {
      return { label: 'Disponible', variant: 'info' as const };
    }
  };

  const handlePressIn = () => {
    setPressed(true);
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    setPressed(false);
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
  // Web: para productos con variantes NO muestra el inline stock label
  // (el stock se valida al abrir el variant selector).
  const showInlineStock = stockText && !hasVariants;

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }]}>
      <Pressable
        onPress={isUnavailable ? undefined : () => onPress(product)}
        onPressIn={isUnavailable ? undefined : handlePressIn}
        onPressOut={isUnavailable ? undefined : handlePressOut}
        style={[
          productCardStyles.card,
          { width, height: width + 92 },
          pressed && productCardStyles.cardPressed,
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
              <Icon name="image" size={28} color="rgba(34, 197, 94, 0.6)" />
            </View>
          )}

          {/* Badges overlaid on image */}
          <View style={productCardStyles.badgesContainer} pointerEvents="none">
            {stockBadge && (
              <View style={productCardStyles.stockBadge}>
                <Badge
                  label={stockBadge.label}
                  variant={stockBadge.variant}
                  size="sm"
                />
              </View>
            )}

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

        {/* Product Name — 2 líneas con line-clamp-2 (paridad web) */}
        <View style={productCardStyles.nameContainer}>
          <Text
            style={[productCardStyles.name, pressed && productCardStyles.namePressed]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {product.name}
          </Text>
        </View>

        {/* Description — oculta en mobile (paridad web `hidden sm:block`) */}

        {/* Price + Stock row */}
        <View style={productCardStyles.row}>
          <View style={productCardStyles.priceContainer}>
            <View style={productCardStyles.priceRow}>
              <Text
                style={[
                  productCardStyles.price,
                  isOnSale && productCardStyles.priceOnSale,
                ]}
              >
                {formatCurrency(salePrice ?? product.final_price)}
                {product.pricing_type === 'weight' && (
                  <Text style={productCardStyles.priceWeightUnit}>
                    {' /kg'}
                  </Text>
                )}
              </Text>
              {isOnSale && (
                <Text style={productCardStyles.priceCompareAt}>
                  {formatCurrency(product.base_price ?? product.final_price)}
                </Text>
              )}
            </View>
            {showInlineStock && (
              <Text style={[productCardStyles.stockText, { color: stockTextColor }]}>
                {stockText}
              </Text>
            )}
          </View>

          {/* Dynamic round add-to-cart button */}
          <Pressable
            style={({ pressed: btnPressed }) => [
              productCardStyles.addToCartBtn,
              btnPressed && productCardStyles.addToCartBtnPressed,
              isUnavailable && productCardStyles.addToCartBtnDisabled,
            ]}
            onPress={isUnavailable ? undefined : () => onPress(product)}
          >
            <View style={productCardStyles.cartIconContainer}>
              <Icon name="shopping-cart" size={13} color={isUnavailable ? colorScales.gray[400] : '#FFFFFF'} />
              {!isUnavailable && (
                <View style={productCardStyles.plusBadge}>
                  <Icon name="plus" size={8} color={colors.primary} />
                </View>
              )}
            </View>
          </Pressable>
        </View>

        {/* Bottom row (SKU + + button) — ELIMINADO en mobile.
            Web: `hidden sm:flex` (toda la card es tap target). Mobile-first
            replica el comportamiento ocultándolo siempre. */}
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
  if (!product || !visible) return null;

  // Paridad web (pos-variant-selector.component.ts):
  //   <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  //     <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" />
  //     <div class="relative bg-surface rounded-2xl shadow-2xl border w-full max-w-md max-h-[80vh]">
  //       <header> + <variant-list>
  // Mobile replica con position absolute (RN Web soporta fixed/absolute vía styles).
  return (
    <View style={s.modalBackdrop} pointerEvents="auto">
      {/* Backdrop clickeable cierra modal (parity web `(click)="onBackdropClick"`). */}
      <Pressable style={s.modalBackdropLayer} onPress={onClose} />
      {/* Contenido del modal — stopPropagation evita cierre al click interno. */}
      <View style={s.modalContent}>
        {/* Header */}
        <View style={s.modalHeader}>
          <View style={s.flex1}>
            <Text style={s.sectionTitle}>Seleccionar variante</Text>
            <Text style={s.sectionSubtitle} numberOfLines={1}>{product.name}</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [s.modalCloseBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Cerrar selector de variante"
          >
            <Icon name="x" size={18} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        {/* Variant List — parity web `@for (variant of variants())`. */}
        <FlatList
          data={product.product_variants || []}
          keyExtractor={(item) => item.id.toString()}
          style={s.sheetFlex}
          contentContainerStyle={s.variantListContent}
          renderItem={({ item }) => {
            const hasSale = item.is_on_sale === true && item.sale_price != null;
            const displayPrice = hasSale ? item.sale_price! : (item.price_override != null ? item.price_override : product.final_price);
            const comparePrice = hasSale ? (item.price_override ?? product.final_price) : null;
            const tracksInventory = item.effective_track_inventory ?? product.track_inventory ?? true;
            const isUnavailable = tracksInventory && item.stock_quantity === 0;

            return (
              <Pressable
                onPress={() => onSelect(item)}
                disabled={isUnavailable}
                style={({ pressed }) => [
                  s.variantRow,
                  pressed && !isUnavailable ? s.variantRowPressed : undefined,
                  isUnavailable ? s.variantRowDisabled : undefined,
                ]}
              >
                {/* Thumbnail 56×56 — paridad web `w-14 h-14 rounded-lg bg-muted/50`.
                    El backend POS devuelve `variant.image_url` plano (NO `image.url`),
                    así que ese campo es la fuente de verdad. Si está ausente,
                    fallback al join `variant.image?.url` (forma legacy), luego al
                    producto padre, y por último ícono package. */}
                <View style={s.variantThumb}>
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={s.variantThumbImg}
                      resizeMode="cover"
                    />
                  ) : item.image?.image_url ? (
                    <Image
                      source={{ uri: item.image.image_url }}
                      style={s.variantThumbImg}
                      resizeMode="cover"
                    />
                  ) : product.image_url ? (
                    <Image
                      source={{ uri: product.image_url }}
                      style={s.variantThumbImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <Icon name="package" size={20} color={colorScales.gray[400]} />
                  )}
                </View>

                {/* Variant Info */}
                <View style={s.flex1}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.variantName} numberOfLines={1}>
                      {item.name || item.attributes || item.sku}
                    </Text>
                    {hasSale && (
                      <Badge label="OFERTA" variant="warning" size="sm" />
                    )}
                  </View>
                  <Text style={s.skuText}>SKU: {item.sku}</Text>
                </View>

                {/* Price & Stock */}
                <View style={s.itemsEnd}>
                  {hasSale && comparePrice != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={[s.variantPrice, { color: colors.error }]}>
                        {formatCurrency(displayPrice)}
                      </Text>
                      <Text style={s.variantComparePrice}>
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
                    <Text style={[s.stockText, { color: colorScales.gray[500] }]}>
                      Stock: {item.stock_quantity}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      </View>
    </View>
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
      <Icon name="trash-2" size={16} color={colors.error} />
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
        toastWarning(`Venta cerrada sin pago: ${result.fallbackReason}`, 3500);
      } else {
        toastSuccess(`Venta registrada: ${formatCurrency(summary.total)}`);
      }
      onSuccess(orderNumber, receiptData);
    },
    onError: (error) => {
      const parsed = parsePosCheckoutError(error);
      setSaleError({ message: parsed.message, details: parsed.details });
      toastError(parsed.message, 3500);
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
                La venta se cerrará como venta sin pago para no bloquear el punto de venta.
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

/**
 * Spinner rotatorio — paridad web `animate-spin` del bloque de loading del
 * `pos-product-selection.component`. Reemplaza al `<Spinner>` genérico.
 *
 * Usa `Animated.loop` con `rotate` interpolado 0° → 360° en 800ms (lineal
 * implícito para mantener el giro constante — `animate-spin` de Tailwind
 * también es lineal 1s).
 */
const PosLoaderSpinner = () => {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  return <Animated.View style={[s.loadingSpinner, { transform: [{ rotate }] }]} />;
};

const PosScreen = () => {
  const { width: windowWidth } = useResponsive();
  const [search, setSearch] = useState('');

  const numColumns = useMemo(() => {
    if (windowWidth < 640) return 2;
    if (windowWidth < 768) return 3;
    if (windowWidth < 1024) return 4;
    if (windowWidth < 1280) return 5;
    return 6;
  }, [windowWidth]);

  const cardWidth = useMemo(() => {
    const totalGaps = (numColumns - 1) * GRID_COLUMN_GAP;
    const padding = GRID_HORIZONTAL_PADDING * 2;
    return (windowWidth - padding - totalGaps) / numColumns;
  }, [windowWidth, numColumns]);
  const [showVariants, setShowVariants] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  // Cash register modals (paridad web `pos-header-dropdown.component`).
  const [showCashOpenModal, setShowCashOpenModal] = useState(false);
  const [showCashCloseModal, setShowCashCloseModal] = useState(false);
  const [showCashMovementModal, setShowCashMovementModal] = useState(false);
  const [showCashDetailModal, setShowCashDetailModal] = useState(false);
  // Modal-resumen "Crear orden" — paridad web `pos-order-create-modal`.
  // Aparece antes de persistir el borrador (paridad del annotation 5 del POS).
  const [showOrderCreateModal, setShowOrderCreateModal] = useState(false);

  // Sesión de caja activa — suscrita al store global `useCashRegisterStore`
  // para que el header y los 4 modales PosCash* reflejen cambios síncronos
  // tras open/close sin esperar un refetch. Se hidrata en mount desde
  // `GET /store/cash-registers/sessions/active` y se reconcilia solo si
  // diverge del valor actual (evita pisar un open reciente con un valor
  // stale del backend).
  const cashSession = useCashRegisterStore((s) => s.activeSession);

  const { data: activeSessionData } = useQuery({
    queryKey: ['cash-session-active'],
    queryFn: () => CashRegisterService.getActiveSession(),
    staleTime: 30_000,
  });

  // Hidratar el store cuando el query responda, pero solo si difiere para
  // evitar pisar un open reciente con un valor stale del backend.
  useEffect(() => {
    if (activeSessionData === undefined) return;
    const current = useCashRegisterStore.getState().activeSession;
    if (current?.id !== activeSessionData?.id) {
      useCashRegisterStore.getState().setActiveSession(activeSessionData);
    }
  }, [activeSessionData]);

  // Cierra TODOS los modales del checkout flow. Útil cuando el usuario
  // presiona X en cualquier paso del flujo y quiere volver limpio a la
  // pantalla de selección de productos sin quedar atrapado en un modal.
  const closeCheckoutModals = useCallback(() => {
    setShowCartModal(false);
    setShowPaymentModal(false);
    setShowShippingModal(false);
    setShowCustomItemModal(false);
    setShowCustomerModal(false);
    setShowOrderCreateModal(false);
  }, []);
  const [activeFilters, setActiveFilters] = useState<{
    category_id: string;
    brand_id: string;
    min_price: string;
    max_price: string;
    in_stock: boolean;
    sort_by: '' | 'name' | 'price' | 'stock' | 'createdAt';
    sort_order: 'asc' | 'desc';
  }>({
    category_id: '',
    brand_id: '',
    min_price: '',
    max_price: '',
    in_stock: false,
    sort_by: '',
    sort_order: 'asc',
  });

  /**
   * Número de filtros activos para pintar la badge sobre el botón filter.
   * Paridad web `activeFiltersCount` getter en `pos-product-search.component.ts`.
   */
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (activeFilters.category_id) n++;
    if (activeFilters.brand_id) n++;
    if (activeFilters.min_price) n++;
    if (activeFilters.max_price) n++;
    if (activeFilters.in_stock) n++;
    if (activeFilters.sort_by) n++;
    return n;
  }, [activeFilters]);
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptData, setReceiptData] = useState<{
    items: any[];
    summary: any;
    customer: any;
    paymentMethod: string;
  } | null>(null);

  const summary = useCartStore((s) => s.summary);
  const addItem = useCartStore((s) => s.addItem);
  const customer = useCartStore((s) => s.customer);
  const mode = useCartStore((s) => s.mode ?? 'sale');
  const cartItems = useCartStore((s) => s.items);
  const setMode = useCartStore((s) => s.setMode);
  const setCustomer = useCartStore((s) => s.setCustomer);

  const { data: products, isLoading } = useQuery({
    queryKey: ['pos-products', search, activeFilters],
    queryFn: () => {
      const params: any = {
        pos_optimized: true,
        limit: 50,
        state: 'active',
        include_variants: true,
        // Paridad web `pos-product-search.component` — el backend actual
        // puede ignorar min_price/max_price/in_stock/sort_by (DTO no los
        // declara); la app aplica fallback local en `productList` abajo.
        min_price: activeFilters.min_price ? Number(activeFilters.min_price) : undefined,
        max_price: activeFilters.max_price ? Number(activeFilters.max_price) : undefined,
        in_stock: activeFilters.in_stock || undefined,
        sort_by: activeFilters.sort_by || undefined,
        sort_order: activeFilters.sort_by ? activeFilters.sort_order : undefined,
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

  /**
   * Fallback cliente para los filtros que el backend actual no aplica:
   * - inStock
   * - minPrice / maxPrice
   * - sortBy + sortOrder
   *
   * El día que el backend respete estos params, este bloque se mantiene
   * inerte (no rompe nada). Paridad 1:1 con el comportamiento web.
   */
  const productList = useMemo(() => {
    if (!products) return [];
    const raw = Array.isArray(products) ? products : (products as any).data || [];
    let list = raw;

    // Stock filter — backend puede no aplicar.
    if (activeFilters.in_stock) {
      list = list.filter((p: Product) => {
        if (p.product_variants?.length) {
          return p.product_variants.some((v) => (v.stock_quantity ?? 0) > 0);
        }
        return (p.stock_quantity ?? 0) > 0;
      });
    }

    // Price range filter — backend puede no aplicar.
    const minP = activeFilters.min_price ? Number(activeFilters.min_price) : undefined;
    const maxP = activeFilters.max_price ? Number(activeFilters.max_price) : undefined;
    if (minP !== undefined || maxP !== undefined) {
      list = list.filter((p: Product) => {
        const price = Number(p.final_price ?? p.base_price ?? 0);
        if (minP !== undefined && price < minP) return false;
        if (maxP !== undefined && price > maxP) return false;
        return true;
      });
    }

    // Sort.
    if (activeFilters.sort_by) {
      const dir = activeFilters.sort_order === 'desc' ? -1 : 1;
      const sorted = [...list].sort((a: Product, b: Product) => {
        switch (activeFilters.sort_by) {
          case 'name':
            return dir * (a.name || '').localeCompare(b.name || '');
          case 'price':
            return (
              dir *
              (Number(a.final_price ?? a.base_price ?? 0) -
                Number(b.final_price ?? b.base_price ?? 0))
            );
          case 'stock': {
            const stockA = a.product_variants?.length
              ? Math.max(...a.product_variants.map((v) => v.stock_quantity ?? 0))
              : (a.stock_quantity ?? 0);
            const stockB = b.product_variants?.length
              ? Math.max(...b.product_variants.map((v) => v.stock_quantity ?? 0))
              : (b.stock_quantity ?? 0);
            return dir * (stockA - stockB);
          }
          case 'createdAt':
            return (
              dir *
              (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            );
          default:
            return 0;
        }
      });
      list = sorted;
    }

    return list;
  }, [products, activeFilters]);

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

  const handleSaveDraft = useCallback(async () => {
    const state = useCartStore.getState();
    const items = state.items;
    const summary = state.summary;
    const customer = state.customer;
    if (items.length === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    if (!customer) {
      toastWarning('Debe seleccionar un cliente antes de guardar');
      setShowCustomerModal(true);
      return;
    }
    setSavingDraft(true);
    try {
      const tenantStoreId = useTenantStore.getState().storeId;
      const authStoreId = useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id;
      const storeId = resolvePositiveId(tenantStoreId, authStoreId);
      if (!storeId) {
        toastError('La sesión no tiene una tienda activa');
        return;
      }

      const payload: CreatePosPaymentDto = {
        customer_id: Number(customer.id),
        customer_name: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim(),
        customer_email: customer.email ?? undefined,
        customer_phone: customer.phone ?? undefined,
        store_id: storeId,
        items: items.map((i) => ({
          product_id: i.product.id === 0 ? undefined : Number(i.product.id),
          product_variant_id: i.variant?.id ? Number(i.variant.id) : undefined,
          product_name: i.product.name,
          product_sku: i.product.sku || undefined,
          variant_sku: i.variant?.sku || undefined,
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
        requires_payment: false,
        delivery_type: 'direct_delivery',
        internal_notes: state.notes || undefined,
        update_inventory: false,
        allow_oversell: true,
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al guardar');
        return;
      }

      state.clearCart();
      toastSuccess('Guardado correctamente');
    } catch (error: any) {
      const data = error?.response?.data;
      const baseMsg = data?.message || error?.message || 'Error al guardar';
      const details = data?.details?.validationErrors;
      const fullMsg = details ? `${baseMsg}: ${details.join(', ')}` : baseMsg;
      toastError(fullMsg);
    } finally {
      setSavingDraft(false);
    }
  }, []);

  const handleCustomItem = useCallback(() => {
    setShowCustomItemModal(true);
  }, []);

  const handleShipping = useCallback(() => {
    setShowShippingModal(true);
  }, []);

  const handleShippingSuccess = useCallback((orderNumber: string) => {
    setOrderNumber(orderNumber);
    setShowSuccess(true);
  }, []);

  const handleAddCustomItem = useCallback((data: { name: string; description?: string; quantity: number; price: number; taxRate?: number }) => {
    useCartStore.getState().addCustomItem(data);
  }, []);

  // "Crear" — paridad web: abre `pos-order-create-modal` (resumen + cliente).
  // El modal dispara el POST contra `OrderService.processPosPayment` con
  // `requires_payment: false` (mismo path que el "Guardar" del payment modal).
  const handleCreate = useCallback(() => {
    if (summary.totalItems === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    setShowOrderCreateModal(true);
  }, [summary.totalItems]);

  // CTA primario del footer — despacha según el modo activo.
  // - `sale`     → abre modal de pago
  // - `quotation`→ crea cotización (Fase 4 — sólo placeholder)
  // - `layaway`  → abre layaway-config-modal (Fase 4 — sólo placeholder)
  const handlePrimaryCta = useCallback(() => {
    if (summary.totalItems === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    switch (mode) {
      case 'sale':
        setShowPaymentModal(true);
        return;
      case 'quotation':
        toastWarning('Próximamente: Crear cotización');
        return;
      case 'layaway':
        if (!customer) {
          toastWarning('Debes asignar un cliente para crear un plan separé');
          setShowCustomerModal(true);
          return;
        }
        toastWarning('Próximamente: Configurar plan separé');
        return;
    }
  }, [mode, customer, summary.totalItems]);

  // Cambia el modo del POS (POS / Cotizar / Separé). En paridad con el web
  // `pos.component.ts` (`setQuotationMode` / `setLayawayMode`), los handlers
  // reales (crear cotización / plan separé con sus servicios) viven en una
  // fase posterior — por ahora solo actualizamos el modo y dejamos que el
  // footer + header reflejen el cambio visualmente.
  const handleChangeMode = useCallback((next: PosMode) => {
    if (next === 'layaway' && !customer) {
      // Web: `if (!this.selectedCustomer()) { toast warning + open customer modal }`
      toastWarning('Debes asignar un cliente para crear un plan separé');
      setShowCustomerModal(true);
      return;
    }
    setMode(next);
  }, [customer, setMode]);

  // Limpia el cliente seleccionado desde el chip del header.
  const handleClearCustomer = useCallback(() => {
    setCustomer(null);
  }, [setCustomer]);

  return (
    <View style={[s.posRoot]}>
      {/* Header POS — paridad con el bloque inline del web pos.component.ts
          (logo + título + badge + customer chip + mode switcher). */}
      <PosScreenHeader
        mode={mode}
        customer={customer}
        onOpenCustomer={() => setShowCustomerModal(true)}
        onClearCustomer={handleClearCustomer}
        onChangeMode={handleChangeMode}
        cashSession={cashSession ?? null}
        // TODO: leer de store_settings (feature flag `cash_register_enabled`).
        // Mientras tanto asumimos habilitado — paridad con `cashRegisterEnabled()` web.
        showCashOpenButton
        onOpenCashRegister={() => setShowCashOpenModal(true)}
        onOpenCashDetail={() => setShowCashDetailModal(true)}
        onOpenCashMovement={() => setShowCashMovementModal(true)}
        onOpenCashClose={() => setShowCashCloseModal(true)}
      />

      {/* Search Bar - Con filtros y cliente como web */}
      <PosSearchBar
        onSearch={setSearch}
        onOpenFilters={() => setShowFilters(true)}
        onOpenAdd={() => setShowCustomerModal(true)}
        selectedCustomer={customer}
        activeFiltersCount={activeFilterCount}
        filtersOpen={showFilters}
      />

      {/* Product Grid - paridad web pos-product-selection.component */}
      {isLoading ? (
        <View style={s.centerContent}>
          {/* Spinner + texto — paridad web `animate-spin h-8 w-8 border-b-2 border-primary` + `Cargando productos...` */}
          <PosLoaderSpinner />
          <Text style={s.loadingText}>Cargando productos...</Text>
        </View>
      ) : productList.length === 0 ? (
        /* Empty state POS-específico — paridad web:
           - Tile 80×80 `rounded-2xl` con `package-open` icon
           - Título dinámico según haya search o no
           - Descripción
           - Botón "Limpiar búsqueda" condicional */
        <View style={s.emptyState}>
          <View style={s.emptyTile}>
            <Icon name="package-open" size={36} color={colors.primary} />
          </View>
          <Text style={s.emptyTitle}>
            {search ? 'No se encontraron productos' : 'No hay productos disponibles'}
          </Text>
          <Text style={s.emptyDescription}>
            {search
              ? 'Intenta buscar con otros términos o cambia la categoría.'
              : 'Los productos aparecerán aquí cuando estén disponibles.'}
          </Text>
          {search ? (
            <Pressable
              style={({ pressed }) => [s.emptyAction, pressed && { opacity: 0.7 }]}
              onPress={() => setSearch('')}
            >
              <Text style={s.emptyActionText}>Limpiar búsqueda</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          key={`products-grid-${numColumns}`}
          data={productList}
          keyExtractor={(item) => item.id.toString()}
          numColumns={numColumns}
          columnWrapperStyle={{ gap: GRID_COLUMN_GAP }}
          contentContainerStyle={{
            paddingTop: spacing[3],
            paddingHorizontal: GRID_HORIZONTAL_PADDING,
            paddingBottom: spacing[24],
          }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <ProductCard product={item} onPress={handleProductPress} width={cardWidth} />
          )}
        />
      )}

      {/* Mobile Footer - 3 filas como web, mode-aware primary CTA */}
      <PosMobileFooter
        itemCount={summary.totalItems}
        total={summary.total}
        taxAmount={summary.taxAmount}
        mode={mode}
        onViewCart={() => setShowCartModal(true)}
        onCustomItem={handleCustomItem}
        onCreate={handleCreate}
        onShipping={handleShipping}
        onPrimaryCta={handlePrimaryCta}
        canCreateCustomItems
      />

      {/* Cart Modal — bottom sheet con slide-up (paridad web). */}
      <PosCartModal
        visible={showCartModal}
        onClose={() => closeCheckoutModals()}
        items={cartItems}
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
        onCustomItem={() => {
          setShowCartModal(false);
          setShowCustomItemModal(true);
        }}
        onCreate={() => {
          setShowCartModal(false);
          setShowOrderCreateModal(true);
        }}
        onShipping={() => {
          setShowCartModal(false);
          setShowShippingModal(true);
        }}
        onCheckout={() => {
          setShowCartModal(false);
          setShowPaymentModal(true);
        }}
        canCreateCustomItems
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
          setShowPaymentModal(true);
        }}
      />

      {/* Payment Modal — cierre seguro: limpia TODO el checkout flow. */}
      <PosPaymentModal
        visible={showPaymentModal}
        onClose={() => closeCheckoutModals()}
        onSuccess={(orderNumber) => {
          closeCheckoutModals();
          setOrderNumber(orderNumber);
          setShowSuccess(true);
        }}
      />

      {/* Order Create Modal — modal-resumen antes de persistir el borrador.
          Paridad web: apps/frontend/.../pos-order-create-modal.component.ts */}
      <PosOrderCreateModal
        visible={showOrderCreateModal}
        onClose={() => setShowOrderCreateModal(false)}
      />

      {/* Success Modal */}
      <SuccessModal
        visible={showSuccess}
        orderNumber={orderNumber}
        onClose={handleCloseSuccess}
        receiptData={receiptData}
      />

      {/* Filter Dropdown */}
      <PosFilterDropdown
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApplyFilters={(filters) => setActiveFilters(filters)}
        currentFilters={activeFilters}
      />

      {/* Customer Modal */}
      <PosCustomerModal
        visible={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSelectCustomer={(customer: PosCustomer) => {
          useCartStore.getState().setCustomer(customer);
          toastSuccess(`Cliente seleccionado: ${customer.first_name} ${customer.last_name}`);
          setShowCustomerModal(false);
        }}
      />

      {/* Shipping Modal — cierre seguro: limpia TODO el checkout flow. */}
      <ShippingModal
        visible={showShippingModal}
        onClose={() => closeCheckoutModals()}
        onSuccess={handleShippingSuccess}
        onSelectCustomer={() => {
          setShowShippingModal(false);
          setShowCustomerModal(true);
        }}
      />

      {/* Custom Item Modal */}
      <PosCustomItemModal
        visible={showCustomItemModal}
        onClose={() => {
          setShowCustomItemModal(false);
          // Re-abre el cart modal para que el usuario siga editando.
          if (useCartStore.getState().items.length > 0) {
            setShowCartModal(true);
          }
        }}
        onAdd={handleAddCustomItem}
      />

      {/* Cash Register Modals — paridad con `pos-header-dropdown.component.ts` web.
          Los 4 modales leen/escriben del `useCashRegisterStore` y revalidan
          `['cash-session-active']` al cerrarse para que el badge del header
          refleje el nuevo estado de la sesión. */}
      <PosCashOpenModal
        visible={showCashOpenModal}
        onClose={() => setShowCashOpenModal(false)}
      />
      <PosCashDetailModal
        visible={showCashDetailModal}
        onClose={() => setShowCashDetailModal(false)}
        session={cashSession ?? null}
      />
      <PosCashMovementModal
        visible={showCashMovementModal}
        onClose={() => setShowCashMovementModal(false)}
        session={cashSession ?? null}
      />
      <PosCashCloseModal
        visible={showCashCloseModal}
        onClose={() => setShowCashCloseModal(false)}
        session={cashSession ?? null}
      />
    </View>
  );
};

export default PosScreen;
