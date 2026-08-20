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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { CustomerService, OrderService, ProductService, ShippingService } from '@/features/store/services';
import { useCartStore, getLineSubtotal } from '@/features/store/pos/store/cart.store';
import {
  requiresSaleQuantityCapture,
  resolveQuantityStep,
  resolveSaleUnitConfig,
  resolveStockUnitsFromCapture,
  type SaleUnitConfig,
  type SaleUnitPresentation,
} from '@/features/store/pricing';
import { getUomCatalog } from '@/features/store/services/uom.service';
import { CashRegisterService } from '@/features/pos/services/cash-register.service';
import { PosTicketService, type PosTicketData } from '@/features/pos/services/pos-ticket.service';
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
  PosLayawayConfigModal,
  PosPresentationModal,
  PosSaleQuantityModal,
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
 * Datos que la venta deja listos para el tiquete. Es lo que `PaymentSheet`
 * entrega a `SuccessModal`; el documento en sí lo arma `PosTicketService`.
 */
type PosReceiptData = {
  items: any[];
  summary: any;
  customer: PosCustomer | null;
  paymentMethod: string;
  cashReceived?: number;
  change?: number;
};

/**
 * QUI-665 — traduce el carrito recién cobrado al contrato de tiquete.
 *
 * Acá NO se arma HTML. Antes esta pantalla escribía a mano una página web
 * (ancho en píxeles, `<table>` con cabecera gris, marca "Vendix" quemada, pie
 * quemado, `$`/`es-CO` quemados) y la mandaba a `Print.printAsync`, así que del
 * papel salía literalmente una página web y la configuración de impresión de la
 * tienda no la leía nadie. El documento ahora lo renderiza
 * `PosTicketService`, gemelo del renderizador de escritorio: mismo encabezado,
 * mismo desglose de impuestos, mismo pie y el mismo papel resuelto desde
 * `receipts.printing.pos_ticket`.
 */
