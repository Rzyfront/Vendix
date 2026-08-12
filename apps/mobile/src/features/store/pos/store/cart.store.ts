import { create } from 'zustand';
import type {
  CartItem,
  CartDiscount,
  CartSummary,
  CartState,
  PosCustomer,
  PosMode,
  Product,
  ProductVariant,
} from '@/features/store/types';
import {
  resolveLineTotal,
  resolvePriceUnitQuantity,
  resolveStockUnitsConsumed,
  type SaleUnitPresentation,
} from '@/features/store/pricing';

interface CustomItemData {
  name: string;
  description?: string;
  quantity: number;
  price: number;
  taxRate?: number;
}

/**
 * Unidad de captura de una línea (QUI-648 fase 2). La resuelve
 * `resolveSaleUnitConfig` a partir de `stock_uom_id` × `price_unit_quantity`;
 * acá solo se persiste para que el carrito y el tiquete muestren la cantidad en
 * la misma escala en la que se capturó.
 */
export interface CapturedSaleUnit {
  code: string;
  unitsPerCapture: number;
}

interface CartActions {
  /**
   * Agrega una línea al carrito.
   *
   * @param presentation Presentación de venta (`price_tiers.kind='sale_unit'`)
   *   ya resuelta con `resolveSaleUnitPresentations`. Cuando llega, `quantity`
   *   cuenta PAQUETES, el precio de la línea es el del paquete completo y el
   *   inventario descontará `quantity × packSize`. Sin ella el comportamiento
   *   es exactamente el histórico.
   */
  /**
   * @param saleUnit Unidad en la que el CAJERO capturó `quantity` (QUI-648
   *   fase 2). `quantity` llega SIEMPRE ya convertida a unidades mínimas: esto
   *   solo anota en qué escala volver a leerla para mostrarla ("3 m" en vez de
   *   "3000"). Omitirla deja la línea exactamente como antes de esta fase.
   */
  addItem: (
    product: Product,
    variant?: ProductVariant | null,
    quantity?: number,
    presentation?: SaleUnitPresentation | null,
    saleUnit?: CapturedSaleUnit | null,
  ) => void;
  addCustomItem: (custom: CustomItemData) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  /**
   * Cambia (o quita, con `null`) la presentación de una línea ya en el
   * carrito. Recalcula precio, total y consumo de stock con las mismas reglas
   * que `addItem`.
   */
  applyPresentation: (itemId: string, presentation: SaleUnitPresentation | null) => void;
  setCustomer: (customer: PosCustomer | null) => void;
  setNotes: (notes: string) => void;
  setMode: (mode: PosMode) => void;
  applyDiscount: (type: 'percentage' | 'fixed', value: number, description: string) => void;
  removeDiscount: (discountId: string) => void;
  /**
   * Marca el carrito como borrador persistido localmente. La conversión a
   * `order_draft` real se hace vía el servicio POS al confirmar.
   */
  markAsDraft: (draftId: string) => void;
  clearDraft: () => void;
  clearCart: () => void;
  getSummary: () => CartSummary;
}

const initialState: CartState = {
  items: [],
  customer: null,
  notes: '',
  discounts: [],
  summary: { subtotal: 0, taxAmount: 0, discountAmount: 0, total: 0, itemCount: 0, totalItems: 0 },
  mode: 'sale',
  draftId: null,
};

function generateItemId(): string {
  return 'ITEM_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getTaxRateSum(product: Product): number {
  if (!product.product_tax_assignments || product.product_tax_assignments.length === 0) return 0;
  let total = 0;
  for (const assignment of product.product_tax_assignments) {
    const taxCategory = assignment.tax_category ?? (assignment as any).tax_categories;
    if (taxCategory?.tax_rates) {
      for (const rate of taxCategory.tax_rates) {
        total += rate.rate;
      }
    }
  }
  return total;
}

