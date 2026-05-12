import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService, ProductService } from '@/features/store/services';
import type {
  Brand,
  CreateProductDto,
  CreateProductVariantDto,
  Product,
  ProductCategory,
  ProductState,
  TaxCategory,
  UpdateProductDto,
} from '@/features/store/types';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

type ProductMode = 'create' | 'edit';

interface VariantForm {
  localId: string;
  id?: number;
  sku: string;
  name: string;
  price_override: string;
  cost_price: string;
  profit_margin: string;
  is_on_sale: boolean;
  sale_price: string;
  stock_quantity: string;
}

interface ProductFormState {
  name: string;
  description: string;
  sku: string;
  base_price: string;
  cost_price: string;
  profit_margin: string;
  is_on_sale: boolean;
  sale_price: string;
  stock_quantity: string;
  track_inventory: boolean;
  available_for_ecommerce: boolean;
  state: ProductState;
  brand_id?: number;
  category_ids: number[];
  tax_category_ids: number[];
  has_variants: boolean;
  variants: VariantForm[];
  stock_by_location: Record<string, string>;
}

const initialForm: ProductFormState = {
  name: '',
  description: '',
  sku: '',
  base_price: '',
  cost_price: '',
  profit_margin: '',
  is_on_sale: false,
  sale_price: '',
  stock_quantity: '',
  track_inventory: true,
  available_for_ecommerce: true,
  state: 'active',
  brand_id: undefined,
  category_ids: [],
  tax_category_ids: [],
  has_variants: false,
  variants: [],
  stock_by_location: {},
};

function toNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function money(value?: number | null): string {
  return value == null ? '' : String(Number(value));
}

function createVariant(baseSku = ''): VariantForm {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    localId: `variant-${Date.now()}-${suffix}`,
    sku: baseSku ? `${baseSku}-${suffix}` : '',
    name: '',
    price_override: '',
    cost_price: '',
    profit_margin: '',
    is_on_sale: false,
    sale_price: '',
    stock_quantity: '0',
  };
}

function selectedVariant(hasValue: boolean): 'success' | 'default' {
  return hasValue ? 'success' : 'default';
}

interface ProductUpsertFormProps {
  mode: ProductMode;
  productId?: number;
}

