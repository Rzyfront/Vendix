import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService, ProductService, PromotionsService } from '@/features/store/services';
import type {
  Brand,
  CreateProductDto,
  CreateProductVariantDto,
  PricingType,
  Product,
  ProductCategory,
  ProductState,
  ProductType,
  TaxCategory,
  UpdateProductDto,
  PriceTier,
} from '@/features/store/types';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { MoneyInput } from '@/shared/components/money-input/money-input';
import { MultiSelector } from '@/shared/components/multi-selector/multi-selector';
import { Selector } from '@/shared/components/selector/selector';
import { InputButtons } from '@/shared/components/input-buttons/input-buttons';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { Textarea } from '@/shared/components/textarea/textarea';
import { TaxCreateModal } from '@/features/store/components/tax-create-modal';
import { ImageSourceModal, type UploadedImage } from '@/features/store/components/image-source-modal';
import { ImageEditModal } from '@/features/store/components/image-edit-modal';
import { Toggle } from '@/shared/components/toggle/toggle';
import PopConfigModal from '@/features/pop/components/pop-config-modal';
import StockAdjustmentModal from '@/features/store/components/stock-adjustment-location-modal';
import InventoryDetailModal from '@/features/store/components/inventory-detail-modal';
import type { ConsolidatedStock } from '@/features/store/types';
import {
  cartesian,
  getVariantKey,
  parseVariantAttributes,
} from '@/features/store/utils/variant-attributes';
import { ChipInput } from '@/shared/components/chip-input/chip-input';
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
  /**
   * Atributos de la variante (ej. { Color: "Rojo", Talla: "S" }). Sólo se
   * persiste si la variante fue auto-generada desde la matriz de
   * atributos; las variantes legacy (sin matriz) lo dejan en undefined.
   */
  attributes?: Record<string, string>;
}

/**
 * Atributo de variante — espejo del web `VariantAttribute`.
 * Una variante se genera como producto cartesiano de los `values`
 * de cada atributo.
 */
interface VariantAttribute {
  name: string;
  values: string[];
}

interface PriceTierOverrideForm {
  /** ID de la tarifa a la que aplica el override. */
  tier_id: number;
  /** Precio final del producto bajo esta tarifa. */
  price: string;
  /** Margen (%) sobre el costo. Helper: al cambiarlo se recalcula
   *  `price = cost * (1 + margin/100)`. Al persistir sólo se envía
   *  `price` al backend. */
  margin: string;
  /** Unidades por empaque para esta tarifa. Vacío = hereda de la tarifa. */
  units_per_package: string;
}

interface ProductFormState {
  name: string;
  description: string;
  sku: string;
  slug: string;
  barcode: string;
  product_type: ProductType;
  pricing_type: PricingType;
  base_price: string;
  cost_price: string;
  profit_margin: string;
  is_on_sale: boolean;
  sale_price: string;
  stock_quantity: string;
  track_inventory: boolean;
  available_for_ecommerce: boolean;
  is_featured: boolean;
  allow_pos_price_override: boolean;
  // Restaurant Suite toggles (Fase A additive, exposed in Fase B)
  is_sellable?: boolean;
  is_ingredient?: boolean;
  is_combo?: boolean;
  is_batch_produced?: boolean;
  // Unidades de medida para Restaurant Suite (sólo se usan cuando
  // `is_ingredient = true`).
  purchase_uom_id?: number;
  stock_uom_id?: number;
  state: ProductState;
  // Mirror web: en el form la marca se maneja como array
  // (`brand_ids`) para usar MultiSelector. En el DTO se serializa
  // como `brand_id` (primer elemento) para mantener compatibilidad
  // con el backend.
  brand_ids?: number[];
  category_ids: number[];
  tax_category_ids: number[];
  has_variants: boolean;
  variants: VariantForm[];
  /**
   * Atributos que definen la matriz de variantes (Color, Talla, Material…).
   * Las variantes se auto-generan como producto cartesiano de `attributes`.
   */
  attributes: VariantAttribute[];
  /**
   * Claves estable-serializadas (`getVariantKey`) de variantes que el
   * usuario eliminó manualmente. La reconciliación las respeta — no se
   * resurrectan al regenerar la matriz.
   */
  removedVariantKeys: string[];
  /**
   * Working list derivada de `attributes` con reconciliación no
   * destructiva. Se mantiene sincronizada con `variants` para no romper
   * el resto del form; el DTO enviado al backend se construye desde
   * `variants` (= `generatedVariants` siempre).
   */
  generatedVariants: VariantForm[];
  stock_by_location: Record<string, string>;
  // Precios multi-tarifa
  has_multiple_price_tiers?: boolean;
  enabled_price_tier_ids?: number[];
  /**
   * Overrides por tarifa (precio + unidades por empaque). El margen
   * (campo del UI) es solo un helper para calcular el precio: al
   * persistir se envía el `price` calculado = cost * (1 + margin/100).
   */
  price_tier_overrides?: PriceTierOverrideForm[];
  // Dimensiones y peso
  length?: string;
  width?: string;
  height?: string;
  weight_input?: string;
  // Otras configuraciones (mirror web)
  requires_serial_numbers?: boolean;
  preparation_time_minutes?: string;
  // Promociones (multi-select de IDs de promociones aplicadas al producto)
  promotion_ids?: number[];
  // Servicio
  service_duration_minutes?: string;
  service_modality?: string;
  service_pricing_type?: string;
  requires_booking?: boolean;
  is_recurring?: boolean;
  // Compra online (solo edit)
  online_purchase_url?: string;
}

/**
 * Single resolved tax line shown in the pricing breakdown sub-card.
 * Mirrors the web's `taxBreakdown`: one row per selected tax category,
 * using the category's first `tax_rates[0].rate` (matches `app-input` parity).
 */
interface TaxBreakdownItem {
  id: number;
  name: string;
  /** Decimal rate, e.g. 0.19 for 19% */
  rate: number;
  /** base_price * rate */
  amount: number;
}

/**
 * Variable labels for the pricing fields. The web version swaps "Costo" →
 * "Costo por kg" and "Precio base" → "Precio por kg (PVP)" when
 * `pricing_type === 'weight'`.
 */
const PRICING_LABELS: Record<PricingType, { cost: string; base: string; type: string }> = {
  unit: { cost: 'Precio de Costo', base: 'Precio Base (PVP)', type: 'Tipo de Venta' },
  weight: { cost: 'Costo por kg', base: 'Precio por kg (PVP)', type: 'Tipo de Venta' },
};

/**
 * Unidades de medida disponibles para configurar insumos
 * (Restaurant Suite). Mirror del web: las opciones se cargan estáticas
 * porque coinciden con las semillas base del backend
 * (`product_stock_uoms`). Cuando el usuario selecciona "Es insumo"
 * aparecen dos selectores (Compra / Stock) con estas opciones.
 */
const UOM_OPTIONS: { label: string; value: number }[] = [
  { label: 'Gramo (g)', value: 1 },
  { label: 'Kilogramo (kg)', value: 3 },
  { label: 'Miligramo (mg)', value: 2 },
  { label: 'Mililitro (ml)', value: 4 },
  { label: 'Litro (L)', value: 5 },
  { label: 'Unidad (unit)', value: 6 },
];

const initialForm: ProductFormState = {
  name: '',
  description: '',
  sku: '',
  slug: '',
  barcode: '',
  product_type: 'physical',
  pricing_type: 'unit',
  base_price: '',
  cost_price: '',
  profit_margin: '',
  is_on_sale: false,
  sale_price: '',
  stock_quantity: '',
  track_inventory: true,
  available_for_ecommerce: true,
  is_featured: false,
  allow_pos_price_override: false,
  // Restaurant Suite defaults: al crear un producto, los flags de
  // restaurante (Fase A) arrancan en false hasta que el usuario los
  // active explícitamente. is_sellable por defecto true para no
  // romper la UX existente (los productos son vendibles por default).
  is_sellable: true,
  is_ingredient: false,
  is_combo: false,
  is_batch_produced: false,
  purchase_uom_id: undefined,
  stock_uom_id: undefined,
  state: 'active',
  brand_ids: [],
  category_ids: [],
  tax_category_ids: [],
  has_variants: false,
  variants: [],
  attributes: [],
  removedVariantKeys: [],
  generatedVariants: [],
  stock_by_location: {},
  has_multiple_price_tiers: false,
  enabled_price_tier_ids: [],
  price_tier_overrides: [],
  length: '',
  width: '',
  height: '',
  weight_input: '',
  requires_serial_numbers: false,
  preparation_time_minutes: '',
  service_duration_minutes: '',
  service_modality: '',
  service_pricing_type: '',
  requires_booking: false,
  is_recurring: false,
  online_purchase_url: '',
};

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function money(value?: number | null): string {
  return value == null ? '' : String(Number(value));
}

/**
 * Reconstruye la matriz de `attributes` recorriendo las variantes
 * persistidas y agrupando `(attribute_name) → Set<attribute_value>`.
 * Espejo del web `loadProduct` (apps/frontend/.../product-create-page.component.ts:1749).
 *
 * Si ninguna variante tiene attributes (legacy / productos sin matriz),
 * devuelve `[]`.
 */
function rebuildAttributesFromVariants(
  variants?: Array<{ attributes?: unknown }>,
): VariantAttribute[] {
  if (!variants || variants.length === 0) return [];
  const map = new Map<string, Set<string>>();
  for (const v of variants) {
    const attrs = parseVariantAttributes(v.attributes);
    for (const [k, val] of Object.entries(attrs)) {
      const set = map.get(k) ?? new Set<string>();
      set.add(val);
      map.set(k, set);
    }
  }
  return Array.from(map.entries()).map(([name, set]) => ({
    name,
    values: Array.from(set),
  }));
}

/**
 * Convierte las variantes persistidas al `VariantForm` con `attributes`
 * parseado. Defiende contra el drift de tipos (backend envía objeto,
 * type lo declara string).
 */