/**
 * QUI-521 — ¿el precio del producto ya trae el IVA adentro?
 *
 * ⚠️ Hoy esto devuelve siempre `false`: ni `tax_included` ni
 * `price_includes_tax` existen como campo de producto en ningún punto del
 * stack (no están en `schema.prisma`, ni en el backend, ni en el tipo
 * `Product` de mobile). El flag real vive en el setting de tienda
 * `GeneralSettings.tax_included` (`types/settings.types.ts:15`), y mobile
 * todavía no tiene un store de settings desde donde leerlo.
 *
 * O sea: QUI-521 sigue abierto. Para cerrarlo hay que exponer el setting al
 * carrito, no leerlo del producto. Se deja la función porque el resto del
 * cálculo ya quedó correcto para cuando el flag esté disponible.
 */
function isPriceTaxInclusive(product: Product): boolean {
  return Boolean(
    (product as Product & { tax_included?: boolean }).tax_included ||
      (product as Product & { price_includes_tax?: boolean }).price_includes_tax,
  );
}

/**
 * Escala de precio EFECTIVA de una línea.
 *
 * Una línea con presentación aplicada NO usa `price_unit_quantity`: ahí
 * `unitPrice` ya es el precio del paquete completo y `quantity` cuenta
 * paquetes, así que dividir otra vez cobraría de menos. Es exactamente la
 * exclusión que el backend expresa con `options.hasTierAtIndex` en
 * `normalizePriceUnitLines`.
 */
function getEffectivePriceUnitQuantity(item: {
  priceUnitQuantity?: number | null;
  appliedPriceTierId?: number | null;
}): number {
  if (item.appliedPriceTierId != null) return 1;
  return resolvePriceUnitQuantity(item.priceUnitQuantity);
}

/**
 * Subtotal NETO de una línea (sin impuesto cuando el precio es tax-exclusive).
 *
 * Es el reemplazo de `unitPrice × quantity`: aplica la escala del producto y
 * redondea a centavos UNA sola vez, al final. Con `price_unit_quantity = 1`
 * —todo el catálogo histórico— y `quantity` entera devuelve exactamente
 * `unitPrice × quantity`: cero regresión.
 */
export function getLineSubtotal(item: CartItem): number {
  return resolveLineTotal(
    item.unitPrice,
    item.quantity,
    getEffectivePriceUnitQuantity(item),
  );
}

/**
 * Impuesto y precio final de una línea.
 *
 * Con precio tax-exclusive el impuesto se suma encima. Con precio
 * tax-inclusive el impuesto ya está adentro, así que hay que EXTRAERLO
 * (`p * rate / (1 + rate)`), no ponerlo en 0: `summary.taxAmount` se manda al
 * backend como `tax_amount` al crear la orden (`pos-payment-modal.tsx`,
 * `shipping-modal.tsx`) y se imprime como "IVA" en el footer, así que un
 * 0 acá declara una venta gravada con IVA cero.
 *
 * El impuesto se calcula sobre el subtotal YA escalado, nunca sobre
 * `unitPrice × quantity`: la base gravable de 2.500 mm de cable a $5.000/m son
 * $12.500, no $12.500.000.
 */
function computeLineAmounts(
  unitPrice: number,
  quantity: number,
  priceUnitQuantity: number,
  rateSum: number,
  inclusive: boolean,
): { taxAmount: number; finalPrice: number; totalPrice: number } {
  const lineSubtotal = resolveLineTotal(unitPrice, quantity, priceUnitQuantity);
  if (!inclusive) {
    const taxAmount = lineSubtotal * rateSum;
    return {
      taxAmount,
      finalPrice: unitPrice * (1 + rateSum),
      totalPrice: lineSubtotal + taxAmount,
    };
  }
  return {
    taxAmount: (lineSubtotal * rateSum) / (1 + rateSum),
    finalPrice: unitPrice,
    totalPrice: lineSubtotal,
  };
}