export function ProductUpsertForm({ mode, productId }: ProductUpsertFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductFormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: product, isLoading: productLoading } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => ProductService.getById(Number(productId)),
    enabled: mode === 'edit' && !!productId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => ProductService.getCategories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['product-brands'],
    queryFn: () => ProductService.getBrands(),
  });

  const { data: taxes = [] } = useQuery({
    queryKey: ['product-taxes'],
    queryFn: () => ProductService.getTaxes(),
  });

  const { data: locationsResponse } = useQuery({
    queryKey: ['product-locations'],
    queryFn: () => InventoryService.getLocations({ limit: 100 }),
  });

  const locations = locationsResponse?.data ?? [];

  useEffect(() => {
    if (!product) return;
    const stockByLocation: Record<string, string> = {};
    ((product as Product & { stock_by_location?: { location_id: number; quantity: number }[] }).stock_by_location || []).forEach((stock) => {
      stockByLocation[String(stock.location_id)] = String(stock.quantity);
    });

    setForm({
      name: product.name || '',
      description: product.description || '',
      sku: product.sku || '',
      base_price: money(product.base_price),
      cost_price: money(product.cost_price),
      profit_margin: money(product.profit_margin),
      is_on_sale: !!product.is_on_sale,
      sale_price: money(product.sale_price),
      stock_quantity: String(product.stock_quantity ?? 0),
      track_inventory: product.track_inventory !== false,
      available_for_ecommerce: product.available_for_ecommerce !== false,
      state: product.state,
      brand_id: product.brand_id ?? undefined,
      category_ids: product.categories?.map((category) => category.id) ?? [],
      tax_category_ids: product.tax_assignments?.map((assignment) => assignment.tax_category_id) ?? [],
      has_variants: (product.product_variants?.length ?? 0) > 0,
      variants: (product.product_variants || []).map((variant) => ({
        localId: `variant-${variant.id}`,
        id: variant.id,
        sku: variant.sku || '',
        name: variant.name || '',
        price_override: money(variant.price_override),
        cost_price: money(variant.cost_price),
        profit_margin: money(variant.profit_margin),
        is_on_sale: !!variant.is_on_sale,
        sale_price: money(variant.sale_price),
        stock_quantity: String(variant.stock_quantity ?? 0),
      })),
      stock_by_location: stockByLocation,
    });
  }, [product]);

  const finalPreview = useMemo(() => {
    const base = toNumber(form.base_price) || 0;
    const sale = form.is_on_sale ? toNumber(form.sale_price) : undefined;
    return sale && sale > 0 ? sale : base;
  }, [form.base_price, form.is_on_sale, form.sale_price]);

  const updateField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updatePriceFromCostMargin = (costText: string, marginText: string) => {
    const cost = Number(costText);
    const margin = Number(marginText);
    if (!Number.isFinite(cost) || !Number.isFinite(margin) || cost <= 0) return;
    setForm((current) => ({ ...current, base_price: String(Math.round(cost * (1 + margin / 100))) }));
  };

  const updateMarginFromBase = (baseText: string, costText: string) => {
    const base = Number(baseText);
    const cost = Number(costText);
    if (!Number.isFinite(base) || !Number.isFinite(cost) || cost <= 0) return;
    setForm((current) => ({ ...current, profit_margin: String(Number((((base - cost) / cost) * 100).toFixed(2))) }));
  };

  const updateVariant = (localId: string, patch: Partial<VariantForm>) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) => (variant.localId === localId ? { ...variant, ...patch } : variant)),
    }));
  };

  const addVariant = () => {
    setForm((current) => ({ ...current, has_variants: true, variants: [...current.variants, createVariant(current.sku)] }));
  };

  const removeVariant = (localId: string) => {
    setForm((current) => ({ ...current, variants: current.variants.filter((variant) => variant.localId !== localId) }));
  };

  const toggleNumber = (key: 'category_ids' | 'tax_category_ids', id: number) => {
    setForm((current) => {
      const exists = current[key].includes(id);
      return { ...current, [key]: exists ? current[key].filter((currentId) => currentId !== id) : [...current[key], id] };
    });
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    const base = toNumber(form.base_price);
    const sale = toNumber(form.sale_price);
    if (!form.name.trim()) nextErrors.name = 'El nombre es requerido';
    if (!base || base <= 0) nextErrors.base_price = 'Ingresa un precio base valido';
    if (form.is_on_sale && sale != null && base != null && sale >= base) nextErrors.sale_price = 'La oferta debe ser menor al precio base';
    if (form.has_variants) {
      const skus = form.variants.map((variant) => variant.sku.trim()).filter(Boolean);
      if (form.variants.length === 0) nextErrors.variants = 'Agrega al menos una variante';
      if (skus.length !== new Set(skus).size) nextErrors.variants = 'Los SKU de variantes no se pueden repetir';
      form.variants.forEach((variant, index) => {
        const variantPrice = toNumber(variant.price_override) ?? base ?? 0;
        const variantSale = toNumber(variant.sale_price);
        if (!variant.sku.trim()) nextErrors[`variant-${index}`] = 'Cada variante necesita SKU';
        if (variant.is_on_sale && variantSale != null && variantSale >= variantPrice) {
          nextErrors[`variant-${index}`] = 'La oferta de variante debe ser menor al precio';
        }
      });
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const buildDto = (): CreateProductDto | UpdateProductDto => {
    const stockByLocation = Object.entries(form.stock_by_location)
      .map(([locationId, quantity]) => ({ location_id: Number(locationId), quantity: Number(quantity) || 0 }))
      .filter((stock) => stock.quantity > 0);

    const variants: CreateProductVariantDto[] | undefined = form.has_variants
      ? form.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku.trim(),
          name: variant.name.trim() || undefined,
          price_override: toNumber(variant.price_override),
          cost_price: toNumber(variant.cost_price),
          profit_margin: toNumber(variant.profit_margin),
          is_on_sale: variant.is_on_sale,
          sale_price: variant.is_on_sale ? toNumber(variant.sale_price) : undefined,
          stock_quantity: toNumber(variant.stock_quantity) ?? 0,
          track_inventory_override: null,
        }))
      : undefined;

    return {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      sku: form.sku.trim() || undefined,
      product_type: 'physical',
      pricing_type: 'unit',
      base_price: toNumber(form.base_price) || 0,
      cost_price: toNumber(form.cost_price),
      profit_margin: toNumber(form.profit_margin),
      is_on_sale: form.is_on_sale,
      sale_price: form.is_on_sale ? toNumber(form.sale_price) : undefined,
      stock_quantity: form.has_variants ? undefined : toNumber(form.stock_quantity),
      stock_by_location: !form.has_variants && stockByLocation.length > 0 ? stockByLocation : undefined,
      track_inventory: form.track_inventory,
      available_for_ecommerce: form.available_for_ecommerce,
      state: form.state,
      brand_id: form.brand_id ?? null,
      category_ids: form.category_ids,
      tax_category_ids: form.tax_category_ids,
      variants,
      stock_transfer_mode: 'distribute',
      variant_removal_stock_mode: 'first',
    };
  };

  const mutation = useMutation({
    mutationFn: (dto: CreateProductDto | UpdateProductDto) =>
      mode === 'edit' && productId ? ProductService.update(productId, dto) : ProductService.create(dto as CreateProductDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      toastSuccess(mode === 'edit' ? 'Producto actualizado' : 'Producto creado');
      router.back();
    },
    onError: (error) => {
      toastError(error instanceof Error ? error.message : 'Error al guardar producto');
    },
  });

  const submit = () => {
    if (!validate()) return;
    mutation.mutate(buildDto());
  };

  if (productLoading && mode === 'edit') {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Section title="Datos básicos" subtitle="Información visible en POS, catálogo e inventario">
            <Input label="Nombre" value={form.name} onChangeText={(value) => updateField('name', value)} error={errors.name} />
            <Input label="SKU" value={form.sku} onChangeText={(value) => updateField('sku', value.toUpperCase())} autoCapitalize="characters" />
            <Input label="Descripción" value={form.description} onChangeText={(value) => updateField('description', value)} multiline />
            <ChipRow label="Estado">
              {(['active', 'inactive'] as ProductState[]).map((state) => (
                <Pressable key={state} onPress={() => updateField('state', state)}>
                  <Badge label={state === 'active' ? 'Activo' : 'Inactivo'} variant={selectedVariant(form.state === state)} />
                </Pressable>
              ))}
            </ChipRow>
          </Section>

          <Section title="Precio y margen" subtitle={`Precio final estimado ${formatCurrency(finalPreview)}`}>
            <Input
              label="Costo"
              value={form.cost_price}
              onChangeText={(value) => {
                updateField('cost_price', value);
                updatePriceFromCostMargin(value, form.profit_margin);
              }}
              keyboardType="decimal-pad"
            />
            <Input
              label="Margen %"
              value={form.profit_margin}
              onChangeText={(value) => {
                updateField('profit_margin', value);
                updatePriceFromCostMargin(form.cost_price, value);
              }}
              keyboardType="decimal-pad"
            />
            <Input
              label="Precio base"
              value={form.base_price}
              onChangeText={(value) => {
                updateField('base_price', value);
                updateMarginFromBase(value, form.cost_price);
              }}
              keyboardType="decimal-pad"
              error={errors.base_price}
            />
            <ToggleRow label="En oferta" value={form.is_on_sale} onPress={() => updateField('is_on_sale', !form.is_on_sale)} />
            {form.is_on_sale && (
              <Input label="Precio de oferta" value={form.sale_price} onChangeText={(value) => updateField('sale_price', value)} keyboardType="decimal-pad" error={errors.sale_price} />
            )}
          </Section>

          <Section title="Inventario" subtitle="Stock inicial y visibilidad comercial">
            <ToggleRow label="Controlar inventario" value={form.track_inventory} onPress={() => updateField('track_inventory', !form.track_inventory)} />
            <ToggleRow label="Disponible en ecommerce" value={form.available_for_ecommerce} onPress={() => updateField('available_for_ecommerce', !form.available_for_ecommerce)} />
            {!form.has_variants && form.track_inventory && (
              <>
                <Input label="Stock inicial" value={form.stock_quantity} onChangeText={(value) => updateField('stock_quantity', value)} keyboardType="number-pad" />
                {locations.length > 0 && (
                  <View style={styles.locationStock}>
                    <Text style={styles.blockLabel}>Stock por bodega</Text>
                    {locations.map((location) => (
                      <View key={location.id} style={styles.locationRow}>
                        <View style={styles.locationName}>
                          <Text style={styles.locationTitle}>{location.name}</Text>
                          <Text style={styles.locationSubtitle}>{location.code || location.type}</Text>
                        </View>
                        <Input
                          label="Cantidad"
                          value={form.stock_by_location[String(location.id)] || ''}
                          onChangeText={(value) => setForm((current) => ({
                            ...current,
                            stock_by_location: { ...current.stock_by_location, [String(location.id)]: value },
                          }))}
                          keyboardType="number-pad"
                          style={styles.locationInput}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </Section>

          <Section title="Clasificación" subtitle="Categorías, marca e impuestos">
            <ChipRow label="Marca">
              <Pressable onPress={() => updateField('brand_id', undefined)}>
                <Badge label="Sin marca" variant={selectedVariant(!form.brand_id)} />
              </Pressable>
              {brands.map((brand: Brand) => (
                <Pressable key={brand.id} onPress={() => updateField('brand_id', brand.id)}>
                  <Badge label={brand.name} variant={selectedVariant(form.brand_id === brand.id)} />
                </Pressable>
              ))}
            </ChipRow>
            <ChipRow label="Categorías">
              {categories.map((category: ProductCategory) => (
                <Pressable key={category.id} onPress={() => toggleNumber('category_ids', category.id)}>
                  <Badge label={category.name} variant={selectedVariant(form.category_ids.includes(category.id))} />
                </Pressable>
              ))}
            </ChipRow>
            <ChipRow label="Impuestos">
              {taxes.map((tax: TaxCategory) => (
                <Pressable key={tax.id} onPress={() => toggleNumber('tax_category_ids', tax.id)}>
                  <Badge label={tax.name} variant={selectedVariant(form.tax_category_ids.includes(tax.id))} />
                </Pressable>
              ))}
            </ChipRow>
          </Section>

          <Section title="Variantes" subtitle="Opciones vendibles del producto">
            <ToggleRow label="Producto con variantes" value={form.has_variants} onPress={() => updateField('has_variants', !form.has_variants)} />
            {errors.variants && <Text style={styles.errorText}>{errors.variants}</Text>}
            {form.has_variants && (
              <View style={styles.variantList}>
                {form.variants.map((variant, index) => (
                  <View key={variant.localId} style={styles.variantCard}>
                    <View style={styles.variantHeader}>
                      <Text style={styles.variantTitle}>Variante {index + 1}</Text>
                      <Pressable onPress={() => removeVariant(variant.localId)} hitSlop={8}>
                        <Icon name="trash" size={16} color={colors.error} />
                      </Pressable>
                    </View>
                    {errors[`variant-${index}`] && <Text style={styles.errorText}>{errors[`variant-${index}`]}</Text>}
                    <Input label="Nombre" value={variant.name} onChangeText={(value) => updateVariant(variant.localId, { name: value })} />
                    <Input label="SKU" value={variant.sku} onChangeText={(value) => updateVariant(variant.localId, { sku: value.toUpperCase() })} autoCapitalize="characters" />
                    <Input label="Precio propio" value={variant.price_override} onChangeText={(value) => updateVariant(variant.localId, { price_override: value })} keyboardType="decimal-pad" />
                    <Input label="Costo" value={variant.cost_price} onChangeText={(value) => updateVariant(variant.localId, { cost_price: value })} keyboardType="decimal-pad" />
                    <Input label="Stock" value={variant.stock_quantity} onChangeText={(value) => updateVariant(variant.localId, { stock_quantity: value })} keyboardType="number-pad" />
                    <ToggleRow label="Variante en oferta" value={variant.is_on_sale} onPress={() => updateVariant(variant.localId, { is_on_sale: !variant.is_on_sale })} />
                    {variant.is_on_sale && (
                      <Input label="Precio oferta variante" value={variant.sale_price} onChangeText={(value) => updateVariant(variant.localId, { sale_price: value })} keyboardType="decimal-pad" />
                    )}
                  </View>
                ))}
                <Button title="Agregar variante" variant="outline" onPress={addVariant} leftIcon={<Icon name="plus" size={16} color={colors.primary} />} fullWidth />
              </View>
            )}
          </Section>
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Cancelar" variant="outline" onPress={() => router.back()} style={styles.footerButton} />
          <Button
            title={mode === 'edit' ? 'Guardar' : 'Crear'}
            onPress={submit}
            loading={mutation.isPending}
            style={styles.footerButton}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.blockLabel}>{label}</Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onPress}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackActive]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbActive]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  flex: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4], paddingBottom: 120, gap: spacing[4] },
  section: { backgroundColor: colors.background, overflow: 'hidden' },
  sectionHeader: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  sectionTitle: { fontSize: typography.fontSize.lg, fontWeight: '800' as any, color: colorScales.gray[900] },
  sectionSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: spacing[1] },
  sectionBody: { padding: spacing[4], gap: spacing[4] },
  chipBlock: { gap: spacing[2] },
  blockLabel: { fontSize: typography.fontSize.xs, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase', letterSpacing: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  toggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colorScales.gray[100], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], backgroundColor: colorScales.gray[50] },
  toggleLabel: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[800] },
  toggleTrack: { width: 44, height: 26, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[300], justifyContent: 'center', paddingHorizontal: 3 },
  toggleTrackActive: { backgroundColor: colors.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: borderRadius.full, backgroundColor: colors.background },
  toggleThumbActive: { alignSelf: 'flex-end' },
  locationStock: { gap: spacing[3] },
  locationRow: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  locationName: { flex: 1 },
  locationTitle: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[900] },
  locationSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  locationInput: { width: 120 },
  variantList: { gap: spacing[4] },
  variantCard: { borderWidth: 1, borderColor: colorScales.gray[100], borderRadius: borderRadius.xl, padding: spacing[3], gap: spacing[3], backgroundColor: colorScales.gray[50] },
  variantHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  variantTitle: { fontSize: typography.fontSize.base, fontWeight: '800' as any, color: colorScales.gray[900] },
  errorText: { color: colors.error, fontSize: typography.fontSize.xs, fontWeight: '600' as any },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing[3], padding: spacing[4], backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colorScales.gray[200], ...shadows.lg },
  footerButton: { flex: 1 },
});