function buildPosTicketData(order: { orderNumber: string } & PosReceiptData): PosTicketData {
  return {
    id: order.orderNumber,
    date: new Date(),
    items: (order.items ?? []).map((item: any) => ({
      id: item.id,
      name: `${item.product?.name ?? ''}${item.variant_display_name ? ` (${item.variant_display_name})` : ''}`,
      sku: item.product?.sku || undefined,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      totalPrice: Number(item.totalPrice) || 0,
      // El impuesto REAL de la línea, el que el carrito calculó y se mandó al
      // backend. El renderizador omite la línea cuando es 0 en vez de imprimir
      // un `Imp: 0.00%` inventado.
      tax: Number(item.taxAmount) || 0,
      // QUI-648 — la presentación en el papel. Sin esto un bulto x50 se imprime
      // igual que una unidad suelta y el cliente no puede auditar qué compró.
      // El renderizador ya sabe pintarlos (`PosTicketItem`).
      appliedPriceTierName: item.appliedPriceTierName ?? null,
      isPackageUnit: item.isPackageUnit === true,
      unitsPerPackage: item.unitsPerPackage ?? null,
      // QUI-648 fase 2 — la escala en la que el cajero capturó. Sin esto el
      // papel imprime "3000" donde el cliente pidió "3 m".
      saleUnitCode: item.saleUnitCode ?? null,
      stockUnitsPerSaleUnit: item.stockUnitsPerSaleUnit ?? null,
    })),
    subtotal: Number(order.summary?.subtotal) || 0,
    tax: Number(order.summary?.taxAmount) || 0,
    discount: Number(order.summary?.discountAmount) || 0,
    total: Number(order.summary?.total) || 0,
    paymentMethod: order.paymentMethod,
    cashReceived: order.cashReceived,
    change: order.change,
    customer: order.customer
      ? {
          name: `${order.customer.first_name ?? ''} ${order.customer.last_name ?? ''}`.trim(),
          email: order.customer.email || undefined,
          phone: order.customer.phone || undefined,
          taxId: order.customer.document_number || undefined,
        }
      : undefined,
  };
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
  onSuccess: (orderNumber: string, receiptData: PosReceiptData) => void;
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
      // CP-POS-CREAR-EDITAR-COBRAR-001 — el cliente es obligatorio.
      // `customer_id` debe ser un número > 0 o el backend rechaza el payload
      // (`POS_CUSTOMER_REQUIRED_001`). `handleConfirm` ya bloquea esta
      // entrada cuando el cliente falta, pero añadimos un guard defensivo.
      if (!customer || !Number.isFinite(Number(customer.id)) || Number(customer.id) <= 0) {
        throw new PosCheckoutError(
          'Selecciona o crea un cliente antes de cobrar. (POS_CUSTOMER_REQUIRED_001)',
          ['customer_id faltante o inválido en mobile'],
          false,
        );
      }

      const buildPayload = (
        requiresPayment: boolean,
        method: PaymentMethod | null,
        updateInventory: boolean,
      ): CreatePosPaymentDto => ({
        customer_id: Number(customer.id),
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
          // `unit_price` es el precio PUBLICADO (por `price_unit_quantity`
          // unidades de stock, o por paquete si la linea lleva presentacion).
          // El total lo resuelve `getLineSubtotal`, que aplica la escala y
          // redondea una sola vez al final.
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number(getLineSubtotal(i).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
          // El backend re-resuelve `stock_units_consumed` desde la tarifa; el
          // cliente solo declara CUAL presentacion aplico.
          applied_price_tier_id: i.appliedPriceTierId ?? undefined,
        })),
        subtotal: Number(summary.subtotal.toFixed(2)),
        tax_amount: Number(summary.taxAmount.toFixed(2)),
        discount_amount: Number(summary.discountAmount.toFixed(2)),
        total_amount: Number(summary.total.toFixed(2)),
        // CP-POS-CREAR-EDITAR-COBRAR-001 — el cobro es SIEMPRE
        // `is_draft=false, requires_payment=true`. El fallback "venta sin
        // pago" se eliminó: ya no aceptamos órdenes anónimas.
        is_draft: false,
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
      const response = await processSale(buildPayload(requiresPayment, selectedMethod, true));
      return {
        response,
        paymentMethodLabel: selectedMethod ? getPaymentMethodLabel(selectedMethod) : 'Venta sin pago',
      };
    },
    onMutate: () => {
      setSaleError(null);
    },
    onSuccess: (result) => {
      const orderNumber = result.response.order?.order_number || result.response.order?.id?.toString() || '---';
      const receiptData: PosReceiptData = {
        items,
        summary,
        customer,
        paymentMethod: result.paymentMethodLabel,
        // Efectivo recibido y cambio solo cuando el método es efectivo: el
        // tiquete de escritorio imprime ese par y hasta ahora el móvil lo
        // perdía en el camino.
        ...(isCash && received > 0
          ? { cashReceived: received, change: Math.max(0, change) }
          : {}),
      };
      clearCart();
      // Round 3 MAJOR #12 — the `editAfterSave` flag lives in the
      // `PosScreen` component; the `PaymentSheet` doesn't have access to
      // its setter. Reset happens at the next cart mount / sale start.
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      // CP-POS-CREAR-EDITAR-COBRAR-001 — sin fallback anónimo: el cliente es
      // obligatorio y el cobro se hace siempre con método de pago o vía
      // "Guardar orden" (draft).
      toastSuccess(`Venta registrada: ${formatCurrency(summary.total)}`);
      onSuccess(orderNumber, receiptData);
    },
    onError: (error) => {
      const parsed = parsePosCheckoutError(error);
      setSaleError({ message: parsed.message, details: parsed.details });
      toastError(parsed.message, 3500);
    },
  });

  const handleConfirm = () => {
    // CP-POS-CREAR-EDITAR-COBRAR-001 — el cliente es obligatorio. Bloqueamos
    // el cobro si falta o no pertenece al store (`POS_CUSTOMER_REQUIRED_001`).
    if (!customer || !Number.isFinite(Number(customer.id)) || Number(customer.id) <= 0) {
      toastError(
        'Selecciona o crea un cliente antes de cobrar. (POS_CUSTOMER_REQUIRED_001)',
      );
      return;
    }
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
  receiptData?: PosReceiptData | null;
}) => {
  const [printing, setPrinting] = useState(false);

  // Imprimir y Compartir arman el MISMO documento: los dos pasan por
  // `PosTicketService`, que resuelve papel, moneda, encabezado y pie desde la
  // configuración de la tienda. Antes cada botón se armaba su propio HTML.
  const handlePrint = useCallback(async () => {
    if (!receiptData) return;
    setPrinting(true);
    try {
      await PosTicketService.print(buildPosTicketData({ orderNumber, ...receiptData }));
    } catch {
      toastError('Error al imprimir');
    }
    setPrinting(false);
  }, [orderNumber, receiptData]);

  const handleShare = useCallback(async () => {
    if (!receiptData) return;
    setPrinting(true);
    try {
      await PosTicketService.share(buildPosTicketData({ orderNumber, ...receiptData }));
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
  // QUI-648 — selector de presentación de venta (bulto, caja, rollo).
  const [showPresentations, setShowPresentations] = useState(false);
  const [presentationProduct, setPresentationProduct] = useState<Product | null>(null);
  // QUI-648 fase 2 — captura de cantidad en la unidad de venta ("3 metros").
  const [saleQuantityProduct, setSaleQuantityProduct] = useState<Product | null>(null);
  const [saleQuantityConfig, setSaleQuantityConfig] = useState<SaleUnitConfig | null>(null);
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
  // Round 3 MAJOR #12 — flipped to true after a successful editor save. The
  // footer CTA changes from "Guardar cambios" to "Cobrar" so the cashier can
  // take payment without leaving the POS. Cleared when the cart is cleared or
  // when the operator starts a fresh sale.
  const [editAfterSave, setEditAfterSave] = useState(false);
  // CP-POS-CREAR-EDITAR-COBRAR-001 — ID del draft en edición al que el
  // modal de cobro debe enrutar (`flowPayOrder`). Se setea cuando el
  // operador está editando una orden persistida y va a cobrar; el modal
  // lo lee del prop para armar el payload de `flow/pay`. En venta nueva
  // queda `null` y el modal cae al path `processPosPayment`.
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  // Local mirror for the footer's "Ítem" action button. The mobile POS does
  // not gate custom-line creation by mode today; the prop simply needs a
  // boolean. Default `true` keeps parity with the prior behaviour.
  const canCreateCustomItems = true;
  // Cash register modals (paridad web `pos-header-dropdown.component`).
  const [showCashOpenModal, setShowCashOpenModal] = useState(false);
  const [showCashCloseModal, setShowCashCloseModal] = useState(false);
  const [showCashMovementModal, setShowCashMovementModal] = useState(false);
  const [showCashDetailModal, setShowCashDetailModal] = useState(false);
  // Modal-resumen "Crear orden" — paridad web `pos-order-create-modal`.
  // Aparece antes de persistir el borrador (paridad del annotation 5 del POS).
  const [showOrderCreateModal, setShowOrderCreateModal] = useState(false);

  // Modal "Configurar Plan Separé" — paridad web `layaway-config-modal`
  // (apps/frontend/.../layaway-config-modal.component.ts). Reemplaza el
  // placeholder toast que tenía el `case 'layaway'` de `handlePrimaryCta`
  // antes de QUI-499.
  const [showLayawayConfigModal, setShowLayawayConfigModal] = useState(false);

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
  // CP-POS-CREAR-EDITAR-COBRAR-001 — además limpiamos `editingDraftId`
  // para que la próxima apertura del modal de cobro no quede pre-armada
  // con el ID de un draft que ya se cerró / pagó / canceló.
  const closeCheckoutModals = useCallback(() => {
    setShowCartModal(false);
    setShowPaymentModal(false);
    setShowShippingModal(false);
    setShowCustomItemModal(false);
    setShowCustomerModal(false);
    setShowOrderCreateModal(false);
    setShowLayawayConfigModal(false);
    setEditingDraftId(null);
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
  const [receiptData, setReceiptData] = useState<PosReceiptData | null>(null);

  const summary = useCartStore((s) => s.summary);
  const addItem = useCartStore((s) => s.addItem);
  const customer = useCartStore((s) => s.customer);
  const mode = useCartStore((s) => s.mode ?? 'sale');
  const cartItems = useCartStore((s) => s.items);
  const setMode = useCartStore((s) => s.setMode);
  const setCustomer = useCartStore((s) => s.setCustomer);
  // CP-POS-CREAR-EDITAR-COBRAR-001 — cuando hay un draft cargado en el cart
  // store (`draftId != null`), el footer del POS está editando una orden
  // existente: el botón "Crear" debe persistir los cambios sobre el draft
  // vía `handleSaveDraft`, NO abrir `pos-order-create-modal` (que es para
  // nuevos borradores).
  const draftId = useCartStore((s) => (s as any).draftId ?? null);

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

  /**
   * QUI-648 — catálogo de presentaciones de la TIENDA
   * (`price_tiers.kind='sale_unit'`). Se pide una sola vez por sesión de POS y
   * se cruza en memoria con el allowlist de cada producto: el catálogo es de
   * tienda, el allowlist es del par (producto, presentación).
   */
  const { data: saleUnitTiers = [] } = useQuery({
    queryKey: ['pos-sale-unit-tiers'],
    queryFn: () => ProductService.getSaleUnitTiers(),
    staleTime: 5 * 60 * 1000,
  });

  /**
   * Presentaciones ofrecibles del producto abierto en el selector. Solo se
   * dispara cuando el producto tiene allowlist: un producto sin presentaciones
   * ni siquiera abre el modal, así que esta query no corre.
   */
  const { data: productPresentations = [], isFetching: presentationsLoading } = useQuery({
    queryKey: ['pos-product-presentations', presentationProduct?.id],
    queryFn: () =>
      ProductService.getSaleUnitPresentations(presentationProduct!, {
        tiers: saleUnitTiers,
      }),
    enabled: !!presentationProduct && showPresentations,
  });

  /**
   * QUI-648 fase 2 — catálogo global de `units_of_measure`. Es de solo lectura
   * y cambia únicamente cuando el seed agrega una unidad, así que se pide una
   * vez por sesión. Sin él la resolución cae a "por pieza" y el POS vende
   * exactamente como antes: nunca se inventa una conversión.
   */
  const { data: uomCatalog = [] } = useQuery({
    queryKey: ['uom-catalog'],
    queryFn: () => getUomCatalog(),
    staleTime: 30 * 60 * 1000,
  });

  /**
   * Abre la captura en unidad de venta si el producto se mide; devuelve `false`
   * cuando el producto va por pieza y el caller debe seguir su camino normal.
   */
  const openSaleQuantityCapture = useCallback(
    (product: Product): boolean => {
      const config = resolveSaleUnitConfig(product, uomCatalog);
      if (!requiresSaleQuantityCapture(config)) return false;
      setSaleQuantityProduct(product);
      setSaleQuantityConfig(config);
      return true;
    },
    [uomCatalog],
  );

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
        return;
      }

      // Multi-tarifa ⊕ variantes es exclusivo por regla de negocio, así que
      // esta rama solo se alcanza para productos SIN variantes. Con allowlist
      // el cajero elige la presentación; sin allowlist se agrega suelto,
      // exactamente como antes de esta feature.
      if ((product.enabled_price_tier_ids?.length ?? 0) > 0) {
        setPresentationProduct(product);
        setShowPresentations(true);
        return;
      }

      // QUI-648 fase 2 — un producto MEDIDO se captura en su unidad de venta:
      // el cajero pide "3 metros" y el carrito guarda 3000 mm. Solo entra acá
      // el que declara unidad de stock CON una unidad de captura distinta; el
      // resto —todo el catálogo por pieza— se sigue agregando de un toque.
      if (openSaleQuantityCapture(product)) return;

      addItem(product, null, 1);
      toastSuccess(`${product.name} agregado`);
    },
    [addItem, openSaleQuantityCapture],
  );

  const handlePresentationSelect = useCallback(
    (presentation: SaleUnitPresentation | null) => {
      const product = presentationProduct;
      setShowPresentations(false);
      setPresentationProduct(null);
      if (!product) return;

      // "Suelto" sobre un producto medido significa vender en su unidad de
      // venta ("3 metros"), no una unidad mínima suelta (1 mm). Con
      // presentación elegida `quantity` cuenta paquetes y no hay conversión.
      if (!presentation && openSaleQuantityCapture(product)) return;

      addItem(product, null, 1, presentation);
      toastSuccess(
        presentation
          ? `${product.name} · ${presentation.name} agregado`
          : `${product.name} agregado`,
      );
    },
    [presentationProduct, addItem, openSaleQuantityCapture],
  );

  /**
   * Cierra la captura agregando la línea. `amount` viene en unidades de
   * CAPTURA (3 = "3 metros") y se convierte acá a la unidad mínima, que es la
   * que viaja en `order_items.quantity`. La unidad de captura se anota en la
   * línea solo para poder volver a mostrarla en esa escala.
   */
  const handleSaleQuantityConfirm = useCallback(
    (amount: number) => {
      const product = saleQuantityProduct;
      const config = saleQuantityConfig;
      setSaleQuantityProduct(null);
      setSaleQuantityConfig(null);
      if (!product || !config) return;

      const quantity = resolveStockUnitsFromCapture(amount, config.unitsPerCapture);
      const unitCode = config.captureUnit?.code ?? config.stockUnit?.code ?? '';
      if (quantity <= 0) {
        // Redondear a cero sería vender aire. El modal ya bloquea el botón;
        // esto cubre el caso de que la configuración cambie entre medio.
        toastWarning(`La cantidad mínima es 1 ${config.stockUnit?.code ?? 'unidad'}`);
        return;
      }

      addItem(product, null, quantity, null, {
        code: unitCode,
        unitsPerCapture: config.unitsPerCapture,
      });
      toastSuccess(`${product.name} · ${amount} ${unitCode} agregado`);
    },
    [saleQuantityProduct, saleQuantityConfig, addItem],
  );

  const handleSaleQuantityClose = useCallback(() => {
    setSaleQuantityProduct(null);
    setSaleQuantityConfig(null);
  }, []);

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

  const handleChargeSuccess = useCallback((num: string, data: PosReceiptData) => {
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
    // CP-POS-CREAR-EDITAR-COBRAR-001 — el backend rechaza borradores sin
    // cliente (`POS_CUSTOMER_REQUIRED_001`). Bloqueamos el guardado si
    // falta y abrimos el selector para que el operador pueda asignarlo.
    if (
      !customer ||
      !Number.isFinite(Number(customer.id)) ||
      Number(customer.id) <= 0
    ) {
      toastError(
        'Selecciona o crea un cliente antes de guardar la orden. (POS_CUSTOMER_REQUIRED_001)',
      );
      setShowCustomerModal(true);
      return;
    }
    // CP-POS-CREAR-EDITAR-COBRAR-001 — cuando hay un `draftId` cargado en el
    // cart store, el guardado NO crea un nuevo draft: edita la orden
    // existente vía `PUT /store/orders/:id/editor`. Esto evita:
    //   1. doble cobro (un PUT no muta state ni dispara cobros).
    //   2. órdenes huérfanas al "Guardar" sobre un draft persistido.
    // `updateOrderEditor` re-resuelve totales server-side (es la fuente de
    // verdad) y devuelve la `Order` canónica.
    const editingDraftId = (state as any).draftId ? Number((state as any).draftId) : null;
    setSavingDraft(true);
    try {
      const tenantStoreId = useTenantStore.getState().storeId;
      const authStoreId = useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id;
      const storeId = resolvePositiveId(tenantStoreId, authStoreId);
      if (!storeId) {
        toastError('La sesión no tiene una tienda activa');
        setSavingDraft(false);
        return;
      }

      if (editingDraftId != null && Number.isFinite(editingDraftId) && editingDraftId > 0) {
        // === MODO EDICIÓN ===
        // El editor atómico backend solo acepta campos de negocio (items,
        // cliente, notas, envío, cupón). NO acepta state/payment/is_draft.
        const editorItems = items.map((i) => ({
          product_id: i.product.id === 0 ? undefined : Number(i.product.id),
          product_variant_id: i.variant?.id ? Number(i.variant.id) : undefined,
          product_name: i.product.name,
          product_sku: i.product.sku || undefined,
          variant_sku: i.variant?.sku || undefined,
          quantity: i.quantity,
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number(getLineSubtotal(i).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          // Round 3 MINOR #14 — `tax_rate` was being stripped from the
          // mobile editor payload, so the backend recomputed `tax_amount_item`
          // from a fresh `tax_rate` lookup. The cashier then saw a different
          // number on the tiquete than the one they typed. The mobile cart
          // doesn't carry an explicit `taxRate` per line — derive from
          // `taxAmount / (finalPrice * quantity)` so the value the editor
          // sends matches what the cart already computed (mirror web parity
          // where `taxRate` is the source of truth).
          tax_rate:
              Number(i.taxAmount) > 0 && Number(i.finalPrice) > 0 && Number(i.quantity) > 0
                ? Number(
                    (
                      (Number(i.taxAmount) /
                        (Number(i.finalPrice) * Number(i.quantity))) *
                      100
                    ).toFixed(4),
                  )
                : 0,
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
          applied_price_tier_id: i.appliedPriceTierId ?? undefined,
        }));
        const editorPayload = {
          items: editorItems,
          customer_id: Number(customer.id),
          internal_notes: state.notes || undefined,
          delivery_type: 'direct_delivery' as const,
        };
        const updatedOrder = await OrderService.updateOrderEditor(editingDraftId, editorPayload);
        // Round 3 MAJOR #12 — after a successful editor save, open the
        // payment modal directly so the cashier can "Cobrar" without a
        // second navigation. We keep the cart hydrated with the fresh totals
        // (server returns the canonical order) and flip into the payment
        // modal — the footer CTA "Cobrar" stays in lock-step because the
        // cart now has the latest server-validated totals.
        toastSuccess(
          updatedOrder?.order_number
            ? `Cambios guardados en ${updatedOrder.order_number}`
            : 'Cambios guardados',
        );
        // Leave the cart populated so the footer + payment modal keep working
        // until the cashier either collects payment or cancels. The footer's
        // primary CTA now reads "Cobrar" (driven by `editAfterSave`).
        // CP-POS-CREAR-EDITAR-COBRAR-001 — pasamos por el helper
        // centralizado para que el modal quede pre-armado con
        // `editingDraftId` y enrute por `flowPayOrder` (Round 5 fix).
        setEditAfterSave(true);
        setEditingDraftId(editingDraftId);
        setShowPaymentModal(true);
        return;
      }

      // === MODO NUEVO BORRADOR ===
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
          // `unit_price` es el precio PUBLICADO (por `price_unit_quantity`
          // unidades de stock, o por paquete si la linea lleva presentacion).
          // El total lo resuelve `getLineSubtotal`, que aplica la escala y
          // redondea una sola vez al final.
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number(getLineSubtotal(i).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
          // El backend re-resuelve `stock_units_consumed` desde la tarifa; el
          // cliente solo declara CUAL presentacion aplico.
          applied_price_tier_id: i.appliedPriceTierId ?? undefined,
        })),
        subtotal: Number(summary.subtotal.toFixed(2)),
        tax_amount: Number(summary.taxAmount.toFixed(2)),
        discount_amount: Number(summary.discountAmount.toFixed(2)),
        total_amount: Number(summary.total.toFixed(2)),
        // CP-POS-CREAR-EDITAR-COBRAR-001 fase B.2 — Guardar es SIEMPRE un
        // draft sin pago. Backend valida `is_draft=true ∧ requires_payment=false`
        // y rechaza combinaciones inválidas con `POS_DRAFT_REQUIRES_PAYMENT_001`.
        is_draft: true,
        requires_payment: false,
        delivery_type: 'direct_delivery',
        internal_notes: state.notes || undefined,
        update_inventory: false,
        // NOTA: `allow_oversell` ya NO se manda. El backend lo ignora para
        // borradores y para cobros sin stock el rechazo viene por
        // `POS_STOCK_INSUFFICIENT_001`. Enviar `true` aquí era solo
        // client-intent misleading — el server es la fuente de verdad.
        // El DTO sigue aceptándolo (`forbidNonWhitelisted: true`) pero el
        // mobile ya no declara la intención.
        // Coupon attachment — el cart store mobile todavía NO trackea cupones
        // (ver `cart.store.ts`), así que ambos campos quedan fuera del
        // payload. Round 3 MAJOR #13 — NO incluimos `coupon_id` /
        // `coupon_code`: serializar `undefined` en JSON lo omite, pero
        // algunos validadores del backend y clientes HTTP convierten la
        // ausencia a `null`, y los validadores Prisma/Class-Validator
        // distinguen entre ambas formas. La ausencia explícita (clave
        // omitida) es la opción segura.
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al guardar');
        return;
      }

      state.clearCart();
      // Round 3 MAJOR #12 — once the new draft is created we are no longer
      // in "edit-then-charge" mode; the next sale starts fresh.
      setEditAfterSave(false);
      toastSuccess('Guardado correctamente');
    } catch (error: any) {
      const data = error?.response?.data;
      const errorCode = data?.error_code || data?.code;
      const requestId = data?.request_id || error?.response?.headers?.['x-request-id'];
      const baseMsg = data?.message || error?.message || 'Error al guardar';
      const details = data?.details?.validationErrors;
      const fullMsg = details ? `${baseMsg}: ${details.join(', ')}` : baseMsg;
      const codeSuffix = errorCode ? ` (${errorCode})` : '';
      const requestSuffix = requestId ? ` [req=${requestId}]` : '';
      // Log estructurado para correlacionar el toast del operador con el log
      // del backend (AllExceptionsFilter guarda el mismo `request_id`).
      // No leak de PII: solo IDs y códigos de error.
      // Re-leemos los stores aquí porque `storeId`/`customer` están en scope
      // del `try` y TypeScript no los ve en `catch`.
      // eslint-disable-next-line no-console
      console.error('[pos][saveDraft] failed', {
        store_id: useTenantStore.getState().storeId ?? useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id,
        customer_id: customer ? Number(customer.id) : undefined,
        request_id: requestId,
        error_code: errorCode,
        status: error?.response?.status,
      });
      toastError(`${fullMsg}${codeSuffix}${requestSuffix}`);
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

  // CP-POS-CREAR-EDITAR-COBRAR-001 — helper centralizado del camino
  // "después de editar el draft, cobra". Lee `draftId` del cart store y,
  // si está presente, abre el modal de cobro pre-armado para enrutar el
  // cobro por `OrderService.flowPayOrder(draftId, ...)`. Si NO hay draft,
  // abre el modal en modo venta nueva (cae a `processPosPayment`).
  //
  // Es la MISMA función invocada por:
  //   1. El CTA primario del footer ("Cobrar" tras `editAfterSave=true`).
  //   2. El botón "Cobrar" interno del modal (`PosPaymentModal`) que ya
  //      enruta por `flowPayOrder` cuando `editingDraftIdProp != null`.
  //
  // Antes del Round 5 fix, el modal creaba una orden nueva con
  // `processPosPayment` en vez de cargar al draft — este helper garantiza
  // que el prop `editingDraftId` quede seteado ANTES de abrir el modal.
  const openPaymentModalForCharge = useCallback(() => {
    const stateDraftId = useCartStore.getState().draftId;
    const nextDraftId =
      stateDraftId && Number.isFinite(Number(stateDraftId)) && Number(stateDraftId) > 0
        ? Number(stateDraftId)
        : null;
    setEditingDraftId(nextDraftId);
    setShowPaymentModal(true);
  }, []);

  // CTA primario del footer — despacha según el modo activo.
  // - `sale` + draft cargado (edit-mode, sin `editAfterSave`) → persiste los
  //   cambios sobre el draft existente (`handleSaveDraft` → editor atómico
  //   backend). El cobro va en la siguiente pulsación del CTA una vez
  //   `editAfterSave=true` dispara `openPaymentModalForCharge`.
  // - `sale` (sin draft o post-save) → abre el modal de cobro vía
  //   `openPaymentModalForCharge` (que setea `editingDraftId` para enrutar
  //   a `flowPayOrder` si hay draft, o `processPosPayment` si no).
  // - `quotation`→ crea cotización (Fase 4 — sólo placeholder)
  // - `layaway`  → abre `PosLayawayConfigModal` (paridad con desktop
  //   `LayawayConfigModalComponent`, ver QUI-499). El modal POSTea
  //   directo a `POST /store/layaway` vía `LayawayService.create` y
  //   no fluye por `PosOrderCreateModal` (R1 del plan).
  const handlePrimaryCta = useCallback(() => {
    if (summary.totalItems === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    // QUI-audit-round-2: en modo edición del draft, "Cobrar" debe persistir
    // sobre el draft, NO abrir el flujo de venta nueva. Mientras el editor
    // no haya guardado, el CTA es "Guardar cambios" (lo decide el footer
    // vía `isEditMode && !editAfterSave`); tras el guardado, el CTA pasa a
    // "Cobrar" y entra a `sale` normal usando el helper centralizado.
    if (mode === 'sale' && draftId != null && !editAfterSave) {
      void handleSaveDraft();
      return;
    }
    switch (mode) {
      case 'sale':
        openPaymentModalForCharge();
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
        setShowLayawayConfigModal(true);
        return;
    }
  }, [mode, customer, summary.totalItems, draftId, editAfterSave, handleSaveDraft, openPaymentModalForCharge]);

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
        onEdit={handleSaveDraft}
        onShipping={handleShipping}
        onPrimaryCta={handlePrimaryCta}
        isEditMode={draftId != null}
        canCreateCustomItems={canCreateCustomItems}
        editAfterSave={editAfterSave}
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
          // QUI-648 fase 2 — el stepper se mueve de a UNA unidad de venta: una
          // línea capturada en metros sube 1 m (1000 mm) por toque, no 1 mm.
          // `resolveQuantityStep` devuelve 1 para toda línea sin unidad de
          // captura, así que el catálogo por pieza se comporta igual que hoy.
          const item = useCartStore.getState().items.find((i) => i.id === id);
          if (item)
            useCartStore
              .getState()
              .updateQuantity(id, item.quantity + resolveQuantityStep(item));
        }}
        onDecreaseQuantity={(id) => {
          const item = useCartStore.getState().items.find((i) => i.id === id);
          if (!item) return;
          // El piso es UNA unidad de venta: bajar de "1 m" a "0,999 m" no es
          // una cantidad que un cajero quiera, y llegar a 0 borraría la línea
          // desde un botón que no es el de borrar.
          const step = resolveQuantityStep(item);
          const next = item.quantity - step;
          if (next >= step) useCartStore.getState().updateQuantity(id, next);
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
        onSaveDraft={() => {
          // Paridad con web: persiste el cart como orden en draft y
          // notifica al usuario sin disparar el modal de pago.
          useCartStore.getState().markAsDraft(`DRAFT_${Date.now()}`);
          toastSuccess('Borrador guardado');
        }}
        hasDraft={useCartStore.getState().draftId != null}
        onCheckout={() => {
          setShowCartModal(false);
          // En modo `layaway`, "Finalizar Venta" no abre el payment modal
          // (no hay nada que cobrar aún — el plan difiere el pago). Dispara
          // directamente el modal de configuración de cuotas (paridad web
          // `pos.component.ts:onLayaway`, QUI-499 R2).
          if (mode === 'layaway') {
            if (!customer) {
              toastWarning('Debes asignar un cliente para crear un plan separé');
              setShowCustomerModal(true);
              return;
            }
            setShowLayawayConfigModal(true);
            return;
          }
          // CP-POS-CREAR-EDITAR-COBRAR-001 — checkout desde el cart modal
          // debe pasar por el helper centralizado para preservar el camino
          // de edición de draft (si hay `draftId`, el modal cobra con
          // `flowPayOrder`; si no, con `processPosPayment`).
          openPaymentModalForCharge();
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

      {/* Selector de presentación de venta (QUI-648) */}
      <PosPresentationModal
        visible={showPresentations}
        product={presentationProduct}
        presentations={productPresentations}
        loading={presentationsLoading}
        onSelect={handlePresentationSelect}
        onClose={() => {
          setShowPresentations(false);
          setPresentationProduct(null);
        }}
      />

      {/* QUI-648 fase 2 — captura en la unidad de venta ("3 metros"). */}
      <PosSaleQuantityModal
        visible={!!saleQuantityProduct && !!saleQuantityConfig}
        product={saleQuantityProduct}
        config={saleQuantityConfig}
        onConfirm={handleSaleQuantityConfirm}
        onClose={handleSaleQuantityClose}
      />

      {/* Cart Panel (legacy) */}
      <CartPanel
        visible={showCart}
        onClose={() => setShowCart(false)}
        onCharge={() => {
          setShowCart(false);
          openPaymentModalForCharge();
        }}
      />

      {/* Payment Modal — cierre seguro: limpia TODO el checkout flow.
          CP-POS-CREAR-EDITAR-COBRAR-001 — pasamos `editingDraftId` para que
          el modal enrute por `flowPayOrder` cuando hay draft en edición
          (seteado por `openPaymentModalForCharge`). El modal también hace
          fallback al `draftId` del cart store por si el padre lo omite. */}
      <PosPaymentModal
        visible={showPaymentModal}
        onClose={() => closeCheckoutModals()}
        editingDraftId={editingDraftId}
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

      {/* Layaway Config Modal — Plan Separé mobile (QUI-499).
          Paridad web: apps/frontend/.../layaway-config-modal.component.ts */}
      <PosLayawayConfigModal
        visible={showLayawayConfigModal}
        onClose={() => setShowLayawayConfigModal(false)}
        onSuccess={(planNumber) => {
          closeCheckoutModals();
          setOrderNumber(planNumber);
          setShowSuccess(true);
        }}
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