function hydrateVariantsFromProduct(
  variants?: Array<{
    id: number;
    sku?: string | null;
    name?: string | null;
    attributes?: unknown;
    price_override?: number | null;
    cost_price?: number | null;
    profit_margin?: number | null;
    is_on_sale?: boolean | null;
    sale_price?: number | null;
    stock_quantity?: number | null;
  }>,
): VariantForm[] {
  if (!variants || variants.length === 0) return [];
  return variants.map((variant) => ({
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
    attributes: parseVariantAttributes(variant.attributes),
  }));
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
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [localTaxes, setLocalTaxes] = useState<TaxCategory[]>([]);
  const [imageSourceOpen, setImageSourceOpen] = useState(false);
  const [imageEditorUri, setImageEditorUri] = useState<string | null>(null);
  // Breakpoint para UoM grid (1 col en mobile, 1fr_auto_1fr en md+).
  const { width: screenW } = useWindowDimensions();
  const isMdUp = screenW >= 768;
  const [productImages, setProductImages] = useState<string[]>([]);
  const [showPopConfig, setShowPopConfig] = useState(false);
  const [showStockLocationModal, setShowStockLocationModal] = useState(false);
  // Popup "Detalle de Inventario" — se abre al pulsar 'Ver detalle completo'.
  // Lazy: la query de consolidated-stock sólo se activa cuando el modal está abierto.
  const [showStockDetailModal, setShowStockDetailModal] = useState(false);
  // Flag para no sobrescribir `price_tier_overrides` cada vez que se
  // re-fetchea el producto. Sólo hidratamos desde el backend la primera
  // vez; las selecciones del usuario se preservan en re-fetches.
  const tierOverridesHydrated = useRef(false);
  const promotionsHydrated = useRef(false);

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

  // Bodegas / ubicaciones de la tienda actual (para el modal de ajuste
  // de stock y el selector de ubicación en StockAdjustmentModal).
  // Se carga lazy cuando el modal se abre por primera vez.
  const locationsQuery = useQuery({
    queryKey: ['inventory-locations'],
    queryFn: () => InventoryService.getLocations({ limit: 100 }),
  });
  const inventoryLocations = locationsQuery.data?.data ?? [];

  // Promociones activas (para la sección Promociones & Operaciones).
  const { data: activePromotions = [] } = useQuery({
    queryKey: ['promotions', 'active'],
    queryFn: () => PromotionsService.getActive(),
  });

  // Lista de tarifas de precio (multi-tarifa). Se cargan siempre que
  // el usuario active el toggle, para que pueda elegir cuáles aplican.
  const { data: priceTiers = [] } = useQuery({
    queryKey: ['price-tiers'],
    queryFn: () => ProductService.getPriceTiers({ is_active: true }),
  });

  // Overrides de precio por tarifa para el producto actual (sólo en
  // edit mode). Se hidrata al re-editar para mostrar los precios
  // personalizados previamente guardados. staleTime: 0 para forzar
  // fetch fresco cada vez que se abre el form.
  const { data: productTierOverrides = [] } = useQuery({
    queryKey: ['product-price-tier-overrides', productId],
    queryFn: () => ProductService.getProductPriceTierOverrides(Number(productId)),
    enabled: mode === 'edit' && !!productId,
    staleTime: 0,
  });

  const { data: taxes = [] } = useQuery({
    queryKey: ['product-taxes'],
    queryFn: () => ProductService.getTaxes(),
  });

  const allTaxes = useMemo(() => {
    const apiTaxes = (taxes as TaxCategory[]) || [];
    if (localTaxes.length === 0) return apiTaxes;
    const existingIds = new Set(apiTaxes.map(t => t.id));
    return [...apiTaxes, ...localTaxes.filter(t => !existingIds.has(t.id))];
  }, [taxes, localTaxes]);

  const { data: locationsResponse } = useQuery({
    queryKey: ['product-locations'],
    queryFn: () => InventoryService.getLocations({ limit: 100 }),
  });

  const locations = locationsResponse?.data ?? [];

  // Stock consolidado del producto — sólo se carga al abrir el popup
  // 'Detalle de Inventario' (lazy) para no penalizar el render del form.
  const consolidatedStockQuery = useQuery({
    queryKey: ['consolidated-stock', productId],
    queryFn: () => InventoryService.getConsolidatedStock(Number(productId)),
    enabled: mode === 'edit' && !!productId && showStockDetailModal,
    staleTime: 0,
  });

  useEffect(() => {
    if (!product) return;
    const stockByLocation: Record<string, string> = {};
    ((product as Product & { stock_by_location?: { location_id: number; quantity: number }[] }).stock_by_location || []).forEach((stock) => {
      stockByLocation[String(stock.location_id)] = String(stock.quantity);
    });

    const ext = product as Product & {
      slug?: string;
      barcode?: string;
      product_type?: ProductType;
      pricing_type?: PricingType;
      is_featured?: boolean;
      allow_pos_price_override?: boolean;
      enabled_price_tier_ids?: number[];
    };

    setForm({
      name: product.name || '',
      description: product.description || '',
      sku: product.sku || '',
      slug: ext.slug || '',
      barcode: ext.barcode || '',
      product_type: ext.product_type || 'physical',
      pricing_type: ext.pricing_type || 'unit',
      base_price: money(product.base_price),
      cost_price: money(product.cost_price),
      profit_margin: money(product.profit_margin),
      is_on_sale: !!product.is_on_sale,
      sale_price: money(product.sale_price),
      stock_quantity: String(product.stock_quantity ?? 0),
      track_inventory: product.track_inventory !== false,
      available_for_ecommerce: product.available_for_ecommerce !== false,
      is_featured: !!ext.is_featured,
      allow_pos_price_override: !!ext.allow_pos_price_override,
      // Restaurant Suite toggles (Fase A additive, exposed in Fase B)
      is_sellable: !!(product as any).is_sellable,
      is_ingredient: !!(product as any).is_ingredient,
      is_combo: !!(product as any).is_combo,
      is_batch_produced: !!(product as any).is_batch_produced,
      purchase_uom_id: (product as any).purchase_uom_id ?? undefined,
      stock_uom_id: (product as any).stock_uom_id ?? undefined,
      // Hidratamos el flag de multi-tarifa desde el producto para que
      // la sección quede visible al re-editar un producto que ya
      // tenía tarifas configuradas.
      has_multiple_price_tiers: !!(product as any).has_multiple_price_tiers,
      state: product.state,
      // brand_ids es un array en el form. Lo hidratamos desde el
      // `brand_id` (single) del producto para mantener el binding.
      brand_ids: product.brand_id ? [product.brand_id] : [],
      category_ids: product.categories?.map((category) => category.id) ?? [],
      tax_category_ids: product.product_tax_assignments?.map((assignment) => assignment.tax_category_id) ?? [],
      enabled_price_tier_ids: ext.enabled_price_tier_ids ?? [],
      has_variants: (product.product_variants?.length ?? 0) > 0,
      // Reconstruir `attributes` desde las variantes existentes del producto.
      // Recorremos cada variante, parseamos su JSON `attributes` y
      // agrupamos por nombre → set único de valores. Esto reconstruye
      // la matriz que el usuario configuró originalmente (espejo del
      // web `loadProduct` líneas 1749–1761).
      attributes: rebuildAttributesFromVariants(product.product_variants),
      variants: hydrateVariantsFromProduct(product.product_variants),
      generatedVariants: hydrateVariantsFromProduct(product.product_variants),
      removedVariantKeys: [],
      stock_by_location: stockByLocation,
    });

    // Cargar imágenes existentes del producto (si las hay).
    // El backend devuelve `product_images` con `image_url` por registro
    // (key firmada si la imagen vive en S3).
    const existingImages = (product.product_images || [])
      .map((img) => img.image_url)
      .filter((url): url is string => Boolean(url));
    if (existingImages.length > 0) {
      setProductImages(existingImages);
    } else {
      setProductImages([]);
    }

    // Overrides por tarifa. Se obtienen del query separado
    // `product-price-tier-overrides` (el endpoint principal del producto
    // no incluye esta relación). Sólo hidratamos UNA vez para no
    // sobrescribir las selecciones del usuario con re-fetches.
    //
    // El backend NO almacena el margen (sólo `override_price`); lo
    // recalculamos al re-editar con la fórmula:
    //   margin = (price / cost - 1) * 100
    // de modo que el campo Margen (%) muestre el valor correcto al
    // volver a abrir el form.
    if (productTierOverrides.length > 0 && !tierOverridesHydrated.current) {
      tierOverridesHydrated.current = true;
      // product.cost_price es number|null. Lo convertimos a string para
      // `toNumber` (que espera string|undefined).
      const cost = toNumber(
        product.cost_price != null ? String(product.cost_price) : undefined,
      ) || 0;
      setForm((current) => ({
        ...current,
        price_tier_overrides: productTierOverrides.map((o: any) => {
          const price = o.override_price != null ? String(o.override_price) : '';
          let margin = '';
          if (cost > 0 && o.override_price != null) {
            // margin = (price/cost - 1) * 100, redondeado a 2 decimales.
            margin = String(
              Math.round(((o.override_price / cost - 1) * 100) * 100) / 100,
            );
          }
          return {
            tier_id: o.price_tier_id,
            price,
            margin,
            units_per_package:
              o.override_units_per_package != null
                ? String(o.override_units_per_package)
                : '',
          };
        }),
      }));
    }

    // Hidratar las promociones asignadas al producto (solo en edit mode).
    if (mode === 'edit' && productId && !promotionsHydrated.current) {
      promotionsHydrated.current = true;
      (async () => {
        const assigned = await PromotionsService.getProductPromotions(Number(productId));
        setForm((prev) => ({ ...prev, promotion_ids: assigned }));
      })();
    }
  }, [product, productTierOverrides]);

  const finalPreview = useMemo(() => {
    const base = toNumber(form.base_price) || 0;
    const sale = form.is_on_sale ? toNumber(form.sale_price) : undefined;
    return sale && sale > 0 ? sale : base;
  }, [form.base_price, form.is_on_sale, form.sale_price]);

  /**
   * Tax categories the user has selected for this product. Mirrors the web's
   * `taxBreakdown` aggregation: one row per selected tax_category_id, using
   * the category's first `tax_rates[0].rate`.
   */
  const selectedTaxes = useMemo<TaxCategory[]>(() => {
    const ids = new Set(form.tax_category_ids);
    return allTaxes.filter((tax) => ids.has(tax.id));
  }, [form.tax_category_ids, allTaxes]);

  const taxBreakdown = useMemo<TaxBreakdownItem[]>(() => {
    const base = toNumber(form.base_price) || 0;
    return selectedTaxes
      .map((tax) => {
        const rawRate = tax.tax_rates?.[0]?.rate;
        const numericRate = typeof rawRate === 'number' ? rawRate : Number(rawRate) || 0;
        if (numericRate === 0) return null;
        return { id: tax.id, name: tax.name, rate: numericRate, amount: base * numericRate };
      })
      .filter((item): item is TaxBreakdownItem => item !== null);
  }, [selectedTaxes, form.base_price]);

  /** base + Σ(tax.amount) — the value the customer actually pays. */
  const priceWithTax = useMemo(() => {
    const base = toNumber(form.base_price) || 0;
    const taxSum = taxBreakdown.reduce((sum, tax) => sum + tax.amount, 0);
    return base + taxSum;
  }, [form.base_price, taxBreakdown]);

  /**
   * Display value for the Section subtitle and "Precio Final" block: when the
   * product is on sale we show the offer price; otherwise the tax-inclusive
   * base price. Mirrors `priceWithTax` on the web.
   */
  const finalDisplayPrice = useMemo(() => {
    const sale = form.is_on_sale ? toNumber(form.sale_price) : undefined;
    return sale && sale > 0 ? sale : priceWithTax;
  }, [form.is_on_sale, form.sale_price, priceWithTax]);

  /**
   * Detecta SKUs duplicados entre las variantes — usado para mostrar
   * el banner ámbar en la sección Variantes (mirror del web).
   */
  const hasDuplicateSkus = useMemo(() => {
    if (!form.has_variants) return false;
    const skus = form.variants
      .map((v) => v.sku?.trim())
      .filter((s): s is string => Boolean(s && s.length > 0));
    return new Set(skus).size !== skus.length;
  }, [form.has_variants, form.variants]);

  /**
   * Suma del stock físico y disponible para la sección "Inventario / Stock".
   * Si el producto no tiene variantes, viene de stock_quantity + stock_by_location.
   * Si tiene variantes, el stock se calcula por variante (no mostrado en este nivel).
   */
  const { totalStock, availableStock } = useMemo(() => {
    if (form.has_variants) {
      return { totalStock: 0, availableStock: 0 };
    }
    const initial = toNumber(form.stock_quantity) || 0;
    const fromLocations = Object.values(form.stock_by_location).reduce(
      (sum, raw) => sum + (Number(raw) || 0),
      0,
    );
    const total = initial + fromLocations;
    return { totalStock: total, availableStock: total };
  }, [form.has_variants, form.stock_quantity, form.stock_by_location]);

  const updateField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  /**
   * Formatea un número con separador de miles estilo español
   * (punto como separador, coma como decimal). Acepta strings con
   * dígitos y opcionalmente un punto decimal. Se usa para mostrar el
   * Precio de la tarjeta de multi-tarifa.
   *   formatThousands("10000")    → "10.000"
   *   formatThousands("10000.5")  → "10.000.5"
   *   formatThousands("")         → ""
   */
  const formatThousands = (value: string): string => {
    if (!value) return '';
    // Limpiamos a dígitos + un solo punto decimal.
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (!cleaned) return '';
    const [intPart, decPart] = cleaned.split('.');
    const withSeparator = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decPart !== undefined ? `${withSeparator}.${decPart}` : withSeparator;
  };

  /**
   * Sincroniza `price_tier_overrides` con `enabled_price_tier_ids`:
   * - añade entradas vacías para tarifas recién seleccionadas
   * - elimina entradas de tarifas que ya no están seleccionadas
   * - conserva los valores de las tarifas que siguen seleccionadas
   */
  const syncTierOverrides = (
    currentOverrides: PriceTierOverrideForm[],
    selectedIds: number[],
    selectedTiers: PriceTier[],
  ): PriceTierOverrideForm[] => {
    const byId = new Map(currentOverrides.map((o) => [o.tier_id, o]));
    return selectedIds.map((id) => {
      const existing = byId.get(id);
      if (existing) return existing;
      // Tarifa nueva: crear entrada con el precio base del producto
      // como precio inicial y margen vacío.
      const tier = selectedTiers.find((t) => t.id === id);
      return {
        tier_id: id,
        price: form.base_price,
        margin: '',
        units_per_package: tier?.units_per_package
          ? String(tier.units_per_package)
          : '',
      };
    });
  };

  /**
   * Recalcula el `price` de un override a partir del margen.
   * Fórmula (igual que el web): `price = cost * (1 + margin/100)`.
   */
  const recalcPriceFromMargin = (
    cost: number,
    margin: string,
    fallbackPrice: string,
  ): string => {
    const m = toNumber(margin) ?? 0;
    if (m < 0) return fallbackPrice;
    const newPrice = cost * (1 + m / 100);
    return String(Math.round(newPrice * 100) / 100);
  };

  const updateTierOverride = (
    tierId: number,
    patch: Partial<PriceTierOverrideForm>,
  ) => {
    setForm((current) => {
      const overrides = current.price_tier_overrides ?? [];
      const idx = overrides.findIndex((o) => o.tier_id === tierId);
      if (idx === -1) {
        return {
          ...current,
          price_tier_overrides: [{ tier_id: tierId, price: '', margin: '', units_per_package: '', ...patch }],
        };
      }
      const next = [...overrides];
      next[idx] = { ...next[idx], ...patch };
      return { ...current, price_tier_overrides: next };
    });
  };

  /**
   * Sincroniza los overrides de precio por tarifa contra el backend
   * después de guardar el producto. Para cada tarifa seleccionada con
   * un override en el form, hace upsert. Para tarifas previamente
   * seleccionadas que ya no están en `enabled_price_tier_ids`, hace
   * delete (para no dejar overrides huérfanos).
   *
   * Se llama DESPUÉS del save principal del producto.
   */
  const syncPriceTierOverrides = async (savedProductId: number) => {
    if (!form.has_multiple_price_tiers) {
      // Multi-tarifa desactivado: borrar todos los overrides previos.
      const previousIds = (form.price_tier_overrides ?? []).map((o) => o.tier_id);
      await Promise.all(
        previousIds.map((tierId) =>
          ProductService.removeProductPriceTierOverride(savedProductId, tierId).catch(() => undefined),
        ),
      );
      return;
    }

    const selectedIds = new Set(form.enabled_price_tier_ids ?? []);
    const currentOverrides = form.price_tier_overrides ?? [];

    // 1) Upsert de los overrides de las tarifas actualmente
    //    seleccionadas.
    const upserts = currentOverrides
      .filter((o) => selectedIds.has(o.tier_id))
      .map((o) =>
        ProductService.upsertProductPriceTierOverride(savedProductId, o.tier_id, {
          override_price: toNumber(o.price) ?? undefined,
          override_units_per_package: toNumber(o.units_per_package) ?? undefined,
        }),
      );

    // 2) Delete de los overrides de tarifas que ESTABAN en
    //    `price_tier_overrides` pero ya no están seleccionadas.
    const deleted = currentOverrides
      .filter((o) => !selectedIds.has(o.tier_id))
      .map((o) =>
        ProductService.removeProductPriceTierOverride(savedProductId, o.tier_id).catch(() => undefined),
      );

    await Promise.all([...upserts, ...deleted]);
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
    setForm((current) => {
      const patchList = (vs: VariantForm[]) =>
        vs.map((variant) => (variant.localId === localId ? { ...variant, ...patch } : variant));
      return {
        ...current,
        variants: patchList(current.variants),
        generatedVariants: patchList(current.generatedVariants),
      };
    });
  };

  /**
   * Eliminada manualmente → marca en `removedVariantKeys` (clave estable
   * basada en attributes) para que la reconciliación no la resurrect al
   * regenerar la matriz cartesiana.
   */
  const removeVariant = (localId: string) => {
    setForm((current) => {
      const removed = current.generatedVariants.find((v) => v.localId === localId);
      const nextRemovedKeys = removed?.attributes
        ? [...current.removedVariantKeys, getVariantKey(removed.attributes)]
        : current.removedVariantKeys;
      const filterList = (vs: VariantForm[]) =>
        vs.filter((variant) => variant.localId !== localId);
      return {
        ...current,
        variants: filterList(current.variants),
        generatedVariants: filterList(current.generatedVariants),
        removedVariantKeys: nextRemovedKeys,
      };
    });
  };

  /**
   * Reconciliación no destructiva — espejo del web `reconcileVariants`.
   *
   * - Filtra atributos con nombre vacío o sin valores.
   * - Genera el producto cartesiano de los `values` válidos.
   * - Para cada combinación, busca variante preexistente por `getVariantKey`
   *   y la preserva con sus ediciones. Si no existe, crea una heredando
   *   sku/precio/costo del producto base.
   * - Honra `removedVariantKeys` (variantes eliminadas no se resurrectan).
   * - Sincroniza `variants` ↔ `generatedVariants` para no romper el DTO
   *   (que se construye desde `form.variants`).
   */
  const reconcileVariants = useCallback(() => {
    setForm((current) => {
      const validAttributes = current.attributes.filter(
        (a) => a.name.trim() !== '' && a.values.length > 0,
      );
      if (validAttributes.length === 0) {
        return {
          ...current,
          generatedVariants: [],
          variants: [],
        };
      }

      const valueLists = validAttributes.map((a) => a.values);
      const combos = cartesian(valueLists);
      const basePrice = toNumber(current.base_price) || 0;
      const baseCost = toNumber(current.cost_price) || 0;
      const baseMargin = toNumber(current.profit_margin) || 0;
      const baseSku = current.sku.trim();
      const baseName = current.name.trim() || 'Producto';

      // Lookup de variantes existentes con attributes por clave estable
      const existingMap = new Map<string, VariantForm>();
      for (const v of current.generatedVariants) {
        if (v.attributes) existingMap.set(getVariantKey(v.attributes), v);
      }

      // Variantes legacy (sin attributes) — preservarlas por localId para
      // no perder ediciones durante la transición.
      const legacyByLocalId = new Map<string, VariantForm>();
      for (const v of current.generatedVariants) {
        if (!v.attributes) legacyByLocalId.set(v.localId, v);
      }

      const removedSet = new Set(current.removedVariantKeys);
      const next: VariantForm[] = [];

      for (const combo of combos) {
        const attrs: Record<string, string> = {};
        let nameSuffix = '';
        let skuSuffix = '';
        validAttributes.forEach((a, i) => {
          const v = combo[i];
          attrs[a.name] = v;
          nameSuffix += ` ${v}`;
          // Sufijo SKU: 3 primeras letras del valor en mayúsculas (mirror web)
          skuSuffix += `-${v.toUpperCase().slice(0, 3)}`;
        });

        const key = getVariantKey(attrs);
        if (removedSet.has(key)) continue;

        const existing = existingMap.get(key);
        if (existing) {
          next.push(existing);
          continue;
        }

        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        next.push({
          localId: `variant-${Date.now()}-${suffix}`,
          sku: baseSku ? `${baseSku}${skuSuffix}` : '',
          name: `${baseName}${nameSuffix}`.trim(),
          price_override: String(basePrice),
          cost_price: String(baseCost),
          profit_margin: String(baseMargin),
          is_on_sale: false,
          sale_price: '',
          stock_quantity: '0',
          attributes: attrs,
        });
      }

      // Append legacy variants al final para no romper compat temporal.
      for (const v of legacyByLocalId.values()) next.push(v);

      return {
        ...current,
        generatedVariants: next,
        variants: next,
      };
    });
  }, []);

  // ============ Mutators de atributos ============

  const addQuickAttribute = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let duplicate = false;
    setForm((current) => {
      if (
        current.attributes.some(
          (a) => a.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        duplicate = true;
        return current;
      }
      return {
        ...current,
        attributes: [...current.attributes, { name: trimmed, values: [] }],
      };
    });
    if (duplicate) toastError(`El atributo "${trimmed}" ya existe`);
    // No reconcilia aún — sin values, no hay combinaciones que generar.
  };

  const addAttribute = () => {
    setForm((current) => ({
      ...current,
      attributes: [...current.attributes, { name: '', values: [] }],
    }));
  };

  const removeAttribute = (index: number) => {
    setForm((current) => ({
      ...current,
      attributes: current.attributes.filter((_, i) => i !== index),
    }));
    reconcileVariants();
  };

  const updateAttributeName = (index: number, name: string) => {
    setForm((current) => ({
      ...current,
      attributes: current.attributes.map((a, i) =>
        i === index ? { ...a, name } : a,
      ),
    }));
    if (name.trim()) reconcileVariants();
  };

  const addAttributeValue = (attrIndex: number, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    let changed = false;
    setForm((current) => {
      const attrs = current.attributes.map((a, i) => {
        if (i !== attrIndex) return a;
        if (a.values.includes(trimmed)) return a;
        changed = true;
        return { ...a, values: [...a.values, trimmed] };
      });
      if (!changed) return current;
      return { ...current, attributes: attrs };
    });
    if (changed) reconcileVariants();
  };

  const removeAttributeValue = (attrIndex: number, valueIndex: number) => {
    setForm((current) => ({
      ...current,
      attributes: current.attributes.map((a, i) =>
        i === attrIndex
          ? { ...a, values: a.values.filter((_, j) => j !== valueIndex) }
          : a,
      ),
    }));
    reconcileVariants();
  };

  /**
   * Bulk action — el botón "Aplicar precio/costo a todas" del web.
   */
  const applyBaseToAllVariants = (
    field: 'price_override' | 'cost_price' | 'profit_margin',
  ) => {
    setForm((current) => {
      const source =
        field === 'price_override'
          ? current.base_price
          : field === 'cost_price'
            ? current.cost_price
            : current.profit_margin;
      const patch = current.variants.map((v) => ({ ...v, [field]: source }));
      return {
        ...current,
        variants: patch,
        generatedVariants: patch,
      };
    });
    toastSuccess('Aplicado a todas las variantes');
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
      ? form.variants.map((variant) => {
          // `attributes` se persiste siempre que tenga al menos una entrada.
          // El backend ya acepta `Record<string, any>` en el DTO
          // (`CreateProductVariantDto.attributes`) y persiste el JSON tal cual.
          const attrs =
            variant.attributes && Object.keys(variant.attributes).length > 0
              ? variant.attributes
              : undefined;
          return {
            ...(variant.id ? { id: variant.id } : {}),
            sku: variant.sku.trim(),
            name: variant.name.trim() || undefined,
            price_override: toNumber(variant.price_override),
            cost_price: toNumber(variant.cost_price),
            profit_margin: toNumber(variant.profit_margin),
            is_on_sale: variant.is_on_sale,
            sale_price: variant.is_on_sale ? toNumber(variant.sale_price) : undefined,
            stock_quantity: toNumber(variant.stock_quantity) ?? 0,
            attributes: attrs,
            track_inventory_override: null,
          };
        })
      : undefined;

    // Base payload — fields safe in both create and update.
    // Importante: el backend usa class-validator con `@IsInt()` que rechaza `null`
    // (solo acepta `number | undefined`). Por eso enviamos `undefined` cuando no hay valor.
    //
    // SLUG: el DTO requiere `@MinLength(2)` cuando se proporciona. Si el usuario
    // escribió 1 caracter o nada, lo omitimos para que el backend auto-genere uno.
    const trimmedSlug = form.slug.trim();
    const finalSlug = trimmedSlug.length >= 2 ? trimmedSlug : undefined;

    const base = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      sku: form.sku.trim() || undefined,
      slug: finalSlug,
      barcode: form.barcode.trim() || undefined,
      base_price: toNumber(form.base_price) || 0,
      cost_price: toNumber(form.cost_price),
      profit_margin: toNumber(form.profit_margin),
      is_on_sale: form.is_on_sale,
      sale_price: form.is_on_sale ? toNumber(form.sale_price) : undefined,
      stock_quantity: form.has_variants ? undefined : toNumber(form.stock_quantity),
      stock_by_location: !form.has_variants && stockByLocation.length > 0 ? stockByLocation : undefined,
      track_inventory: form.track_inventory,
      available_for_ecommerce: form.available_for_ecommerce,
      is_featured: form.is_featured,
      allow_pos_price_override: form.allow_pos_price_override,
      // Restaurant Suite toggles (Fase A additive, exposed in Fase B)
      is_sellable: form.is_sellable,
      is_ingredient: form.is_ingredient,
      is_combo: form.is_combo,
      is_batch_produced: form.is_batch_produced,
      // UoM sólo se envían si el insumo está activo (mirror web: el
      // card "Unidad de medida del insumo" sólo aparece cuando
      // is_ingredient = true).
      purchase_uom_id: form.is_ingredient ? form.purchase_uom_id : undefined,
      stock_uom_id: form.is_ingredient ? form.stock_uom_id : undefined,
      has_multiple_price_tiers: form.has_multiple_price_tiers,
      enabled_price_tier_ids:
        form.has_multiple_price_tiers && (form.enabled_price_tier_ids?.length ?? 0) > 0
          ? form.enabled_price_tier_ids
          : undefined,
      // Los overrides por tarifa NO se envían en el DTO del producto.
      // El backend los gestiona por endpoints separados:
      //   PUT    /store/price-tiers/products/:productId/overrides/:tierId
      //   DELETE /store/price-tiers/products/:productId/overrides/:tierId
      // Se sincronizan DESPUÉS de guardar el producto (ver
      // `syncPriceTierOverrides` abajo).
      requires_serial_numbers: form.requires_serial_numbers,
      state: form.state,
      pricing_type: form.pricing_type,
      product_type: form.product_type,
      // brand_ids es un array en el form. El DTO del backend espera
      // `brand_id` (single, primer elemento).
      brand_id: form.brand_ids?.[0],
      category_ids: form.category_ids.length > 0 ? form.category_ids : undefined,
      tax_category_ids: form.tax_category_ids.length > 0 ? form.tax_category_ids : undefined,
      // Imágenes del producto. En create enviamos las URIs locales que
      // el backend descarga y guarda. En update las enviamos como
      // image_urls (el backend reconcilia con product_images existentes).
      image_urls: productImages.length > 0 ? productImages : undefined,
      variants,
    };

    // Dimensiones + peso (mirror del web; sólo si hay valor).
    const numericLength = toNumber(form.length);
    const numericWidth = toNumber(form.width);
    const numericHeight = toNumber(form.height);
    if (numericLength !== undefined || numericWidth !== undefined || numericHeight !== undefined) {
      (base as any).dimensions = {
        length: numericLength ?? 0,
        width: numericWidth ?? 0,
        height: numericHeight ?? 0,
      };
    }
    const numericWeight = toNumber(form.weight_input);
    if (numericWeight !== undefined) {
      (base as any).weight = numericWeight;
    }
    const preparationTime = toNumber(form.preparation_time_minutes);
    if (preparationTime !== undefined) {
      (base as any).preparation_time_minutes = preparationTime;
    }

    // Create-only fields: sólo válidos en UpdateProductDto. NO los enviamos
    // en create porque el `forbidNonWhitelisted: true` del ValidationPipe
    // rechazaría la request con "property X should not exist".
    if (mode === 'create') {
      return base;
    }

    // Edit: incluir campos sólo presentes en UpdateProductDto.
    const update: UpdateProductDto = { ...base };
    if (form.stock_quantity !== undefined && !form.has_variants) {
      (update as any).stock_transfer_mode = 'distribute';
      (update as any).variant_removal_stock_mode = 'first';
    }
    return update;
  };

  const mutation = useMutation({
    mutationFn: (dto: CreateProductDto | UpdateProductDto) =>
      mode === 'edit' && productId ? ProductService.update(productId, dto) : ProductService.create(dto as CreateProductDto),
    onSuccess: async (savedProduct) => {
      // El backend no acepta `price_tier_overrides` en el DTO del
      // producto. Se sincronizan aparte, después del save principal,
      // contra los endpoints:
      //   PUT    /store/price-tiers/products/:productId/overrides/:tierId
      //   DELETE /store/price-tiers/products/:productId/overrides/:tierId
      const savedId = mode === 'edit' && productId ? productId : savedProduct?.id;
      if (savedId) {
        try {
          await syncPriceTierOverrides(savedId);
        } catch (err) {
          console.warn('No se pudieron sincronizar los overrides de tarifas', err);
        }
        // Las promociones se persisten via endpoint separado (no van en el DTO).
        if (mode === 'edit' && savedId) {
          try {
            await ProductService.updatePromotions(savedId, form.promotion_ids ?? []);
          } catch (err) {
            console.warn('No se pudieron sincronizar las promociones', err);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      if (productId) queryClient.invalidateQueries({ queryKey: ['product', productId] });
      queryClient.invalidateQueries({ queryKey: ['price-tiers'] });
      // Invalidamos también la query de overrides para que la
      // próxima vez que se abra el form (al re-editar) se traigan
      // los datos frescos del backend.
      if (productId) {
        queryClient.invalidateQueries({
          queryKey: ['product-price-tier-overrides', productId],
        });
      }
      toastSuccess(mode === 'edit' ? 'Producto actualizado' : 'Producto creado');
      router.back();
    },
    onError: (error: any) => {
      const data = error?.response?.data;
      // El AllExceptionsFilter del backend mete los constraints de class-validator
      // en `data.details.validationErrors` y reemplaza `data.message` por un
      // string genérico "Validation failed". Extraemos los constraints reales.
      const validationErrors = data?.details?.validationErrors;
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        toastError(validationErrors.join(' • '));
        return;
      }
      // Fallback: leer data.message (puede ser string o array de otros errores).
      const detail = Array.isArray(data?.message)
        ? data.message.join(' • ')
        : data?.message;
      const msg =
        detail ||
        data?.error ||
        (error instanceof Error ? error.message : null) ||
        'Error al guardar producto';
      toastError(typeof msg === 'string' ? msg : 'Error al guardar producto');
    },
  });

  /**
   * Mutación para generar descripción con IA (mirror del botón 'Generar con IA' web).
   * Llama al backend POST /store/products/generate-description y rellena el Textarea.
   *
   * Detección de safety: el proveedor de IA (Vertex AI / OpenAI) puede devolver
   * un placeholder como 'User safety:safe' cuando el filtro de contenido bloquea
   * la generación. Tratamos este caso como error y mostramos un mensaje claro.
   */
  const aiMutation = useMutation({
    mutationFn: (payload: { name: string; sku?: string; category_id?: number | null; brand_id?: number | null }) =>
      ProductService.generateDescription(payload),
    onSuccess: (result) => {
      const text = result.description?.trim();
      const isSafetyPlaceholder =
        !text || /safety|safe content/i.test(text) || text.toLowerCase() === 'user safety:safe';
      if (isSafetyPlaceholder) {
        toastError('La IA no pudo generar una descripción (filtro de seguridad del proveedor). Edita manualmente.');
        return;
      }
      setForm((current) => ({ ...current, description: text }));
      toastSuccess('Descripción generada con IA');
    },
    onError: (error: any) => {
      // Muestra el mensaje exacto del backend. Si es un validation error array, lo detalla.
      const data = error?.response?.data;
      const detail = Array.isArray(data?.message)
        ? data.message.join(', ')
        : data?.message;
      const msg =
        detail ||
        error?.message ||
        'No se pudo generar la descripción. Verifica que el backend soporte este endpoint.';
      toastError(msg);
    },
  });

  /**
   * Estado + mutation para generar el link público de compra online
   * + QR del producto. Cuando el usuario pulsa "Generar link y QR",
   * llama a POST /store/products/:id/online-purchase-link, muestra
   * el link y el QR generado.
   */
  const [onlinePurchase, setOnlinePurchase] = useState<{
    url: string | null;
    qrCode: string | null;
    domainHostname: string | null;
  }>({ url: null, qrCode: null, domainHostname: null });

  const generateLinkQrMutation = useMutation({
    mutationFn: () => ProductService.generateOnlinePurchaseLink(Number(productId)),
    onSuccess: (result) => {
      if (result.generated) {
        setOnlinePurchase({
          url: result.online_purchase_url,
          qrCode: result.qr_data_url ?? result.online_purchase_qr_code,
          domainHostname: result.domain_hostname,
        });
        toastSuccess('Link y QR generados correctamente');
      } else {
        toastError(
          result.online_purchase_status_message ??
            'No se pudo generar el link de compra online.',
        );
      }
    },
    onError: (error: any) => {
      const data = error?.response?.data;
      const detail = Array.isArray(data?.message)
        ? data.message.join(', ')
        : data?.message;
      toastError(
        detail ??
          'No se pudo generar el link de compra online. Verifica que exista un dominio ecommerce activo.',
      );
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
      {/* Header sticky — flecha + título + acciones iconos (X / +) */}
      <StickyHeader
        title={mode === 'edit' ? 'Editar Producto' : 'Nuevo Producto'}
        subtitle={undefined}
        onBack={() => router.back()}
        actions={[
          { label: '', icon: 'x', variant: 'outline', onPress: () => router.back() },
          {
            label: '',
            icon: mode === 'edit' ? 'check' : 'plus',
            variant: 'primary',
            loading: mutation.isPending,
            onPress: submit,
          },
        ]}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {/* Tipo de Producto (espejo exacto del web:
              - ícono layers + título (sin subtitle)
              - segmented control con 2 opciones: Producto Físico | Servicio
          */}
          <Section title="Tipo de Producto" icon="layers">
            <InputButtons
              value={form.product_type}
              onChange={(v) => updateField('product_type', v as ProductType)}
              fullWidth
              options={[
                { label: 'Producto Físico', value: 'physical' },
                { label: 'Servicio', value: 'service' },
              ]}
            />
          </Section>

          {/* Información General (espejo exacto del web) */}
          <Section title="Información General" icon="info">
            {/* Nombre del Producto (full-width, required, con clipboard icon suffix) */}
            <Input
              label="Nombre del Producto"
              value={form.name}
              onChangeText={(value) => updateField('name', value)}
              placeholder="Ej. Camiseta Algodón Premium"
              required
              tooltip="Nombre visible del producto en catálogo, facturas y buscador. Sé descriptivo y consistente."
              error={errors.name}
              rightIcon={
                <Pressable
                  onPress={() => {
                    // El web permite pegar al portapapeles para autocompletar el nombre.
                    // En mobile esto requeriría expo-clipboard; placeholder visual.
                    toastSuccess('Pega el nombre desde el portapapeles');
                  }}
                  hitSlop={6}
                >
                  <Icon name="clipboard-list" size={16} color={colors.text.muted} />
                </Pressable>
              }
            />

            {/* SKU / Código de barras / Slug en grid 3 cols en sm+ */}
            <View style={styles.infoGrid}>
              <Input
                label="SKU"
                value={form.sku}
                onChangeText={(value) => updateField('sku', value.toUpperCase())}
                placeholder="Ej. CAM-001"
                tooltip="Código interno único del producto. Útil para inventario, etiquetas y búsqueda rápida en POS."
                autoCapitalize="characters"
              />
              <Input
                label="Código de barras"
                value={form.barcode}
                onChangeText={(value) => updateField('barcode', value)}
                placeholder="Escanea o escribe el código"
                tooltip="Código escaneable (EAN/UPC) único en la tienda."
              />
              <Input
                label="Slug (URL)"
                value={form.slug}
                onChangeText={(value) => updateField('slug', value)}
                placeholder="camiseta-algodon-premium"
                tooltip="Identificador para la URL pública del producto. Se genera automáticamente desde el nombre."
                autoCapitalize="none"
              />
            </View>

            {/* Descripción con botón 'Generar con IA' (espejo del web ai-generate-btn)
                El botón llama al backend de IA (POST /store/products/generate-description).
                Muestra tooltip "Generar con IA" al hover/press y rellena el Textarea. */}
            <View style={styles.descriptionHeader}>
              <Text style={styles.descriptionLabel}>Descripción</Text>
              <Pressable
                onPress={() => {
                  if (!form.name.trim()) {
                    toastError('Ingresa primero el nombre del producto');
                    return;
                  }
                  // Construye el payload sólo con campos con valor (undefined los omite del body,
                  // evitando que el backend rechace por nulls opcionales).
                  const payload: Parameters<typeof ProductService.generateDescription>[0] = {
                    name: form.name.trim(),
                  };
                  const trimmedSku = form.sku.trim();
                  if (trimmedSku) payload.sku = trimmedSku;
                  if (form.category_ids[0]) payload.category_id = form.category_ids[0];
                  if (form.brand_ids?.[0]) payload.brand_id = form.brand_ids[0];
                  aiMutation.mutate(payload);
                }}
                disabled={aiMutation.isPending || !form.name.trim()}
                style={({ pressed }) => [
                  styles.aiGenerateBtn,
                  pressed && !aiMutation.isPending && { opacity: 0.85 },
                ]}
              >
                {aiMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <>
                    <Icon name="sparkles" size={11} color={colors.background} />
                    <Text style={styles.aiGenerateText}>IA</Text>
                  </>
                )}
              </Pressable>
            </View>
            <Textarea
              label=""
              value={form.description}
              onChangeText={(value) => updateField('description', value)}
              placeholder="Describe tu producto..."
              rows={3}
              maxLength={1000}
            />
          </Section>

          {/* Precios y Rentabilidad (espejo exacto del web)
              - Inputs con prefix "$" (Costo, Precio Base) y suffix "%" (Margen)
              - Tooltips en cada input/selector (mirror web tooltiptext)
              - Precio Base con asterisco rojo (required)
              - Impuestos Aplicables + botón + (mb-[26px] del web) con label del MultiSelector
          */}
          <Section title="Precios y Rentabilidad" icon="dollar-sign" iconColor={colors.primary}>
            <View style={styles.pricingRow}>
              <MoneyInput
                label={PRICING_LABELS[form.pricing_type].cost}
                value={form.cost_price}
                onChangeText={(value) => {
                  updateField('cost_price', value);
                  updatePriceFromCostMargin(value, form.profit_margin);
                }}
                prefix="$"
                placeholder="0"
                tooltip="Precio al que adquieres el producto. Se usa para calcular la rentabilidad."
              />
              <Input
                label="Margen (%)"
                value={form.profit_margin}
                onChangeText={(value) => {
                  updateField('profit_margin', value);
                  updatePriceFromCostMargin(form.cost_price, value);
                }}
                keyboardType="decimal-pad"
                suffix="%"
                placeholder="0.00"
                tooltip="Porcentaje de ganancia deseado sobre el costo. Ajusta automáticamente el precio base."
              />
              <MoneyInput
                label={PRICING_LABELS[form.pricing_type].base}
                value={form.base_price}
                onChangeText={(value) => {
                  updateField('base_price', value);
                  updateMarginFromBase(value, form.cost_price);
                }}
                error={errors.base_price}
                placeholder="0"
                prefix="$"
                tooltip="Precio de venta antes de impuestos. Se calcula automáticamente si defines costo + margen."
                required
              />
            </View>
            <Selector
              label={PRICING_LABELS[form.pricing_type].type}
              value={form.pricing_type}
              onChange={(v) => updateField('pricing_type', v as PricingType)}
              options={[
                { label: 'Venta por unidad', value: 'unit' },
                { label: 'Venta por peso (kg)', value: 'weight' },
              ]}
              tooltip="Define si el producto se vende por unidad o por peso (kg). Afecta cómo se interpretan los precios."
            />

            {/* Impuestos Aplicables + botón + para creación rápida (mirror web
                `flex gap-2 items-end h-full md:col-span-2` + `button mb-[26px]`).
                El MultiSelector pone su propio label 'Impuestos Aplicables' con tooltip.
                El `marginTop` del botón + compensa el alto del label del MultiSelector
                para alinear verticalmente con el input. */}
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              <View style={{ flex: 1 }}>
                <MultiSelector
                  label="Impuestos Aplicables"
                  values={form.tax_category_ids}
                  onChange={(v) => updateField('tax_category_ids', v)}
                  options={allTaxes.map((t) => {
                    const rate = t.tax_rates?.[0]?.rate;
                    const labelText = typeof rate === 'number' ? `${t.name} (${(rate * 100).toFixed(0)}%)` : t.name;
                    return { label: labelText, subLabel: t.name, value: t.id };
                  })}
                  placeholder="Seleccionar impuestos…"
                  searchable
                  searchPlaceholder="Buscar impuesto…"
                  tooltip="Impuestos que se suman al precio base en facturación y checkout (IVA, INC, retenciones)."
                />
              </View>
              <Pressable
                onPress={() => setTaxModalOpen(true)}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.taxAddButton,
                  styles.taxAddButtonAligned, // ← alinea con el input (no el label)
                  pressed && styles.taxAddButtonPressed,
                ]}
              >
                <Icon name="plus" size={20} color={colors.primary} />
              </Pressable>
            </View>

            {/* Sub-card con desglose estructurado del precio (espejo de la versión web mobile) */}
            <View style={styles.pricingBreakdownCard}>
              {/* Fila 1: Fórmula de cálculo (gris) */}
              <View style={styles.formulaRow}>
                <Text style={styles.formulaValue}>{formatCurrency(toNumber(form.cost_price) || 0)}</Text>
                <Text style={styles.formulaHint}>(Costo)</Text>
                <Text style={styles.formulaOp}>×</Text>
                <Text style={styles.formulaHint}>(1 + {Number(form.profit_margin || 0).toFixed(1)}%)</Text>
                <Text style={styles.formulaOp}>=</Text>
                <Text style={styles.formulaValue}>{formatCurrency(toNumber(form.base_price) || 0)}</Text>
                <Text style={styles.formulaHint}>(PVP)</Text>

                {taxBreakdown.map((tax) => (
                  <Fragment key={tax.id}>
                    <Text style={styles.formulaOp}>+</Text>
                    <Text style={styles.formulaHint}>{(tax.rate * 100).toFixed(1)}% {tax.name}</Text>
                    <Text style={styles.formulaAmount}>({formatCurrency(tax.amount)})</Text>
                  </Fragment>
                ))}

                <Text style={styles.formulaOp}>=</Text>
                <Text style={styles.formulaFinal}>{formatCurrency(priceWithTax)}</Text>
              </View>

              {/* Fila 2: Precio Final + wrapper "setting-toggle-row" del web */}
              <View style={styles.finalPriceRow}>
                <View style={styles.finalPriceCol}>
                  <Text style={styles.finalLabel}>PRECIO FINAL</Text>
                  <Text style={[styles.finalAmount, form.is_on_sale && styles.finalAmountStrike]}>
                    {formatCurrency(priceWithTax)}
                  </Text>
                </View>

                {/* Wrapper del toggle (espejo del `setting-toggle-row` web:
                    bg-gray-50 + border-gray-100 + rounded-xl + p-2 + mt-3) */}
                <View style={styles.settingToggleRow}>
                  <Toggle
                    value={form.is_on_sale}
                    onChange={(v) => updateField('is_on_sale', v)}
                    label="Activar precio de oferta"
                    description="Se mostrará como precio promocional"
                  />
                </View>
              </View>

              {/* Fila 3: Sub-sección rose para precio de oferta (solo si is_on_sale) */}
              {form.is_on_sale && (
                <View style={styles.saleRow}>
                  <Icon name="flame" size={18} color={colorScales.red[500]} />
                  <View style={styles.saleCol}>
                    <Text style={styles.saleLabel}>PRECIO DE OFERTA</Text>
                    <Input
                      tone="rose"
                      value={form.sale_price}
                      onChangeText={(value) => updateField('sale_price', value)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      error={errors.sale_price}
                    />
                  </View>
                </View>
              )}
            </View>
          </Section>

          {/* Precios Multi-Tarifa (justo después de Precios y Rentabilidad,
              mirror web: header con icon tags + toggle + al activarlo
              aparece el multi-selector de "Tarifas aplicables" + el
              mensaje informativo con el conteo de tarifas disponibles). */}
          <Section title="Precios Multi-Tarifa" icon="tags">
            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.has_multiple_price_tiers}
                onChange={(v) => {
                  updateField('has_multiple_price_tiers', v);
                  // Si se desactiva, limpiamos las tarifas seleccionadas
                  // para no enviar IDs que el backend ignore.
                  if (!v) updateField('enabled_price_tier_ids', []);
                }}
                label="Activar precios multi-tarifa"
                description="Define precios distintos para tarifas como Mayorista, Distribuidor, VIP, etc. La tarifa por defecto usa el precio base."
              />
            </View>
            {form.has_multiple_price_tiers && (
              <View style={styles.priceTiersBlock}>
                <MultiSelector
                  label="Tarifas aplicables"
                  placeholder="Buscar y seleccionar tarifas..."
                  tooltip="Selecciona las tarifas que aplican a este producto. Solo las seleccionadas mostrarán precio, margen y cantidad por empaque configurables."
                  values={form.enabled_price_tier_ids ?? []}
                  onChange={(values) => {
                    // Usamos el formulario funcional de setForm para
                    // evitar race conditions con el closure (el
                    // `form` capturado podía tener un valor stale y
                    // perder el sync entre IDs seleccionados y overrides).
                    setForm((current) => {
                      const currentOverrides = current.price_tier_overrides ?? [];
                      const next = syncTierOverrides(currentOverrides, values, priceTiers);
                      return {
                        ...current,
                        enabled_price_tier_ids: values,
                        price_tier_overrides: next,
                      };
                    });
                  }}
                  options={priceTiers.map((tier) => ({
                    value: tier.id,
                    label: tier.name,
                    subLabel: tier.is_default
                      ? 'Por defecto'
                      : tier.units_per_package
                      ? `Empaque x${tier.units_per_package}`
                      : undefined,
                  }))}
                  searchable
                  searchPlaceholder="Buscar..."
                />
                <View style={styles.priceTiersHint}>
                  <Icon name="info" size={16} color={colorScales.gray[500]} />
                  <Text style={styles.priceTiersHintText}>
                    {priceTiers.length === 0
                      ? 'No hay tarifas configuradas. Crea tarifas en Configuración → Tarifas de precio para poder seleccionarlas aquí.'
                      : `Hay ${priceTiers.length} tarifa${priceTiers.length === 1 ? '' : 's'} disponible${priceTiers.length === 1 ? '' : 's'}. Selecciona al menos una arriba para configurar su precio, margen y cantidad por empaque.`}
                  </Text>
                </View>

                {/* Card de configuración por tarifa seleccionada */}
                {(form.enabled_price_tier_ids ?? []).map((tierId) => {
                  const tier = priceTiers.find((t) => t.id === tierId);
                  const override = (form.price_tier_overrides ?? []).find(
                    (o) => o.tier_id === tierId,
                  );
                  if (!tier || !override) return null;
                  const cost = toNumber(form.cost_price) || 0;
                  const calculatedPrice =
                    override.margin && toNumber(override.margin) !== null
                      ? cost * (1 + (toNumber(override.margin) ?? 0) / 100)
                      : toNumber(override.price) ?? cost;
                  return (
                    <View key={tierId} style={styles.priceTierCard}>
                      <View style={styles.priceTierCardHeader}>
                        <View style={styles.priceTierCardTitleRow}>
                          <Text style={styles.priceTierCardName}>
                            {tier.name}
                          </Text>
                          <Text style={styles.priceTierCardRate}>
                            {tier.is_default
                              ? 'Tarifa por defecto'
                              : `${tier.units_per_package ?? 1}× empaque`}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            setForm((current) => {
                              const remaining = (
                                current.enabled_price_tier_ids ?? []
                              ).filter((id) => id !== tierId);
                              const next = syncTierOverrides(
                                current.price_tier_overrides ?? [],
                                remaining,
                                priceTiers,
                              );
                              return {
                                ...current,
                                enabled_price_tier_ids: remaining,
                                price_tier_overrides: next,
                              };
                            });
                          }}
                          hitSlop={6}
                          style={styles.priceTierCardRemove}
                          accessibilityLabel={`Quitar tarifa ${tier.name}`}
                        >
                          <Icon name="x" size={14} color={colorScales.gray[400]} />
                          <Text style={styles.priceTierCardRemoveText}>
                            Quitar
                          </Text>
                        </Pressable>
                      </View>

                      <View style={styles.priceTierCardGrid}>
                        {/* Columna 1/3: Precio (con separador de miles
                            al estilo español: 10.000 en vez de 10000). */}
                        <View style={styles.priceTierField}>
                          <Input
                            label="Precio"
                            value={formatThousands(override.price)}
                            onChangeText={(value) => {
                              const numeric = value.replace(/[^0-9.]/g, '');
                              updateTierOverride(tierId, {
                                price: numeric,
                                margin: '', // Al editar precio directo, limpiamos el margen.
                              });
                            }}
                            placeholder="$0"
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View style={styles.priceTierField}>
                          <Input
                            label="Margen (%)"
                            value={override.margin}
                            onChangeText={(value) => {
                              const numeric = value.replace(/[^0-9.]/g, '');
                              // Al cambiar el margen, recalculamos el
                              // precio con la fórmula cost * (1 + m/100).
                              const newPrice = recalcPriceFromMargin(
                                cost,
                                numeric,
                                override.price,
                              );
                              updateTierOverride(tierId, {
                                margin: numeric,
                                price: newPrice,
                              });
                            }}
                            placeholder=""
                            keyboardType="decimal-pad"
                          />
                        </View>
                        <View style={styles.priceTierField}>
                          <Input
                            label="Cantidad x empaque"
                            value={override.units_per_package}
                            onChangeText={(value) => {
                              const numeric = value.replace(/[^0-9]/g, '');
                              updateTierOverride(tierId, {
                                units_per_package: numeric,
                              });
                            }}
                            placeholder="Sin empaque"
                            keyboardType="number-pad"
                            tooltip="Sobrescribe las unidades por empaque de la tarifa solo para este producto. Vacío hereda el valor de la tarifa. Mínimo 2."
                          />
                        </View>
                      </View>

                      <View style={styles.priceTierCardResult}>
                        <Text style={styles.priceTierCardResultLabel}>
                          Precio resultante:{' '}
                          <Text style={styles.priceTierCardResultValue}>
                            {formatCurrency(calculatedPrice)}
                          </Text>
                          <Text style={styles.priceTierCardResultCalc}>
                            {' '}
                            (calculado)
                          </Text>
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Section>

          {/* Imágenes del Producto (espejo exacto del web mobile lg:hidden):
              - Header sin subtitle, con counter "0/5" a la derecha (slot `right`)
              - Placeholder cuadrado aspect-square max-w-280, mx-auto, con ícono circular bg-white
              - Botón secundario 64x64 dashed + ícono image-plus + label "Agregar"
          */}
          <Section
            title="Imágenes del Producto"
            icon="image"
            right={
              <Text style={styles.imageCount}>{productImages.length}/5</Text>
            }
          >
            <View style={styles.imageMainWrapper}>
              {productImages.length > 0 ? (
                <Pressable
                  onPress={() => setImageSourceOpen(true)}
                  style={({ pressed }) => [
                    styles.imageMainFilled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Image
                    source={{ uri: productImages[0] }}
                    style={styles.imageMainImg}
                    resizeMode="cover"
                  />

                  {/* Botón "Mejorar imagen con IA" (web: bottom-2 left-2 + gradient green + sparkles + 'IA') */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      toastSuccess('Mejorar imagen con IA (próximamente)');
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.imageMainAiBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityLabel="Mejorar imagen con IA"
                  >
                    <Icon name="sparkles" size={12} color={colors.background} />
                    <Text style={styles.imageMainAiBtnText}>IA</Text>
                  </Pressable>

                  {/* Botón "Ajustar y recortar" (web: bottom-2 right-2 + white + crop icon + 'Ajustar') */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setImageEditorUri(productImages[0]);
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.imageMainCropBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityLabel="Ajustar y recortar imagen"
                  >
                    <Icon name="crop" size={14} color={colorScales.gray[700]} />
                    <Text style={styles.imageMainCropBtnText}>Ajustar</Text>
                  </Pressable>

                  {/* Botón Eliminar (mirror web: top-2 right-2 absolute + red-500/90 + trash-2) */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setProductImages((prev) => prev.filter((_, i) => i !== 0));
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.imageMainDelete,
                      pressed && { backgroundColor: 'rgba(220, 38, 38, 1)' },
                    ]}
                    accessibilityLabel="Eliminar imagen"
                  >
                    <Icon name="trash-2" size={14} color={colors.background} />
                  </Pressable>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setImageSourceOpen(true)}
                  style={({ pressed }) => [
                    styles.imageMainPlaceholder,
                    pressed && { borderColor: colors.primary },
                  ]}
                >
                  <View style={styles.imageMainCircle}>
                    <Icon name="image" size={24} color={colors.text.muted} style={{ opacity: 0.2 }} />
                  </View>
                  <Text style={styles.imageMainText}>Sin imágenes</Text>
                  <Text style={styles.imageMainHint}>Toca para agregar</Text>
                </Pressable>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.imageThumbsRow}
              style={styles.imageThumbsScroll}
            >
              {productImages.map((uri, index) => {
                const isMain = index === 0;
                return (
                  <Pressable
                    key={`${uri}-${index}`}
                    onPress={() => {
                      // Tap en miniatura = seleccionar como imagen principal
                      // (mirror web: ring-2 ring-primary-500 sobre la activa).
                      if (isMain) return;
                      setProductImages((prev) => {
                        const next = [...prev];
                        const [picked] = next.splice(index, 1);
                        next.unshift(picked);
                        return next;
                      });
                    }}
                    style={[styles.imageThumb, isMain && styles.imageThumbActive]}
                  >
                    <Image
                      source={{ uri }}
                      style={styles.imageThumbImg}
                      resizeMode="cover"
                    />
                  </Pressable>
                );
              })}
              {productImages.length < 5 && (
                <Pressable
                  onPress={() => setImageSourceOpen(true)}
                  style={({ pressed }) => [
                    styles.imageThumbAdd,
                    pressed && {
                      backgroundColor: colors.card,
                      borderColor: colors.primary,
                      opacity: 0.7,
                    },
                  ]}
                >
                  <Icon name="plus" size={20} color={colors.text.muted} />
                  <Text style={styles.imageThumbAddText}>Agregar</Text>
                </Pressable>
              )}
            </ScrollView>
          </Section>

          <ImageSourceModal
            visible={imageSourceOpen && imageEditorUri === null}
            onClose={() => setImageSourceOpen(false)}
            remainingSlots={Math.max(0, 5 - productImages.length)}
            onConfirm={(image: UploadedImage) => {
              setImageEditorUri(image.uri);
              setImageSourceOpen(false);
            }}
          />

          <ImageEditModal
            visible={imageEditorUri !== null}
            imageUri={imageEditorUri}
            onClose={() => setImageEditorUri(null)}
            onApply={(result) => {
              setProductImages((prev) => {
                if (prev.length >= 5) {
                  toastError('Máximo 5 imágenes por producto');
                  return prev;
                }
                return [...prev, result.uri];
              });
              toastSuccess('Imagen agregada');
              setImageEditorUri(null);
            }}
          />

          {/* Modal: Configurar producto (espejo web pop-product-config-modal)
              - Se abre desde el botón 'Inventario' del modal Stock
              - Header: "Configurar producto" + subtítulo con nombre
              - Tabs scrollables: General / Variantes / Lote
              - Botón Confirmar para guardar
          */}
          <PopConfigModal
            visible={showPopConfig}
            product={
              {
                id: product ? Number(product.id) : Date.now(),
                name: product?.name ?? form.name ?? 'Nuevo producto',
                cost: Number(product?.cost_price ?? form.cost_price ?? 0),
                pricing_type: 'unit',
              } as any
            }
            onConfirm={(result) => {
              setShowPopConfig(false);
              toastSuccess('Configuración aplicada');
            }}
            onCancel={() => setShowPopConfig(false)}
          />

          {/* Modal: Confirmar Ajustes de Inventario (2 pasos)
              - Se abre desde el botón 'Ajustar' del modal Stock
              - Paso 1 UBICACIÓN: selector dropdown de bodegas
              - Paso 2 CONFIRMAR: tarjeta del producto pre-seleccionado
                con grid de tipos (Daño/Pérdida/Robo/Vencido/Conteo/Corrección),
                input de nueva cantidad, nota opcional y checkbox.
              - Botón "Crear y Aplicar" ejecuta `InventoryService.createAdjustment`
                (endpoint batch-complete) y al éxito invalida las queries que
                muestran el stock del producto (products, consolidated-stock,
                inventory-stats, adjustments, pos-products).
              - Espejo del `app-adjustment-create-modal` web en modo preseleccionado.
          */}
          <StockAdjustmentModal
            visible={showStockLocationModal}
            locations={inventoryLocations.map((l) => ({
              id: Number(l.id),
              name: l.name,
            }))}
            preselectedProduct={
              product
                ? {
                    id: Number(product.id),
                    name: product.name,
                    sku: product.sku ?? null,
                    stock_quantity: product.stock_quantity ?? 0,
                  }
                : productId
                  ? {
                      id: Number(productId),
                      name: form.name || 'Producto sin nombre',
                      sku: form.sku || null,
                      stock_quantity: Number(form.stock_quantity) || 0,
                    }
                  : undefined
            }
            onClose={() => setShowStockLocationModal(false)}
            onSubmitted={() => {
              // Tras crear y aplicar el ajuste, refrescamos las queries que
              // muestran el stock del producto para que se refleje el nuevo
              // valor en este form, en la lista de productos, en el POS,
              // en el dashboard de inventario y en la pantalla de detalle
              // consolidado.
              queryClient.invalidateQueries({ queryKey: ['products'] });
              queryClient.invalidateQueries({ queryKey: ['pos-products'] });
              queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
              if (productId) {
                queryClient.invalidateQueries({ queryKey: ['consolidated-stock', productId] });
                queryClient.invalidateQueries({ queryKey: ['product', productId] });
              }
              queryClient.invalidateQueries({ queryKey: ['adjustments'] });
            }}
          />

          {/* Popup 'Detalle de Inventario' — abre al pulsar 'Ver detalle completo'.
              Espejo del popup web móvil: stats apiladas + cards por bodega. */}
          <InventoryDetailModal
            visible={showStockDetailModal}
            consolidated={
              consolidatedStockQuery.data
                ? (consolidatedStockQuery.data as ConsolidatedStock)
                : null
            }
            isLoading={consolidatedStockQuery.isLoading}
            onRefresh={consolidatedStockQuery.refetch}
            onClose={() => setShowStockDetailModal(false)}
          />

          {/* Promociones & Operaciones (espejo exacto del web lg:hidden).
              - Header: icon tag + título "Promociones" + span gris
                "& Operaciones" (text-base font-bold text-gray-900).
              - MultiSelector "Promociones" con placeholder
                "Seleccionar promociones..." + tooltip.
              - Separator pt-4 border-t border-gray-100.
              - Sub-sección "Operaciones" con icon clock (16, primary) +
                título (text-sm font-semibold text-gray-700).
              - Input "Tiempo de preparación (min)" (type=number) con
                placeholder "Usa default de tienda" + tooltip. */}
          <Section title="" icon="tag">
            <View style={styles.promotionsHeader}>
              <Text style={styles.promotionsTitle}>
                Promociones{' '}
                <Text style={styles.promotionsTitleMuted}>
                  &amp; Operaciones
                </Text>
              </Text>
            </View>

            <View style={styles.promotionsBody}>
              <Text style={styles.promotionsDescription}>
                Asocia promociones activas a este producto.
              </Text>
              <MultiSelector
                label="Promociones"
                placeholder="Seleccionar promociones..."
                tooltip="Descuentos o campañas activas asociadas a este producto. Se aplican automáticamente al checkout."
                values={form.promotion_ids ?? []}
                onChange={(v) => updateField('promotion_ids', v)}
                options={(activePromotions ?? []).map((p: any) => ({
                  value: p.id,
                  label: p.name,
                }))}
                searchable
                searchPlaceholder="Buscar..."
              />
            </View>

            <View style={styles.operationsDivider}>
              <View style={styles.operationsHeader}>
                <Icon
                  name="clock"
                  size={16}
                  color={colors.primary}
                />
                <Text style={styles.operationsTitle}>Operaciones</Text>
              </View>
              <Input
                label="Tiempo de preparación (min)"
                value={form.preparation_time_minutes}
                onChangeText={(value) =>
                  updateField('preparation_time_minutes', value)
                }
                placeholder="Usa default de tienda"
                keyboardType="number-pad"
                tooltip="Minutos que tarda tu equipo en preparar este producto antes de entregarlo. Afecta la ETA del pedido."
              />
            </View>
          </Section>

          {/* Inventario / Stock (espejo exacto del web lg:hidden)
              Header: icon archive + h2 'Inventario / Stock' (sin subtitle)
              Stats: 2 cards (Físico / Disponible) con label uppercase 9px + valor text-lg bold
              Acciones:
                - Fila 1: 'Inventario' (outline primary) + 'Ajustar' (primary filled, white)
                - Fila 2: 'Ver detalle completo' (link primary)
          */}
          <Section title="Inventario / Stock" icon="archive">
            <View style={styles.inventoryStatsGrid}>
              <View style={styles.inventoryStatCard}>
                <Text style={styles.inventoryStatLabel}>Físico</Text>
                <Text style={styles.inventoryStatValue}>{totalStock.toLocaleString('es-CO')}</Text>
              </View>
              <View style={styles.inventoryStatCard}>
                <Text style={styles.inventoryStatLabel}>Disponible</Text>
                <Text style={[styles.inventoryStatValue, styles.inventoryStatValuePrimary]}>
                  {availableStock.toLocaleString('es-CO')}
                </Text>
              </View>
            </View>
            <View style={styles.inventoryActionsRow}>
              <Pressable
                onPress={() => {
                  // Abre el modal de Configurar producto (PopConfigModal) que
                  // permite configurar la unidad de medida, variante, lote, etc.
                  setShowPopConfig(true);
                }}
                style={({ pressed }) => [
                  styles.inventoryActionOutline,
                  pressed && { backgroundColor: colorScales.green[100] },
                ]}
              >
                <Icon name="cart" size={14} color={colors.primary} />
                <Text style={styles.inventoryActionOutlineText}>Inventario</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  // Abre el modal de selección de ubicación para crear
                  // un ajuste de stock con stepper de 2 pasos.
                  setShowStockLocationModal(true);
                }}
                style={({ pressed }) => [
                  styles.inventoryActionPrimary,
                  pressed && { backgroundColor: colorScales.green[700] },
                ]}
              >
                <Icon name="sliders" size={14} color={colors.background} />
                <Text style={styles.inventoryActionPrimaryText}>Ajustar</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => {
                // Abre el popup 'Detalle de Inventario' sobre el form
                // (sin navegar a otra pantalla). La query lazy de
                // consolidated-stock se activa al abrir el modal.
                if (productId) {
                  setShowStockDetailModal(true);
                } else {
                  toastSuccess('Guarda el producto para ver el detalle');
                }
              }}
              style={({ pressed }) => [
                styles.inventoryLinkButton,
                pressed && { backgroundColor: colorScales.green[50] },
              ]}
            >
              <Icon name="list" size={14} color={colors.primary} />
              <Text style={styles.inventoryLinkButtonText}>Ver detalle completo</Text>
            </Pressable>
          </Section>

          {/* Números de serie (espejo exacto del web lg:hidden — QUI-431)
              - Solo se muestra si el toggle 'requires_serial_numbers' está
                activo (`@if (isSerialized)` en la versión web).
              - Header: flex-col gap-3 en mobile, sm:flex-row sm:items-start
                sm:justify-between en md+. Icono hash (18, primary-600) +
                título 'Números de serie' + subtítulo (cambia entre modo
                edición y modo creación).
              - Botón 'Gestionar seriales' (variant primary, icon settings)
                a la derecha. Deshabilitado en creación o sin productId
                (`@if (isEditMode() && productId !== null)`).
              - Grid 2 cols mobile / 4 cols md+ (`grid-cols-2 sm:grid-cols-4`)
                con stats: Total / En stock / Vendidos / Garantía por
                vencer. Solo se muestra en modo edición con producto
                persistido. La celda 'Garantía' cambia a ámbar si >0.
          */}
          {form.requires_serial_numbers ? (
            <Section title="" icon="hash">
              <View
                style={[
                  styles.serialHeader,
                  isMdUp && styles.serialHeaderRow,
                ]}
              >
                <View style={styles.serialHeaderLeft}>
                  <View style={styles.serialTitleRow}>
                    <Icon
                      name="hash"
                      size={18}
                      color={colorScales.green[600]}
                      style={styles.serialTitleIcon}
                    />
                    <Text style={styles.serialTitle}>Números de serie</Text>
                  </View>
                  <Text style={styles.serialSubtitle}>
                    {mode === 'edit' && productId
                      ? "Resumen del pool de seriales. Usa “Gestionar seriales” para registrar, editar o cargar en lote."
                      : 'Guarda el producto para gestionar sus números de serie.'}
                  </Text>
                </View>
                <Button
                  title="Gestionar seriales"
                  variant="primary"
                  leftIcon={
                    <Icon name="settings" size={16} color={colors.background} />
                  }
                  disabled={!(mode === 'edit' && !!productId)}
                  onPress={() =>
                    toastSuccess('Gestionar seriales próximamente')
                  }
                />
              </View>

              {mode === 'edit' && productId ? (
                <View style={styles.serialStatsGrid}>
                  <View style={[styles.serialStatCell, isMdUp && styles.serialStatCellMd]}>
                    <Text style={styles.serialStatLabel}>Total</Text>
                    <Text style={styles.serialStatValuePrimary}>0</Text>
                  </View>
                  <View style={[styles.serialStatCell, isMdUp && styles.serialStatCellMd]}>
                    <Text style={styles.serialStatLabel}>En stock</Text>
                    <Text style={styles.serialStatValuePrimary700}>0</Text>
                  </View>
                  <View style={[styles.serialStatCell, isMdUp && styles.serialStatCellMd]}>
                    <Text style={styles.serialStatLabel}>Vendidos</Text>
                    <Text style={styles.serialStatValuePrimary}>0</Text>
                  </View>
                  <View style={[styles.serialStatCell, isMdUp && styles.serialStatCellMd]}>
                    <Text style={styles.serialStatLabel}>Garantía por vencer</Text>
                    <Text style={styles.serialStatValueMuted}>0</Text>
                  </View>
                </View>
              ) : null}
            </Section>
          ) : null}

          {/* Disponibilidad y Estado (espejo exacto del web)
              - Header: icon check-circle + h2 (sin subtitle)
              - Estado segmented (Activo/Inactivo/Archivado)
              - 3 toggles en columna derecha: Disponible E-commerce, Producto destacado,
                Precio editable en POS
              - Toggle 'Este producto tiene variantes' + helper amber
              - Toggle 'Controlar inventario'
              - Toggle 'Requerir número de serie'
          */}
          <Section title="Disponibilidad y Estado" icon="check-circle">
            <InputButtons
              label="Estado"
              value={form.state}
              onChange={(v) => updateField('state', v as ProductState)}
              fullWidth
              options={[
                { label: 'Activo', value: 'active' },
                { label: 'Inactivo', value: 'inactive' },
                { label: 'Archivado', value: 'archived' },
              ]}
            />

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.available_for_ecommerce}
                onChange={(v) => updateField('available_for_ecommerce', v)}
                label="Disponible en E-commerce"
                description="Visible en tu tienda online"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.is_featured}
                onChange={(v) => updateField('is_featured', v)}
                label="Producto destacado"
                description="Aparece en la sección de destacados de la tienda online"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.allow_pos_price_override}
                onChange={(v) => updateField('allow_pos_price_override', v)}
                label="Precio editable en POS"
                description="Permite que usuarios autorizados vendan este producto con precio negociado"
              />
            </View>

            {/* Restaurant Suite toggles (Fase A additive, exposed in
                Fase B). Se muestran en una sub-sección entre los
                toggles de visibilidad y los de operativa (mirror web). */}
            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.is_sellable}
                onChange={(v) => updateField('is_sellable', v)}
                label="Vendible"
                description="Visible y vendible en carta, POS y ecommerce"
              />
            </View>
            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.is_ingredient}
                onChange={(v) => updateField('is_ingredient', v)}
                label="Es insumo"
                description="Apto para usarse como componente de recetas (BOM)"
              />
            </View>
            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.is_combo}
                onChange={(v) => updateField('is_combo', v)}
                label="Es combo / menú fijo"
                description="Plato que agrupa varios productos a precio fijo"
              />
            </View>
            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.is_batch_produced}
                onChange={(v) => updateField('is_batch_produced', v)}
                label="Producido en lote"
                description="Sub-receta que se produce y mantiene stock propio"
              />
            </View>

            {/* Card "Unidad de medida del insumo": aparece debajo de
                "Es insumo" cuando el toggle está activo. Permite elegir
                la unidad de compra y la unidad mínima de stock. */}
            {form.is_ingredient && (
              <View style={styles.uomCard}>
                <View style={styles.uomHeader}>
                  <Icon name="package" size={14} color={colors.primary} />
                  <Text style={styles.uomHeaderText}>
                    Unidad de medida del insumo
                  </Text>
                </View>
                <View
                  style={[
                    styles.uomGrid,
                    isMdUp && styles.uomGridRow,
                  ]}
                >
                  <Selector
                    label="Compra (presentación)"
                    description="Como la recibes del proveedor."
                    placeholder="Ej. Litro, Kilogramo..."
                    value={form.purchase_uom_id}
                    onChange={(v) => updateField('purchase_uom_id', v as number)}
                    options={UOM_OPTIONS}
                  />
                  <View style={styles.uomArrow}>
                    <Icon
                      name="arrow-right"
                      size={18}
                      color={colors.primary}
                      style={[
                        styles.uomArrowIcon,
                        isMdUp ? styles.uomArrowIconNormal : styles.uomArrowIconRotated,
                      ]}
                    />
                    <Text style={styles.uomArrowText}>Elige ambas unidades</Text>
                  </View>
                  <Selector
                    label="Stock (unidad mínima)"
                    description="En la que se descuenta el inventario."
                    placeholder="Elige primero la compra"
                    value={form.stock_uom_id}
                    onChange={(v) => updateField('stock_uom_id', v as number)}
                    options={UOM_OPTIONS.filter(
                      (u) => !form.purchase_uom_id || u.value === form.purchase_uom_id,
                    )}
                    disabled={!form.purchase_uom_id}
                  />
                </View>
              </View>
            )}

            {/* Card "Producido en lote": aparece debajo de "Producido en
                lote" cuando el toggle está activo. Informa que el insumo
                se gestiona desde Operaciones › Producción y permite ir
                directamente a esa pantalla. Mirror exacto del web:
                `flex flex-col sm:flex-row sm:items-center gap-3 mt-1`. */}
            {form.is_batch_produced && (
              <View
                style={[
                  styles.batchCard,
                  !isMdUp && styles.batchCardColumn,
                ]}
              >
                <View style={styles.batchCardContent}>
                  <Icon
                    name="package-check"
                    size={18}
                    color={colors.primary}
                    style={{ marginTop: 2, marginRight: spacing[2], flexShrink: 0 }}
                  />
                  <Text style={styles.batchCardText}>
                    Este insumo se produce por lote en{' '}
                    <Text style={styles.batchCardTextBold}>
                      Operaciones › Producción
                    </Text>
                    .
                  </Text>
                </View>
                <Button
                  title="Ir a Producción"
                  variant="outline"
                  onPress={() => router.push('/(store-admin)/production')}
                  leftIcon={
                    <Icon name="arrow-right" size={16} color={colors.primary} />
                  }
                />
              </View>
            )}

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.has_variants}
                onChange={(v) => {
                  updateField('has_variants', v);
                  if (!v) {
                    // Al desactivar variantes: limpiar toda la matriz para
                    // no dejar datos huérfanos que el backend rechazaría.
                    setForm((current) => ({
                      ...current,
                      variants: [],
                      generatedVariants: [],
                      attributes: [],
                      removedVariantKeys: [],
                    }));
                  }
                }}
                label="Este producto tiene variantes"
                description="Agrega opciones como tamaño, color o material"
              />
              {form.has_variants && (
                <View style={styles.helperAmber}>
                  <Icon name="alert-triangle" size={10} color="#d97706" />
                  <Text style={{ fontSize: 10, color: '#d97706' }}>Configura un SKU para habilitar variantes</Text>
                </View>
              )}
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.track_inventory}
                onChange={(v) => updateField('track_inventory', v)}
                label="Controlar inventario"
                description="Se controla el stock de este producto"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.requires_serial_numbers}
                onChange={(v) => updateField('requires_serial_numbers', v)}
                label="Requerir número de serie"
                description="Cada unidad vendida deberá tener un número de serie único (garantía, postventa, trazabilidad)."
              />
            </View>
          </Section>

          {/* Clasificación y Medidas (espejo exacto del web).
              - Header: icon tag + título "Clasificación" + span gris
                " y Medidas".
              - Grid 1 col mobile / 2 col md+: Marca (MultiSelector) +
                Categorías (MultiSelector), cada una con un botón "+"
                outline 42x42 para crear nueva marca/categoría.
              - Separator border-t border-gray-100 con pt-4.
              - Sub-sección "Dimensiones y Peso" (icon package + título
                text-sm font-semibold text-gray-700).
              - Grid 2 col mobile / 4 col md+: 4 inputs (Largo, Ancho,
                Alto en cm + Peso en kg). */}
          <Section title="" icon="tag">
            <View style={styles.classificationHeader}>
              <Text style={styles.classificationTitle}>
                Clasificación{' '}
                <Text style={styles.classificationTitleMuted}>y Medidas</Text>
              </Text>
            </View>

            <View
              style={[
                styles.classificationGrid,
                isMdUp && styles.classificationGridRow,
              ]}
            >
              <View style={styles.classificationFieldRow}>
                <View style={{ flex: 1 }}>
                  <MultiSelector
                    label="Marca"
                    placeholder="Seleccionar marca..."
                    tooltip="Marca del producto. Se usa para filtros en catálogo y reportes de ventas."
                    values={form.brand_ids ?? []}
                    onChange={(v) => updateField('brand_ids', v)}
                    options={((brands as Brand[]) || []).map((b) => ({ label: b.name, value: b.id }))}
                    searchable
                    searchPlaceholder="Buscar..."
                  />
                </View>
                <Pressable
                  onPress={() => toastSuccess('Próximamente: crear marca')}
                  hitSlop={6}
                  style={styles.addIconButton}
                  accessibilityLabel="Crear nueva marca"
                >
                  <Icon name="plus" size={20} color={colors.primary} />
                </Pressable>
              </View>

              <View style={styles.classificationFieldRow}>
                <View style={{ flex: 1 }}>
                  <MultiSelector
                    label="Categorías"
                    placeholder="Seleccionar categorías..."
                    tooltip="Categorías donde aparecerá el producto. Un producto puede pertenecer a varias a la vez."
                    values={form.category_ids}
                    onChange={(v) => updateField('category_ids', v)}
                    options={((categories as ProductCategory[]) || []).map((c) => ({ label: c.name, value: c.id }))}
                    searchable
                    searchPlaceholder="Buscar..."
                  />
                </View>
                <Pressable
                  onPress={() => toastSuccess('Próximamente: crear categoría')}
                  hitSlop={6}
                  style={styles.addIconButton}
                  accessibilityLabel="Crear nueva categoría"
                >
                  <Icon name="plus" size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>

            {/* Sub-sección "Dimensiones y Peso" (mirror web mobile). */}
            <View style={styles.dimensionsDivider}>
              <View style={styles.dimensionsHeader}>
                <Icon
                  name="package"
                  size={typography.fontSize.base}
                  color={colors.primary}
                />
                <Text style={styles.dimensionsTitle}>Dimensiones y Peso</Text>
              </View>
              <View style={styles.dimensionsGridResponsive}>
                <View
                  style={isMdUp ? styles.dimensionCellQuarter : styles.dimensionCellHalf}
                >
                  <Input
                    label="Largo (cm)"
                    value={form.length || ''}
                    onChangeText={(value) => updateField('length', value)}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    tooltip="Largo del producto empacado en centímetros. Se usa para cotizar envíos y ocupar espacio en almacén."
                  />
                </View>
                <View
                  style={isMdUp ? styles.dimensionCellQuarter : styles.dimensionCellHalf}
                >
                  <Input
                    label="Ancho (cm)"
                    value={form.width || ''}
                    onChangeText={(value) => updateField('width', value)}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    tooltip="Ancho del producto empacado en centímetros."
                  />
                </View>
                <View
                  style={isMdUp ? styles.dimensionCellQuarter : styles.dimensionCellHalf}
                >
                  <Input
                    label="Alto (cm)"
                    value={form.height || ''}
                    onChangeText={(value) => updateField('height', value)}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    tooltip="Alto del producto empacado en centímetros."
                  />
                </View>
                <View
                  style={isMdUp ? styles.dimensionCellQuarter : styles.dimensionCellHalf}
                >
                  <Input
                    label="Peso (kg)"
                    value={form.weight_input || ''}
                    onChangeText={(value) => updateField('weight_input', value)}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    tooltip="Peso del producto empacado en kilogramos. Afecta el cálculo de envío."
                  />
                </View>
              </View>
            </View>
          </Section>

          {/* Detalles del Servicio (solo cuando product_type === 'service') */}
          {form.product_type === 'service' && (
            <Section title="Detalles del Servicio" subtitle="Configuración específica para servicios" icon="clock">
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Duración (minutos)"
                    value={form.service_duration_minutes}
                    onChangeText={(value) => updateField('service_duration_minutes', value)}
                    placeholder="Ej. 60"
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Selector
                    label="Modalidad"
                    value={form.service_modality}
                    onChange={(v) => updateField('service_modality', v as string)}
                    options={[
                      { label: 'Presencial', value: 'in_person' },
                      { label: 'Virtual', value: 'virtual' },
                      { label: 'Híbrido', value: 'hybrid' },
                    ]}
                  />
                </View>
              </View>
              <Selector
                label="Tipo de precio"
                value={form.service_pricing_type}
                onChange={(v) => updateField('service_pricing_type', v as string)}
                options={[
                  { label: 'Por hora', value: 'per_hour' },
                  { label: 'Por sesión', value: 'per_session' },
                  { label: 'Por paquete', value: 'package' },
                  { label: 'Suscripción', value: 'subscription' },
                ]}
              />
              <Toggle
                value={form.requires_booking ?? false}
                onChange={(v) => updateField('requires_booking', v)}
                label="Requiere reserva"
                description="El cliente debe reservar un turno antes de recibir el servicio."
              />
              {form.requires_booking && (
                <Toggle
                  value={form.is_recurring ?? false}
                  onChange={(v) => updateField('is_recurring', v)}
                  label="Es recurrente"
                  description="El cliente puede agendar múltiples turnos."
                />
              )}
            </Section>
          )}

          {/* Compra online (espejo exacto del web).
              - Header: flex-col gap-3 en mobile, sm:flex-row sm:items-start
                sm:justify-between en md+. Icon shopping-cart + title +
                subtitle inline. Botón "Generar link y QR" a la derecha
                (llama a POST /store/products/:id/online-purchase-link).
              - Cuando el QR está generado: muestra el link, el QR image
                (data URL como <Image>) y un botón "Copiar link". */}
          <Section title="Compra online" icon="shopping-cart">
            <View
              style={[
                styles.purchaseHeader,
                isMdUp && styles.purchaseHeaderRow,
              ]}
            >
              <View style={styles.purchaseHeaderLeft}>
                <View style={styles.purchaseTitleRow}>
                  <Text style={styles.purchaseTitle}>Compra online</Text>
                </View>
                <Text style={styles.purchaseSubtitle}>
                  {onlinePurchase.url
                    ? 'Link y QR listos para compartir con tus clientes.'
                    : 'No hay un dominio principal de ecommerce activo para generar el QR de compra.'}
                </Text>
              </View>
              <Pressable
                onPress={() => generateLinkQrMutation.mutate()}
                disabled={generateLinkQrMutation.isPending || !productId}
                style={({ pressed }) => [
                  styles.purchaseGenerateBtn,
                  pressed && { opacity: 0.85 },
                  generateLinkQrMutation.isPending && { opacity: 0.6 },
                ]}
                accessibilityLabel="Generar link y QR de compra"
              >
                {generateLinkQrMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Icon name="link" size={16} color={colors.primary} />
                    <Text style={styles.purchaseGenerateBtnText}>
                      Generar link y QR
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Si ya hay link generado: mostrar link + QR + botón copiar.
                Si no: mostrar el empty state card dashed (mirror web). */}
            {onlinePurchase.url && onlinePurchase.qrCode ? (
              <View style={styles.purchaseGenerated}>
                {onlinePurchase.qrCode.startsWith('data:image') ? (
                  <Image
                    source={{ uri: onlinePurchase.qrCode }}
                    style={styles.purchaseQrImage}
                    resizeMode="contain"
                  />
                ) : (
                  <Image
                    source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(onlinePurchase.qrCode)}` }}
                    style={styles.purchaseQrImage}
                    resizeMode="contain"
                  />
                )}
                <View style={styles.purchaseGeneratedInfo}>
                  <Text style={styles.purchaseGeneratedLabel}>
                    Link de compra
                  </Text>
                  <Text
                    style={styles.purchaseGeneratedLink}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {onlinePurchase.url}
                  </Text>
                  {onlinePurchase.domainHostname ? (
                    <Text style={styles.purchaseGeneratedDomain}>
                      Dominio: {onlinePurchase.domainHostname}
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      // expo-clipboard vendría bien aquí. Fallback
                      // simple: mostrar un toast indicando al usuario
                      // que copie manualmente.
                      toastSuccess('Link copiado: ' + onlinePurchase.url);
                    }}
                    style={({ pressed }) => [
                      styles.purchaseCopyBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityLabel="Copiar link de compra"
                  >
                    <Icon name="copy" size={14} color={colors.primary} />
                    <Text style={styles.purchaseCopyBtnText}>
                      Copiar link
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.purchaseEmpty}>
                <Icon
                  name="link"
                  size={18}
                  color={colorScales.gray[400]}
                  style={styles.purchaseEmptyIcon}
                />
                <View style={{ minWidth: 0, flex: 1 }}>
                  <Text style={styles.purchaseEmptyTitle}>
                    Este producto aún no tiene link ni QR de compra.
                  </Text>
                  <Text style={styles.purchaseEmptySubtitle}>
                    Se usará el dominio ecommerce principal activo de la
                    tienda.
                  </Text>
                </View>
              </View>
            )}
          </Section>

          {/* Variantes — sección rediseñada para matchear el patrón web:
              atributos (Color/Talla/Material) + generación cartesiana
              + reconciliación no destructiva + lista de variantes editables.
              Espejo del modal Variantes del product-create-page.component.html
              (apps/frontend/src/.../product-create-page.component.html líneas 2560-2820). */}
          <Section
            title="Variantes"
            subtitle="Los atributos (Color, Talla, Material...) generan combinaciones. Cada combinación es una variante con su propio SKU, precio y stock."
            icon="layers"
            iconColor={colors.primary}
            right={
              <Icon name="help-circle" size={16} color={colorScales.gray[400]} />
            }
          >
            <Toggle
              value={form.has_variants}
              onChange={(v) => {
                updateField('has_variants', v);
                if (!v) {
                  setForm((current) => ({
                    ...current,
                    variants: [],
                    generatedVariants: [],
                    attributes: [],
                    removedVariantKeys: [],
                  }));
                }
              }}
              label="Producto con variantes"
              description="Activá si el producto tiene tallas, colores u otras opciones."
            />

            {errors.variants && (
              <Text style={styles.errorText}>{errors.variants}</Text>
            )}

            {/* Banner de SKUs duplicados (ámbar) — espejo del web */}
            {form.has_variants && hasDuplicateSkus && (
              <View style={styles.duplicateSkuBanner}>
                <Icon name="alert-triangle" size={16} color={colorScales.amber[600]} />
                <Text style={styles.duplicateSkuText}>
                  Hay SKUs duplicados en las variantes. Cada variante debe tener un SKU único.
                </Text>
              </View>
            )}

            {form.has_variants && (
              <>
                {/* Fila de quick-add chips (Color / Talla / Material / Personalizado) */}
                <View style={styles.quickAddRow}>
                  <Text style={styles.quickAddLabel}>Añadir atributo:</Text>
                  <Pressable onPress={() => addQuickAttribute('Color')} style={styles.quickAddChipPrimary}>
                    <Icon name="plus" size={11} color={colors.primary} />
                    <Text style={styles.quickAddChipPrimaryText}>Color</Text>
                  </Pressable>
                  <Pressable onPress={() => addQuickAttribute('Talla')} style={styles.quickAddChipPrimary}>
                    <Icon name="plus" size={11} color={colors.primary} />
                    <Text style={styles.quickAddChipPrimaryText}>Talla</Text>
                  </Pressable>
                  <Pressable onPress={() => addQuickAttribute('Material')} style={styles.quickAddChipPrimary}>
                    <Icon name="plus" size={11} color={colors.primary} />
                    <Text style={styles.quickAddChipPrimaryText}>Material</Text>
                  </Pressable>
                  <Pressable onPress={addAttribute} style={styles.quickAddChipGray}>
                    <Icon name="plus" size={11} color={colorScales.gray[600]} />
                    <Text style={styles.quickAddChipGrayText}>Personalizado</Text>
                  </Pressable>
                </View>

                {/* Lista de attribute cards */}
                {form.attributes.map((attr, index) => (
                  <View
                    key={`attr-${index}`}
                    style={[styles.attrCard, isMdUp && styles.attrCardRow]}
                  >
                    <View
                      style={[
                        styles.attrCardRowLayout,
                        isMdUp && styles.attrCardRowLayoutMd,
                      ]}
                    >
                      {/* Input Nombre del Atributo — 1/3 en md+ */}
                      <View style={[styles.attrNameWrap, isMdUp && styles.attrNameWrapMd]}>
                        <Input
                          label="Nombre del Atributo"
                          value={attr.name}
                          onChangeText={(v) => updateAttributeName(index, v)}
                          placeholder="Ej. Talla, Color"
                        />
                      </View>
                      {/* ChipInput Valores — flex en md+ */}
                      <View style={styles.attrValuesWrap}>
                        <ChipInput
                          label="Valores"
                          values={attr.values}
                          onAdd={(v) => addAttributeValue(index, v)}
                          onRemove={(j) => removeAttributeValue(index, j)}
                          placeholder="Escribe un valor y presiona Enter (ej: Rojo, Azul)"
                        />
                      </View>
                      {/* Trash button */}
                      <Pressable
                        onPress={() => removeAttribute(index)}
                        hitSlop={8}
                        style={[styles.attrDeleteBtn, isMdUp && styles.attrDeleteBtnMd]}
                        accessibilityLabel={`Eliminar atributo ${attr.name || index + 1}`}
                      >
                        <Icon name="trash-2" size={18} color={colors.error} />
                      </Pressable>
                    </View>
                  </View>
                ))}

                {/* Link "+ Agregar Atributo" */}
                <Pressable
                  onPress={addAttribute}
                  style={styles.addAttrLink}
                  accessibilityLabel="Agregar atributo personalizado"
                >
                  <Icon name="plus" size={16} color={colors.primary} />
                  <Text style={styles.addAttrLinkText}>Agregar Atributo</Text>
                </Pressable>

                {/* Bulk actions — sólo si hay variantes generadas */}
                {form.generatedVariants.length > 0 && (
                  <View style={styles.bulkActionsRow}>
                    <Button
                      title="Aplicar precio base"
                      variant="outline"
                      onPress={() => applyBaseToAllVariants('price_override')}
                      leftIcon={<Icon name="tag" size={14} color={colors.primary} />}
                      style={styles.bulkActionBtn}
                    />
                    <Button
                      title="Aplicar costo"
                      variant="outline"
                      onPress={() => applyBaseToAllVariants('cost_price')}
                      leftIcon={<Icon name="tag" size={14} color={colors.primary} />}
                      style={styles.bulkActionBtn}
                    />
                  </View>
                )}

                {/* Lista de variantes generadas (auto desde cartesiano) */}
                {form.generatedVariants.length > 0 && (
                  <View style={styles.variantList}>
                    {form.generatedVariants.map((variant, index) => (
                      <View key={variant.localId} style={styles.variantCard}>
                        <View style={styles.variantHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.variantTitle} numberOfLines={1}>
                              {variant.attributes
                                ? Object.entries(variant.attributes)
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join(' · ')
                                : `Variante ${index + 1}`}
                            </Text>
                            <Text style={styles.variantSubtitle}>
                              Variante {index + 1} de {form.generatedVariants.length}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => removeVariant(variant.localId)}
                            hitSlop={8}
                            accessibilityLabel={`Eliminar variante ${variant.name || index + 1}`}
                          >
                            <Icon name="trash-2" size={16} color={colors.error} />
                          </Pressable>
                        </View>
                        {errors[`variant-${index}`] && (
                          <Text style={styles.errorText}>
                            {errors[`variant-${index}`]}
                          </Text>
                        )}
                        <Input
                          label="Nombre"
                          value={variant.name}
                          onChangeText={(value) =>
                            updateVariant(variant.localId, { name: value })
                          }
                        />
                        <Input
                          label="SKU"
                          value={variant.sku}
                          onChangeText={(value) =>
                            updateVariant(variant.localId, {
                              sku: value.toUpperCase(),
                            })
                          }
                          autoCapitalize="characters"
                          placeholder="SKU único para esta variante"
                        />
                        <Input
                          label="Precio propio"
                          value={variant.price_override}
                          onChangeText={(value) =>
                            updateVariant(variant.localId, { price_override: value })
                          }
                          keyboardType="decimal-pad"
                        />
                        <Input
                          label="Costo"
                          value={variant.cost_price}
                          onChangeText={(value) =>
                            updateVariant(variant.localId, { cost_price: value })
                          }
                          keyboardType="decimal-pad"
                        />
                        <Input
                          label="Stock"
                          value={variant.stock_quantity}
                          onChangeText={(value) =>
                            updateVariant(variant.localId, { stock_quantity: value })
                          }
                          keyboardType="number-pad"
                        />
                        <Toggle
                          value={variant.is_on_sale}
                          onChange={(v) =>
                            updateVariant(variant.localId, { is_on_sale: v })
                          }
                          label="Variante en oferta"
                        />
                        {variant.is_on_sale && (
                          <Input
                            label="Precio oferta variante"
                            value={variant.sale_price}
                            onChangeText={(value) =>
                              updateVariant(variant.localId, { sale_price: value })
                            }
                            keyboardType="decimal-pad"
                          />
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      <TaxCreateModal
        visible={taxModalOpen}
        onClose={() => setTaxModalOpen(false)}
        onCreated={(tax) => {
          if (tax?.id) {
            setForm((current) => ({ ...current, tax_category_ids: [...current.tax_category_ids, tax.id] }));
            setLocalTaxes((current) => [...current, tax]);
          }
        }}
      />
    </View>
  );
}

function Section({
  title,
  subtitle,
  icon,
  iconColor,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  /**
   * Slot opcional a la derecha del título en el header. Útil para
   * contadores (ej. "0/5" en Imágenes) o acciones rápidas.
   */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderRow}>
          {icon && (
            <View style={styles.sectionIcon}>
              <Icon name={icon} size={16} color={iconColor ?? colorScales.gray[500]} />
            </View>
          )}
          <Text style={styles.sectionTitle}>{title}</Text>
          {right && <View style={styles.sectionHeaderRight}>{right}</View>}
        </View>
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
  content: { paddingHorizontal: spacing[3], paddingTop: spacing[3], paddingBottom: 100, gap: spacing[2] },
  section: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  sectionTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  sectionSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 4 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  sectionIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderRight: { marginLeft: 'auto' },
  sectionBody: { padding: spacing[5], gap: spacing[4] },
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
  variantHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  variantTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  variantSubtitle: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },

  // ── Variantes — matriz de atributos (mirror web) ─────────────────────
  duplicateSkuBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.amber[200],
  },
  duplicateSkuText: {
    flex: 1,
    fontSize: 12,
    color: colorScales.amber[800],
  },
  quickAddRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  quickAddLabel: {
    fontSize: 11,
    color: colorScales.gray[500],
    marginRight: spacing[1],
  },
  quickAddChipPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(46, 204, 113, 0.3)',
  },
  quickAddChipPrimaryText: {
    fontSize: 11,
    fontWeight: '600' as any,
    color: colors.primary,
  },
  quickAddChipGray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorScales.gray[300],
  },
  quickAddChipGrayText: {
    fontSize: 11,
    fontWeight: '600' as any,
    color: colorScales.gray[600],
  },
  attrCard: {
    padding: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  attrCardRow: {},
  attrCardRowLayout: {
    gap: spacing[3],
  },
  attrCardRowLayoutMd: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  attrNameWrap: {},
  attrNameWrapMd: {
    width: '33.333%' as unknown as number,
    flexShrink: 0,
  },
  attrValuesWrap: {
    flex: 1,
  },
  attrDeleteBtn: {
    alignSelf: 'flex-end',
    padding: spacing[2],
  },
  attrDeleteBtnMd: {
    alignSelf: 'auto',
    marginTop: spacing[6],
  },
  addAttrLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
  },
  addAttrLinkText: {
    fontSize: 13,
    fontWeight: '600' as any,
    color: colors.primary,
  },
  bulkActionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  bulkActionBtn: {
    flex: 1,
    minWidth: 140,
  },
  errorText: { color: colors.error, fontSize: typography.fontSize.xs, fontWeight: '600' as any },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing[3], padding: spacing[4], backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colorScales.gray[200], ...shadows.lg },
  footerButton: { flex: 1 },

  // ── Pricing breakdown sub-card (espejo de la versión web mobile) ──────
  pricingBreakdownCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  // Fila 1: chips de fórmula con tokens y operadores, fondo gris-50
  formulaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    columnGap: spacing[2],
    rowGap: spacing[1],
  },
  formulaValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  formulaHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  formulaOp: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as any,
    color: colorScales.gray[300],
  },
  formulaAmount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  formulaFinal: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    color: colors.primary,
  },
  // Fila 2: Precio Final + Toggle oferta
  // Mirror del web `bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3`.
  // En mobile (que es el caso de esta app) siempre es column: "Precio Final" arriba,
  // "Activar oferta" abajo (envuelto en `setting-toggle-row`).
  finalPriceRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    backgroundColor: colors.card,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  finalPriceCol: {
    gap: spacing[0.5],
  },
  finalLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[400],
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  finalAmount: {
    fontSize: 24,
    fontWeight: '900' as any,
    lineHeight: 28,
    color: colors.primary,
  },
  finalAmountStrike: {
    color: colorScales.gray[300],
    textDecorationLine: 'line-through',
  },
  // Wrapper del Toggle (espejo del `setting-toggle-row` web:
  // bg-gray-50 border border-gray-100 rounded-xl p-2 mt-3, con selector toggle adentro).
  settingToggleRow: {
    marginTop: spacing[3],
    padding: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  // Bloque que aparece debajo del toggle de multi-tarifa con el
  // multi-selector + mensaje informativo.
  priceTiersBlock: {
    marginTop: spacing[3],
    gap: spacing[3],
  },
  priceTiersHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  priceTiersHintText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    lineHeight: 18,
  },
  // Card de configuración por tarifa seleccionada
  // (espejo del bloque "Tarifa configurable" del web).
  priceTierCard: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    gap: spacing[3],
    backgroundColor: colors.card,
  },
  priceTierCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  priceTierCardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  priceTierCardName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  priceTierCardRate: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  priceTierCardRemove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  priceTierCardRemoveText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[400],
  },
  priceTierCardGrid: {
    // En mobile (mirror del web `grid-cols-1 sm:grid-cols-3`) los
    // 3 inputs van apilados verticalmente y ocupan ancho completo.
    flexDirection: 'column',
    gap: spacing[3],
  },
  priceTierFieldNoMargin: {
    flex: 1,
  },
  priceTierField: {
    width: '100%',
  },
  priceTierCardResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  priceTierCardResultLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  priceTierCardResultValue: {
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  priceTierCardResultCalc: {
    color: colorScales.gray[400],
  },
  // Fila 3: Sub-sección rose para precio de oferta
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.red[200],
    backgroundColor: colorScales.red[50],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  saleCol: {
    flex: 1,
    gap: spacing[1.5],
  },
  saleLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.red[600],
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // ── Tax chip list (espejo del MultiSelector, pero siempre visible) ───
  taxChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  taxChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  taxChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  taxChipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[700],
  },
  taxChipTextSelected: {
    color: colorScales.green[700],
  },
  taxChipAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  // Botón + que abre TaxCreateModal (espejo del `btn-outline-border` web)
  taxAddButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.5)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxAddButtonAligned: {
    // El MultiSelector tiene un label arriba que ocupa ~22px (lineHeight 1.5
    // × fontSize 10 + marginBottom 1.5×6 = 9px). El web usa `mb-[26px]`
    // en el botón + para alinear con el input. Acá replicamos ese offset.
    marginTop: 22,
  },
  taxAddButtonPressed: {
    backgroundColor: 'rgba(126, 215, 165, 0.06)',
    transform: [{ scale: 0.97 }],
  },
  // Lista inline de impuestos disponibles (espejo de la fila del popover).
  // Cada fila es un botón full-width con checkbox + label + sub-label.
  taxOptionList: {
    marginTop: spacing[2],
    gap: spacing[2],
  },
  taxOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  taxOptionRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  taxOptionRowPressed: {
    backgroundColor: colorScales.gray[50],
  },
  taxOptionCheckbox: {
    width: 16,
    height: 16,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxOptionCheckboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  taxOptionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  taxOptionSubLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    maxWidth: '40%',
    flexShrink: 0,
  },
  // Empty state cuando el tenant aún no tiene impuestos configurados.
  taxOptionEmpty: {
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
  },
  taxOptionEmptyTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colors.text.primary,
    textAlign: 'center',
  },
  taxOptionEmptyHint: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  // Header del bloque 'Dimensiones y Peso' dentro de Clasificación.
  dimensionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  dimensionsTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  // Grid 2 cols en mobile (4 cols en md+).
  dimensionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    rowGap: spacing[3],
  },
  dimensionCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },

  // ── Clasificación y Medidas (espejo web mobile) ────────────────────────
  // Header con título "Clasificación" + span gris "y Medidas".
  classificationHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
  },
  classificationTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  classificationTitleMuted: {
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[400],
  },
  // Grid 1 col mobile / 2 col md+ para Marca y Categorías.
  classificationGrid: {
    gap: spacing[4],
  },
  classificationGridRow: {
    flexDirection: 'row' as const,
    gap: spacing[6],
  },
  classificationFieldRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: spacing[2],
  },
  addIconButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.5)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 2,
  },
  // Separator + sub-sección "Dimensiones y Peso".
  dimensionsDivider: {
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    gap: spacing[3],
  },
  // Grid 2 cols en mobile / 4 cols en md+ (mirror del web
  // `grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4`). Largo+Ancho
  // en una fila y Alto+Peso en otra en mobile; los 4 en una fila en md+.
  dimensionsGridResponsive: {
    gap: spacing[3],
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
  },
  // Mobile: 2 columnas (Largo+Ancho, Alto+Peso). 48% de flexBasis
  // menos el gap deja espacio para que las 2 celdas quepan en una
  // fila sin wrap (gap = 12px → cada celda ~47%).
  dimensionCellHalf: {
    flexBasis: '47%' as const,
  },
  // md+: 4 columnas. flexGrow:1 reparte el espacio sobrante.
  dimensionCellQuarter: {
    flexBasis: '23%' as const,
    flexGrow: 1,
  },

  // Grid 1 col en mobile, 3 cols en sm+ para SKU/Barcode/Slug.
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    rowGap: spacing[3],
  },
  // Wrapper de los 3 inputs de precio (Costo / Margen / Precio Base).
  // En mobile sigue siendo 1 col (stacked), pero el flex-row deja
  // preparado el cambio a 3 cols en pantallas más grandes.
  pricingRow: {
    flexDirection: 'column',
    gap: spacing[4],
  },
  // Header de la sección Descripción (label a la izquierda + botón IA a la derecha).
  descriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[1],
  },
  descriptionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as any,
    color: colors.text.secondary,
  },
  // Botón 'Generar con IA' (espejo simplificado del ai-generate-btn web).
  // Web tiene animación shimmer compleja; aquí se hace una versión estática
  // con los mismos colores (verde + texto blanco, borde verde semitransparente).
  aiGenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.4)',
    backgroundColor: colors.primary,
  },
  aiGenerateText: {
    fontSize: 8,
    fontWeight: '700' as any,
    color: colors.background,
    marginLeft: spacing[1],
  },
  // Helper amber (mirror web `.text-amber-600 .flex .gap-1`).
  helperAmber: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[1],
    marginTop: spacing[1],
  },

  // ── Compra Online (espejo web mobile) ──────────────────────────────────
  // Header: flex-col en mobile, sm:flex-row sm:items-start
  // sm:justify-between en md+ (mirror web).
  purchaseHeader: {
    flexDirection: 'column' as const,
    gap: spacing[3],
  },
  purchaseHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
  },
  purchaseHeaderLeft: {
    flex: 1,
  },
  purchaseTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
  },
  purchaseTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  purchaseSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  // Card dashed con empty state (mirror web
  // `rounded-xl border-dashed border-gray-200 bg-gray-50 p-4 flex
  // items-start gap-3`).
  purchaseEmpty: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderStyle: 'dashed' as const,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  purchaseEmptyIcon: {
    marginTop: 2,
  },
  purchaseEmptyTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[800],
  },
  purchaseEmptySubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
  // ── Compra Online generada (link + QR) ────────────────────────────────
  // Botón "Generar link y QR" (mirror del web
  // `border border-primary-200 bg-primary-50 text-primary-700`).
  purchaseGenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 40,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.5)',
    backgroundColor: 'rgba(126, 215, 165, 0.08)',
  },
  purchaseGenerateBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.primary,
  },
  // Card con QR + link generados.
  purchaseGenerated: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  purchaseQrImage: {
    width: 120,
    height: 120,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing[2],
  },
  purchaseGeneratedInfo: {
    flex: 1,
    gap: spacing[1],
  },
  purchaseGeneratedLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  purchaseGeneratedLink: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[800],
    fontWeight: typography.fontWeight.semibold,
  },
  purchaseGeneratedDomain: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  purchaseCopyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[2],
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    alignSelf: 'flex-start',
  },
  purchaseCopyBtnText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.primary,
  },

  // ── Restaurant Suite cards (espejo web mobile) ────────────────────────
  // Card "Unidad de medida del insumo" (aparece cuando is_ingredient=true).
  uomCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.gray[50],
    padding: spacing[4],
    gap: spacing[3],
    marginTop: spacing[1],
  },
  uomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  uomHeaderText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  uomGrid: {
    // En mobile (1 col) los 2 selectores van apilados con la flecha
    // rotada 90° entre ellos. En md+ (1fr_auto_1fr) la flecha queda
    // horizontal entre los dos selectores.
    gap: spacing[3],
    flexDirection: 'column' as const,
  },
  uomGridRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  uomArrow: {
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing[1.5],
    paddingVertical: spacing[1],
  },
  uomArrowIcon: {
    // Rotada 90° en mobile (apunta hacia abajo), sin rotar en md+
    // (apunta hacia la derecha). El sentido se invierte en el render.
  },
  uomArrowIconRotated: {
    transform: [{ rotate: '90deg' as const }],
  },
  uomArrowIconNormal: {
    transform: [{ rotate: '0deg' as const }],
  },
  uomArrowText: {
    fontSize: 11,
    color: colorScales.gray[500],
    textAlign: 'center' as const,
    lineHeight: 14,
  },
  // Card "Producido en lote" (aparece cuando is_batch_produced=true).
  batchCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.xl,
    backgroundColor: colorScales.gray[50],
    padding: spacing[4],
    // Mirror del web `flex flex-col sm:flex-row sm:items-center gap-3`.
    // Por defecto va en row (md+); en mobile se sobreescribe con
    // `batchCardColumn` (column).
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
    marginTop: spacing[1],
  },
  batchCardColumn: {
    // Override en mobile: el texto va arriba, el botón abajo.
    flexDirection: 'column' as const,
    alignItems: 'stretch' as const,
  },
  batchCardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  batchCardText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  batchCardTextBold: {
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },

  // ── Imágenes del Producto (espejo web lg:hidden) ──────────────────────────
  imageCount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  imageMainPlaceholder: {
    width: '100%',
    maxWidth: 280,
    aspectRatio: 1,
    alignSelf: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  imageMainWrapper: {
    alignItems: 'center',
  },
  imageMainFilled: {
    width: '100%',
    maxWidth: 280,
    aspectRatio: 1,
    alignSelf: 'center',
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    position: 'relative',
  },
  imageMainImg: {
    width: '100%',
    height: '100%',
  },
  imageMainDelete: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    padding: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
    borderRadius: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMainAiBtn: {
    position: 'absolute',
    bottom: spacing[2],
    left: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.35)',
    backgroundColor: 'rgba(126, 215, 165, 0.9)',
    shadowColor: '#7ED7A5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  imageMainAiBtnText: {
    fontSize: 11,
    fontWeight: '700' as any,
    lineHeight: 12,
    color: colors.background,
  },
  imageMainCropBtn: {
    position: 'absolute',
    bottom: spacing[2],
    right: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  imageMainCropBtnText: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  imageMainCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
    marginBottom: spacing[2],
  },
  imageMainText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as any,
    color: colorScales.gray[600],
  },
  imageMainHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  imageThumbsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingBottom: spacing[2],
    // Scroll horizontal para que las 5 miniaturas + botón "+ Agregar"
    // quepan sin recortarse en pantallas angostas. Sin esto, el botón
    // de agregar queda fuera de pantalla a partir de 3 miniaturas y
    // el usuario no puede seguir agregando.
    flexGrow: 0,
  },
  imageThumbsScroll: {
    flexGrow: 0,
  },
  imageThumbAdd: {
    flexShrink: 0,
    width: 64,
    height: 64,
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing[0.5],
  },
  imageThumbAddText: {
    fontSize: 9,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  imageThumb: {
    flexShrink: 0,
    width: 64,
    height: 64,
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    overflow: 'hidden',
    position: 'relative',
  },
  imageThumbActive: {
    // Mirror web: ring-2 ring-primary-500 sobre la miniatura principal.
    borderWidth: 2,
    borderColor: colors.primary,
    // Sombra verde para reforzar el "anillo" (RN no soporta `box-shadow`
    // con color independiente del shadowColor del padre).
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  imageThumbImg: {
    width: '100%',
    height: '100%',
  },
  imageThumbText: {
    fontSize: 9,
    color: colors.primary,
    fontWeight: '600' as any,
    marginTop: 2,
    maxWidth: 56,
  },

  // ── Inventario / Stock (espejo web lg:hidden) ────────────────────────────
  inventoryStatsGrid: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  inventoryStatCard: {
    flex: 1,
    padding: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  inventoryStatLabel: {
    fontSize: 9,
    color: colors.text.muted,
    fontWeight: '700' as any,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[1],
  },
  inventoryStatValue: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700' as any,
    color: colors.text.primary,
  },
  inventoryStatValuePrimary: {
    color: colors.primary,
  },
  inventoryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.3)',
  },
  inventoryActionText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700' as any,
    color: colorScales.green[700],
  },
  // Fila 1: 2 botones (Inventario outline + Ajustar primary filled)
  inventoryActionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  inventoryActionOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.3)',
  },
  inventoryActionOutlineText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700' as any,
    color: colorScales.green[700],
  },
  inventoryActionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  inventoryActionPrimaryText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700' as any,
    color: colors.background,
  },

  // ── Promociones & Operaciones (espejo web mobile) ──────────────────
  // Header de la sección.
  promotionsHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
  },
  promotionsTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  promotionsTitleMuted: {
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[400],
  },
  // Body de promociones.
  promotionsBody: {
    gap: spacing[2],
  },
  promotionsDescription: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  // Separator + sub-sección Operaciones.
  operationsDivider: {
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    gap: spacing[2],
  },
  operationsHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
  },
  operationsTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },

  // Fila 2: Ver detalle completo (link primary)
  inventoryLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  inventoryLinkButtonText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '500' as any,
    color: colors.primary,
  },

  // ── Números de serie (espejo web lg:hidden) ───────────────────────
  serialHeader: {
    flexDirection: 'column' as const,
    gap: spacing[3],
  },
  serialHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
  },
  serialHeaderLeft: {
    flex: 1,
  },
  serialTitleRow: {
    flexDirection: 'row' as const,
    // `flex items-start` web — el icono (18px) se alinea con el top del
    // bloque título+subtítulo, igual que el original.
    alignItems: 'flex-start' as const,
    gap: spacing[2],
  },
  // hash icon alignment (mirror de `mt-0.5` web)
  serialTitleIcon: {
    marginTop: 2,
  },
  serialTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  serialSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  serialStatsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    rowGap: spacing[3],
    columnGap: spacing[3],
  },
  // 2 cols en mobile (`grid-cols-2`) — pasamos a flexBasis '23%' en md+
  // para replicar `sm:grid-cols-4` cuando el viewport lo permita. El
  // 23% (en lugar de 25%) reserva aprox. 36px para `columnGap` de 12×3.
  serialStatCell: {
    flexBasis: '48%' as const,
    flexGrow: 1,
  },
  serialStatCellMd: {
    flexBasis: '23%' as const,
  },
  serialStatLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as const,
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  serialStatValuePrimary: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  // `text-primary-700` web → green-700 sólido (no rgba alpha) para
  // mantener contraste y consistencia con `--color-primary: #2ecc71`.
  serialStatValuePrimary700: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  // Color base muted; se sobreescribe a ámbar en runtime cuando
  // `warranty_expiring_soon > 0` para replicar
  // `[class.text-amber-600]="… > 0"` del web.
  serialStatValueMuted: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
  },
  serialStatValueAmber: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.amber[600],
  },
});