function getSellableUnitPrice(product: Product, variant?: ProductVariant | null): number {
  if (variant?.is_on_sale && variant.sale_price != null) return Number(variant.sale_price) || 0;
  if (variant?.price_override != null) return Number(variant.price_override) || 0;
  if (product.is_on_sale && product.sale_price != null) return Number(product.sale_price) || 0;
  return Number(product.base_price) || 0;
}

/**
 * Campos de presentación de una línea. Con `presentation` nula quedan todos
 * apagados y la línea vuelve a la aritmética por unidad de stock.
 */
function buildPresentationFields(
  quantity: number,
  presentation?: SaleUnitPresentation | null,
): Pick<
  CartItem,
  'appliedPriceTierId' | 'appliedPriceTierName' | 'isPackageUnit' | 'unitsPerPackage' | 'stockUnitsConsumed'
> {
  if (!presentation) {
    return {
      appliedPriceTierId: null,
      appliedPriceTierName: null,
      isPackageUnit: false,
      unitsPerPackage: null,
      stockUnitsConsumed: null,
    };
  }
  const packSize = presentation.packSize;
  return {
    appliedPriceTierId: presentation.tierId,
    appliedPriceTierName: presentation.name,
    isPackageUnit: packSize > 1,
    unitsPerPackage: packSize > 1 ? packSize : null,
    stockUnitsConsumed: resolveStockUnitsConsumed(quantity, packSize),
  };
}

/**
 * Escala de captura de una línea. Solo se anota cuando hay conversión REAL
 * (metros sobre milímetros): si la unidad de venta ya es la mínima, la línea se
 * lee como siempre y ninguna superficie cambia.
 *
 * Con presentación aplicada los campos quedan apagados a propósito: ahí
 * `quantity` cuenta PAQUETES, así que la escala de la unidad mínima no aplica —
 * la misma exclusión que hace el web al aplicar una tarifa.
 */
function buildSaleUnitFields(
  saleUnit?: CapturedSaleUnit | null,
  presentation?: SaleUnitPresentation | null,
): Pick<CartItem, 'saleUnitCode' | 'stockUnitsPerSaleUnit'> {
  const captured =
    !presentation && !!saleUnit && Number(saleUnit.unitsPerCapture) > 1;
  return {
    saleUnitCode: captured ? saleUnit!.code : null,
    stockUnitsPerSaleUnit: captured ? Number(saleUnit!.unitsPerCapture) : null,
  };
}

function buildCartItem(
  product: Product,
  variant?: ProductVariant | null,
  quantity: number = 1,
  presentation?: SaleUnitPresentation | null,
  saleUnit?: CapturedSaleUnit | null,
): CartItem {
  // Con presentación el precio de la línea es el del PAQUETE completo, ya
  // resuelto por `resolveSaleUnitPresentations` (override explícito o regla de
  // descuento sobre el precio por unidad de stock).
  const unitPrice = presentation
    ? presentation.unitPrice
    : getSellableUnitPrice(product, variant);
  const priceUnitQuantity = presentation
    ? 1
    : resolvePriceUnitQuantity(product.price_unit_quantity);
  const rateSum = getTaxRateSum(product);
  const { taxAmount, finalPrice, totalPrice } = computeLineAmounts(
    unitPrice,
    quantity,
    priceUnitQuantity,
    rateSum,
    isPriceTaxInclusive(product),
  );
  const variant_display_name = variant?.name || variant?.attributes || undefined;

  return {
    id: generateItemId(),
    product,
    variant: variant ?? null,
    quantity,
    unitPrice,
    finalPrice,
    totalPrice,
    taxAmount,
    variant_display_name,
    priceUnitQuantity: resolvePriceUnitQuantity(product.price_unit_quantity),
    ...buildPresentationFields(quantity, presentation),
    ...buildSaleUnitFields(saleUnit, presentation),
  };
}

