import { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService, ProductService } from '@/features/store/services';
import type { Location, Product, ProductVariant, Supplier } from '@/features/store/types';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

interface PurchaseCartItem {
  id: string;
  product: Product;
  variant: ProductVariant | null;
  quantity: number;
  unitCost: number;
}

function itemKey(product: Product, variant?: ProductVariant | null): string {
  return `${product.id}:${variant?.id ?? 'base'}`;
}

function defaultUnitCost(product: Product, variant?: ProductVariant | null): number {
  return Number(variant?.cost_price ?? product.cost_price ?? product.base_price ?? 0) || 0;
}

export default function PurchaseInventoryScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [cartItems, setCartItems] = useState<PurchaseCartItem[]>([]);

  const { data: suppliersResponse, isLoading: suppliersLoading } = useQuery({
    queryKey: ['purchase-suppliers'],
    queryFn: () => InventoryService.getSuppliers({ limit: 100 }),
  });

  const { data: locationsResponse, isLoading: locationsLoading } = useQuery({
    queryKey: ['purchase-locations'],
    queryFn: () => InventoryService.getLocations({ limit: 100 }),
  });

  const { data: productsResponse, isLoading: productsLoading } = useQuery({
    queryKey: ['purchase-products', search],
    queryFn: () =>
      ProductService.list({
        limit: 40,
        search: search || undefined,
        state: 'active',
        product_type: 'physical',
        include_variants: true,
      }),
  });

  const suppliers = suppliersResponse?.data ?? [];
  const locations = locationsResponse?.data ?? [];
  const products = productsResponse?.data ?? [];

  const subtotal = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0),
    [cartItems],
  );

  const openProductConfig = (product: Product) => {
    const firstVariant = product.product_variants?.[0] ?? null;
    setSelectedProduct(product);
    setSelectedVariant(firstVariant);
    setQuantity('1');
    setUnitCost(String(defaultUnitCost(product, firstVariant)));
    setProductSheetOpen(true);
  };

  const addConfiguredItem = () => {
    if (!selectedProduct) return;
    const qty = Number(quantity);
    const cost = Number(unitCost);
    if (!Number.isFinite(qty) || qty <= 0) {
      toastError('Ingresa una cantidad valida');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toastError('Ingresa un costo valido');
      return;
    }

    const id = itemKey(selectedProduct, selectedVariant);
    setCartItems((current) => {
      const existing = current.find((item) => item.id === id);
      if (existing) {
        return current.map((item) =>
          item.id === id ? { ...item, quantity: item.quantity + qty, unitCost: cost } : item,
        );
      }
      return [...current, { id, product: selectedProduct, variant: selectedVariant, quantity: qty, unitCost: cost }];
    });
    setProductSheetOpen(false);
    setSelectedProduct(null);
    toastSuccess('Producto agregado a compra');
  };

  const createAndReceiveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSupplier || !selectedLocation || cartItems.length === 0) {
        throw new Error('Selecciona proveedor, bodega y al menos un producto');
      }

      const order = await InventoryService.createPurchaseOrder({
        supplier_id: Number(selectedSupplier.id),
        location_id: Number(selectedLocation.id),
        status: 'approved',
        order_date: new Date().toISOString(),
        subtotal_amount: subtotal,
        tax_amount: 0,
        total_amount: subtotal,
        notes: 'Compra creada desde Vendix Mobile',
        items: cartItems.map((item) => ({
          product_id: Number(item.product.id),
          product_variant_id: item.variant ? Number(item.variant.id) : undefined,
          quantity: item.quantity,
          unit_price: item.unitCost,
        })),
      });

      const receiveItems = (order.purchase_order_items || []).map((item) => ({
        id: item.id,
        quantity_received: item.quantity_ordered,
      }));

      if (receiveItems.length === 0) {
        throw new Error('La orden fue creada, pero no retorno items para recibir stock');
      }

      return InventoryService.receivePurchaseOrder(order.id, receiveItems, 'Stock recibido desde Vendix Mobile');
    },
    onSuccess: () => {
      setCartItems([]);
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-products'] });
      toastSuccess('Inventario comprado y recibido');
    },
    onError: (error) => {
      toastError(error instanceof Error ? error.message : 'Error al comprar inventario');
    },
  });

  return (
    <View style={styles.container}>
      <FlatList
        data={products}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.productColumns}
        ListHeaderComponent={
          <View>
            <View style={styles.configPanel}>
              <Pressable style={styles.configCard} onPress={() => setSupplierSheetOpen(true)}>
                <Icon name="store" size={18} color={colors.primary} />
                <View style={styles.configText}>
                  <Text style={styles.configLabel}>Proveedor</Text>
                  <Text style={styles.configValue} numberOfLines={1}>{selectedSupplier?.name || 'Seleccionar'}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
              </Pressable>

              <Pressable style={styles.configCard} onPress={() => setLocationSheetOpen(true)}>
                <Icon name="warehouse" size={18} color={colors.primary} />
                <View style={styles.configText}>
                  <Text style={styles.configLabel}>Bodega</Text>
                  <Text style={styles.configValue} numberOfLines={1}>{selectedLocation?.name || 'Seleccionar'}</Text>
                </View>
                <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <SearchBar placeholder="Buscar productos para comprar..." value={search} onChangeText={setSearch} />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.productCard} onPress={() => openProductConfig(item)}>
            <View style={styles.productAvatar}>
              <Text style={styles.productInitial}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
            <Text style={styles.productMeta} numberOfLines={1}>{item.sku || 'Sin SKU'}</Text>
            <Text style={styles.productCost}>{formatCurrency(defaultUnitCost(item))}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          productsLoading ? <Spinner /> : <EmptyState title="Sin productos" description="Crea productos antes de comprar inventario" icon="package" />
        }
        contentContainerStyle={styles.listContent}
      />

      {cartItems.length > 0 && (
        <View style={styles.footer}>
          <View>
            <Text style={styles.footerCount}>{cartItems.length} productos</Text>
            <Text style={styles.footerTotal}>{formatCurrency(subtotal)}</Text>
          </View>
          <Button
            title="Crear y recibir"
            onPress={() => createAndReceiveMutation.mutate()}
            loading={createAndReceiveMutation.isPending}
            disabled={!selectedSupplier || !selectedLocation}
          />
        </View>
      )}

      <BottomSheet visible={supplierSheetOpen} onClose={() => setSupplierSheetOpen(false)} snapPoint="partial">
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Proveedor</Text>
          {suppliersLoading ? <Spinner /> : suppliers.map((supplier) => (
            <Pressable key={supplier.id} style={styles.optionRow} onPress={() => { setSelectedSupplier(supplier); setSupplierSheetOpen(false); }}>
              <Text style={styles.optionTitle}>{supplier.name}</Text>
              <Text style={styles.optionSubtitle}>{supplier.email || supplier.phone || 'Proveedor activo'}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      <BottomSheet visible={locationSheetOpen} onClose={() => setLocationSheetOpen(false)} snapPoint="partial">
        <View style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Bodega</Text>
          {locationsLoading ? <Spinner /> : locations.map((location) => (
            <Pressable key={location.id} style={styles.optionRow} onPress={() => { setSelectedLocation(location); setLocationSheetOpen(false); }}>
              <Text style={styles.optionTitle}>{location.name}</Text>
              <Text style={styles.optionSubtitle}>{location.code || location.type}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      <BottomSheet visible={productSheetOpen} onClose={() => setProductSheetOpen(false)} snapPoint="partial">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>{selectedProduct?.name}</Text>
          {(selectedProduct?.product_variants?.length ?? 0) > 0 && (
            <View style={styles.variantWrap}>
              {selectedProduct?.product_variants?.map((variant) => (
                <Pressable
                  key={variant.id}
                  style={[styles.variantChip, selectedVariant?.id === variant.id && styles.variantChipActive]}
                  onPress={() => {
                    setSelectedVariant(variant);
                    setUnitCost(String(defaultUnitCost(selectedProduct, variant)));
                  }}
                >
                  <Text style={[styles.variantText, selectedVariant?.id === variant.id && styles.variantTextActive]}>
                    {variant.name || variant.sku}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Input label="Cantidad" value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
          <Input label="Costo unitario" value={unitCost} onChangeText={setUnitCost} keyboardType="decimal-pad" />
          <Button title="Agregar a compra" onPress={addConfiguredItem} fullWidth containerStyle={{ marginTop: spacing[4] }} />
        </KeyboardAvoidingView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  configPanel: { padding: spacing[4], gap: spacing[3] },
  configCard: {
    minHeight: 64,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    ...shadows.sm,
  },
  configText: { flex: 1 },
  configLabel: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], textTransform: 'uppercase', letterSpacing: 1 },
  configValue: { fontSize: typography.fontSize.base, color: colorScales.gray[900], fontWeight: '700' as any, marginTop: 2 },
  searchWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  productColumns: { justifyContent: 'space-between', paddingHorizontal: spacing[4] },
  productCard: {
    width: '48%' as any,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    padding: spacing[3],
    marginBottom: spacing[3],
    ...shadows.sm,
  },
  productAvatar: {
    width: '100%',
    height: 76,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginBottom: spacing[2],
  },
  productInitial: { fontSize: typography.fontSize['2xl'], fontWeight: '800' as any, color: colors.primary },
  productName: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[900] },
  productMeta: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  productCost: { fontSize: typography.fontSize.sm, color: colors.primary, fontWeight: '700' as any, marginTop: spacing[2] },
  listContent: { paddingBottom: 120 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    padding: spacing[4],
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[3],
    ...shadows.lg,
  },
  footerCount: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footerTotal: { fontSize: typography.fontSize.lg, color: colors.primary, fontWeight: '800' as any },
  sheetContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[4], gap: spacing[3] },
  sheetTitle: { fontSize: typography.fontSize.lg, color: colorScales.gray[900], fontWeight: '800' as any, marginBottom: spacing[2] },
  optionRow: { paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  optionTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  optionSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  variantWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[2] },
  variantChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, backgroundColor: colorScales.gray[100] },
  variantChipActive: { backgroundColor: colors.primary },
  variantText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700], fontWeight: '600' as any },
  variantTextActive: { color: colors.background },
});