function recalcItem(item: CartItem): CartItem {
  const rateSum = getTaxRateSum(item.product);
  // Una línea con presentación conserva el precio del paquete que resolvió al
  // agregarse; sin presentación se re-lee la cascada del producto/variante.
  const unitPrice =
    item.appliedPriceTierId != null
      ? item.unitPrice
      : getSellableUnitPrice(item.product, item.variant);
  const { taxAmount, finalPrice, totalPrice } = computeLineAmounts(
    unitPrice,
    item.quantity,
    getEffectivePriceUnitQuantity(item),
    rateSum,
    isPriceTaxInclusive(item.product),
  );
  return {
    ...item,
    unitPrice,
    taxAmount,
    finalPrice,
    totalPrice,
    stockUnitsConsumed: resolveStockUnitsConsumed(
      item.quantity,
      item.unitsPerPackage,
    ),
  };
}

function computeSummary(items: CartItem[], discounts: CartDiscount[]): CartSummary {
  const subtotal = items.reduce((sum, i) => sum + getLineSubtotal(i), 0);
  const taxAmount = items.reduce((sum, i) => sum + i.taxAmount, 0);
  const discountAmount = discounts.reduce((sum, d) => sum + d.amount, 0);
  const total = subtotal + taxAmount - discountAmount;
  const itemCount = items.length;
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  return { subtotal, taxAmount, discountAmount, total, itemCount, totalItems };
}

export const useCartStore = create<CartState & CartActions>()((set, get) => ({
  ...initialState,

  addItem: (product, variant, quantity = 1, presentation = null, saleUnit = null) => {
    const { items } = get();
    // La presentación participa de la IDENTIDAD de la línea: 2 bultos y 3 kilos
    // del mismo producto son DOS líneas, no una de 5. Fusionarlas perdería el
    // packSize de una de las dos y el inventario descontaría de menos.
    const tierId = presentation?.tierId ?? null;
    const existing = items.find(
      (i) =>
        i.product.id === product.id &&
        (i.variant?.id ?? null) === (variant?.id ?? null) &&
        (i.appliedPriceTierId ?? null) === tierId,
    );

    if (existing) {
      const updated = items.map((i) =>
        i.id === existing.id ? recalcItem({ ...i, quantity: i.quantity + quantity }) : i,
      );
      const summary = computeSummary(updated, get().discounts);
      set({ items: updated, summary });
    } else {
      const newItem = buildCartItem(product, variant, quantity, presentation, saleUnit);
      const updated = [...items, newItem];
      const summary = computeSummary(updated, get().discounts);
      set({ items: updated, summary });
    }
  },

  applyPresentation: (itemId, presentation) => {
    const { items, discounts } = get();
    const target = items.find((i) => i.id === itemId);
    if (!target || target.itemType === 'custom') return;

    const unitPrice = presentation
      ? presentation.unitPrice
      : getSellableUnitPrice(target.product, target.variant);

    // Una línea capturada en unidad de venta guarda milímetros o gramos, no
    // paquetes: al ponerle una presentación hay que CONVERTIR la magnitud, o
    // "3 m" se volverían "3 rollos". Espejo de `pos-cart.service.ts` del web.
    // La conversión se limita a esas líneas — ninguna línea por pieza cambia.
    const capturedInSaleUnit = Number(target.stockUnitsPerSaleUnit ?? 1) > 1;
    const nextPackSize = presentation ? presentation.packSize : 1;
    const quantity =
      capturedInSaleUnit && nextPackSize > 1
        ? Math.max(1, Math.round(target.quantity / nextPackSize))
        : target.quantity;

    const next = recalcItem({
      ...target,
      quantity,
      unitPrice,
      ...buildPresentationFields(quantity, presentation),
      // Con presentación la escala de captura deja de aplicar; al quitarla la
      // línea vuelve a unidades mínimas pero sin unidad de captura anotada:
      // recuperarla exigiría el catálogo de unidades, que este store no ve.
      ...buildSaleUnitFields(
        capturedInSaleUnit
          ? {
              code: target.saleUnitCode ?? '',
              unitsPerCapture: Number(target.stockUnitsPerSaleUnit),
            }
          : null,
        presentation,
      ),
    });
    const updated = items.map((i) => (i.id === itemId ? next : i));
    set({ items: updated, summary: computeSummary(updated, discounts) });
  },

  addCustomItem: (custom) => {
    const { items, discounts } = get();
    // Un ítem libre nunca tiene escala ni presentación: su precio es el que el
    // cajero tipeó, por unidad. Pasa por el mismo helper para que el redondeo
    // del total sea el mismo que el de una línea de catálogo.
    const { taxAmount, finalPrice, totalPrice } = computeLineAmounts(
      custom.price,
      custom.quantity,
      1,
      custom.taxRate ?? 0,
      false,
    );
    const newItem: CartItem = {
      id: generateItemId(),
      product: {
        id: 0,
        store_id: 0,
        name: custom.name,
        slug: 'custom-' + Date.now(),
        description: custom.description ?? null,
        base_price: custom.price,
        state: 'active',
        final_price: finalPrice,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        track_inventory: false,
        pricing_type: 'unit',
        product_type: 'service',
        is_on_sale: false,
        sale_price: null,
        cost_price: null,
        profit_margin: null,
        available_for_ecommerce: false,
        sku: null,
        stock_quantity: null,
        weight: null,
        service_duration_minutes: null,
        service_modality: null,
        requires_booking: false,
        image_url: 'custom',
        brand: null,
        categories: [],
        product_variants: [],
        product_images: [],
        tax_assignments: custom.taxRate
          ? [{ id: 0, tax_category: { id: 0, name: '', tax_rates: [{ id: 0, rate: custom.taxRate }] } } as any]
          : [],
        total_stock_available: 0,
      } as Product,
      variant: null,
      quantity: custom.quantity,
      unitPrice: custom.price,
      finalPrice,
      totalPrice,
      taxAmount: taxAmount,
      variant_display_name: custom.description || undefined,
      itemType: 'custom',
      priceUnitQuantity: 1,
      ...buildPresentationFields(custom.quantity, null),
    };
    const updated = [...items, newItem];
    const summary = computeSummary(updated, discounts);
    set({ items: updated, summary });
  },

  removeItem: (itemId) => {
    const items = get().items.filter((i) => i.id !== itemId);
    const summary = computeSummary(items, get().discounts);
    set({ items, summary });
  },

  updateQuantity: (itemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(itemId);
      return;
    }
    const items = get().items.map((i) => (i.id === itemId ? recalcItem({ ...i, quantity }) : i));
    const summary = computeSummary(items, get().discounts);
    set({ items, summary });
  },

  setCustomer: (customer) => set({ customer }),

  setNotes: (notes) => set({ notes }),

  setMode: (mode) => set({ mode }),

  applyDiscount: (type, value, description) => {
    const { items, discounts } = get();
    const subtotal = items.reduce((sum, i) => sum + getLineSubtotal(i), 0);
    const taxAmount = items.reduce((sum, i) => sum + i.taxAmount, 0);
    const preDiscountTotal = subtotal + taxAmount;
    const amount = type === 'percentage' ? (value / 100) * preDiscountTotal : value;
    const newDiscount: CartDiscount = {
      id: 'DISC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      type,
      value,
      description,
      amount,
    };
    const updated = [...discounts, newDiscount];
    const summary = computeSummary(items, updated);
    set({ discounts: updated, summary });
  },

  removeDiscount: (discountId) => {
    const discounts = get().discounts.filter((d) => d.id !== discountId);
    const summary = computeSummary(get().items, discounts);
    set({ discounts, summary });
  },

  clearCart: () => set({ ...initialState, summary: { ...initialState.summary } }),

  markAsDraft: (draftId) => set({ draftId }),

  clearDraft: () => set({ draftId: null }),

  getSummary: () => get().summary,
}));
