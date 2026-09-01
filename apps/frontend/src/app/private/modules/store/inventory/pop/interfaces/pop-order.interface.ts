/**
 * POP (Point of Purchase) Order Models
 * Models for creating and submitting purchase orders
 */

import { PopCartState, PopCartItem, LotInfo, PreBulkData } from './pop-cart.interface';
import { ApiResponse } from '../../interfaces';


import { PurchaseOrder, PurchaseOrderItem } from '../../interfaces';

export type PurchaseOrderResponse = PurchaseOrder;
export type PurchaseOrderItemResponse = PurchaseOrderItem;

/**
 * Purchase order item for API request
 */
export interface PurchaseOrderItemRequest {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  /**
   * Descuento comercial de la línea en DINERO (base neta). GANA sobre
   * `discount_percentage` en el backend: `PurchaseOrdersService.deriveLineTax`
   * usa `discount_amount` cuando es > 0 y sólo entonces cae al porcentaje.
   * La columna `purchase_order_items.discount_amount` ya existe, así que la
   * cifra que imprimió la factura se persiste sin degradarse.
   */
  discount_amount?: number;
  /** IVA cycle (F1): tax rate (%) captured manually for this line. */
  tax_rate?: number;
  /** IVA cycle (F1): tax classification for this line. Defaults to 'iva'. */
  tax_type?: string;
  /**
   * IVA cycle (F1): per-line override of the header `prices_include_tax`
   * mode (mixed invoices). When present it inverts/overrides the header for
   * this line; when omitted the line inherits the header mode.
   */
  prices_include_tax?: boolean;
  notes?: string;
  // Batch/lot tracking fields
  batch_number?: string;
  manufacturing_date?: string;
  expiration_date?: string;
  // New fields for prebulk items
  product_name?: string;
  sku?: string;
  barcode?: string;
  product_description?: string;
  product_type?: string;
  track_inventory?: boolean;
  pricing_type?: string;
  tax_category_ids?: number[];
  state?: string;
  weight?: number;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  has_multiple_price_tiers?: boolean;
  // Packaging is tier-owned now (price tier / per-product override), not a
  // product field. Removed from the purchase-order item request.
  base_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  brand_name?: string;
  category_names?: string;
  /**
   * Fase 3: UoM FKs. The receiving engine uses these to derive
   * `purchase_to_stock_factor`. Required when the parent PO has
   * `order_type='ingredient'`; ignored otherwise.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * Insumos desde compra: clasificación del producto nuevo (prebulk). El
   * backend crea el producto con `is_ingredient`/`is_sellable` y, junto con
   * las UoM, lo deja listo para consumo en recetas.
   */
  is_ingredient?: boolean;
  is_sellable?: boolean;

}

/**
 * Complete purchase order creation request
 */
export interface CreatePurchaseOrderRequest {
  organization_id?: number;
  supplier_id: number;
  location_id: number;
  // A.10 — `status` NO forma parte del payload de creación. El cliente no
  // elige con qué estado nace una orden: el backend la crea en borrador y la
  // aprobación es una acción aparte, con su permiso y su rastro. Declararlo
  // aquí invitaba a volver a mandarlo (y con `forbidNonWhitelisted` en el DTO,
  // eso es un 400 en cada creación).
  /**
   * IVA cycle (F1): dominant invoice mode. `true` when captured prices
   * already INCLUDE tax; `false` when tax is ADDED on top. Per-item
   * `prices_include_tax` overrides this for mixed invoices.
   */
  prices_include_tax?: boolean;
  order_date?: string;
  expected_date?: string;
  payment_terms?: string;
  shipping_method?: string;
  shipping_cost?: number;
  /**
   * C.5 — cómo se imputa el flete: `prorate` lo reparte entre las líneas y lo
   * capitaliza al costo del inventario; `expense` lo deja como costo de la
   * orden y no mueve el costo unitario. En los dos casos suma al total.
   *
   * El backend RECHAZA con 400 un `shipping_cost > 0` sin este campo, y también
   * un `prorate` sin flete. Por eso viaja SÓLO cuando hay flete.
   */
  shipping_cost_allocation?: 'prorate' | 'expense';
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  discount_amount?: number;
  notes?: string;
  internal_notes?: string;
  created_by_user_id?: number;
  items: PurchaseOrderItemRequest[];
  /**
   * Fase 2: primary order type. Defaults to `retail`. When any line in
   * the cart carries a product that is a pure ingredient, the cart
   * service sets this to `ingredient`. Mixed-line orders (retail +
   * ingredient in the same PO) are out of scope for V1 and will be
   * rejected by the backend.
   */
  order_type?: 'retail' | 'ingredient';

}

/**
 * Convert cart state to create purchase order request
 */
export function cartToPurchaseOrderRequest(
  cartState: PopCartState,
  userId: number,
  organizationId?: number,
): CreatePurchaseOrderRequest {
  const items: PurchaseOrderItemRequest[] = cartState.items.map(
    (item: PopCartItem) => {
      const requestItem: PurchaseOrderItemRequest = {
        product_id: item.product.id,
        product_variant_id: item.variant?.id,
        quantity: item.quantity,
        unit_price: item.unit_cost,
        // IVA cycle (F1): forward the manually-captured tax per line, GATED by
        // the POP header master switch `cartState.has_vat`. When the buyer
        // marks the purchase as WITHOUT VAT, we must persist tax_rate = 0 so
        // the persisted order matches the $0 IVA preview (pop-cart.service
        // computes taxRate = hasVat ? item.tax_rate : 0). Without this gate the
        // seeded default rate (19) would leak to the backend and contaminate
        // cost/deductible-IVA. `prices_include_tax` per-line override is only
        // meaningful when VAT is on (mixed invoices).
        tax_rate: cartState.has_vat ? item.tax_rate : 0,
        tax_type: item.tax_type ?? 'iva',
        // QUI-661: descuento comercial de la línea. No se manda un precio ya
        // rebajado: el descuento tiene que ser visible como tal para que llegue
        // a la capa de costo y no se confunda con un precio negociado.
        //
        // Se envían AMBAS cifras a propósito y el backend resuelve la
        // precedencia (`deriveLineTax`: `discount_amount > 0` gana sobre
        // `discount_percentage`). El MONTO es la fuente de verdad —lo que
        // imprimió la factura— y el PORCENTAJE viaja como procedencia de la
        // captura manual. Sólo una de las dos tiene valor a la vez: el carrito
        // limpia el monto al teclear un porcentaje y pone el porcentaje en 0 al
        // fijar un monto.
        ...(Number(item.discount) > 0
          ? { discount_percentage: Number(item.discount) }
          : {}),
        ...(Number(item.discount_amount) > 0
          ? { discount_amount: Number(item.discount_amount) }
          : {}),
        ...(cartState.has_vat && item.prices_include_tax !== undefined
          ? { prices_include_tax: item.prices_include_tax }
          : {}),
        notes: item.notes,
        // Fase 3: UoM FKs. The cart stores the FKs chosen in the modal
        // (defaults to the product's persisted UoMs in ingredient mode).
        // We pass them through as-is. If the parent PO is `retail`, the
        // backend will null them out at the DB level.
        purchase_uom_id: (item as any).purchase_uom_id ?? null,
        stock_uom_id: (item as any).stock_uom_id ?? null,
        // Map lot/batch info
        batch_number: item.lot_info?.batch_number,
        manufacturing_date: item.lot_info?.manufacturing_date
          ? new Date(item.lot_info.manufacturing_date).toISOString()
          : undefined,
        expiration_date: item.lot_info?.expiration_date
          ? new Date(item.lot_info.expiration_date).toISOString()
          : undefined,
      };

      if (item.is_prebulk && item.prebulk_data) {
        requestItem.product_name = item.prebulk_data.name;
        requestItem.sku = item.prebulk_data.code;
        requestItem.barcode = item.prebulk_data.barcode;
        requestItem.product_description = item.prebulk_data.description;
        requestItem.product_type = item.prebulk_data.product_type;
        requestItem.track_inventory = item.prebulk_data.track_inventory;
        requestItem.pricing_type = item.prebulk_data.pricing_type;
        requestItem.tax_category_ids = item.prebulk_data.tax_category_ids;
        requestItem.state = item.prebulk_data.state;
        requestItem.weight = item.prebulk_data.weight;
        requestItem.available_for_ecommerce = item.prebulk_data.available_for_ecommerce;
        requestItem.is_featured = item.prebulk_data.is_featured;
        requestItem.allow_pos_price_override = item.prebulk_data.allow_pos_price_override;
        requestItem.has_multiple_price_tiers = item.prebulk_data.has_multiple_price_tiers;
        requestItem.base_price = item.prebulk_data.base_price;
        requestItem.profit_margin = item.prebulk_data.profit_margin;
        requestItem.is_on_sale = item.prebulk_data.is_on_sale;
        requestItem.sale_price = item.prebulk_data.sale_price;
        requestItem.brand_name = typeof item.prebulk_data.brand_id === 'string' ? item.prebulk_data.brand_id : undefined;
        requestItem.category_names = typeof item.prebulk_data.category_ids === 'string' ? item.prebulk_data.category_ids : undefined;
        // Insumos desde compra: propaga la clasificación y, si es insumo, las
        // UoM elegidas en el modal prebulk. El backend crea el producto con
        // estos flags y deriva el factor de conversión al recibir.
        requestItem.is_ingredient = item.prebulk_data.is_ingredient;
        requestItem.is_sellable = item.prebulk_data.is_sellable;
        if (item.prebulk_data.is_ingredient) {
          requestItem.purchase_uom_id =
            item.prebulk_data.purchase_uom_id ?? requestItem.purchase_uom_id ?? null;
          requestItem.stock_uom_id =
            item.prebulk_data.stock_uom_id ?? requestItem.stock_uom_id ?? null;
        }
      }

      return requestItem;
    },
  );

  // Fase 2: infer order_type from the cart items. Mixed-line is out
  // of scope; if any item is a pure ingredient, the whole order is
  // `ingredient`. Otherwise `retail` (default).
  const isIngredientOrder = cartState.items.some((it: any) => {
    // Caso prebulk (producto nuevo): la clasificación vive en prebulk_data,
    // no en product (que es un dummy con id=0). Tiene prioridad.
    if (it.is_prebulk && it.prebulk_data) {
      const pb: any = it.prebulk_data;
      const pbSellable =
        pb.is_sellable === undefined || pb.is_sellable === null
          ? true
          : !!pb.is_sellable;
      return !!pb.is_ingredient && !pbSellable;
    }
    const p: any = it.product;
    if (!p) return false;
    const sellable =
      p.is_sellable === undefined || p.is_sellable === null
        ? true
        : !!p.is_sellable;
    return !!p.is_ingredient && !sellable;
  });

  // Flete saneado a 2 decimales: la columna es `Decimal(12,2)` y el DTO
  // rechaza un tercer decimal con 400.
  const rawShipping = Number(cartState.shippingCost);
  const shippingCost =
    Number.isFinite(rawShipping) && rawShipping > 0
      ? Math.round(rawShipping * 100) / 100
      : 0;

  // IVA cycle (F1): modo dominante de la factura, GATEADO por el maestro
  // `has_vat` Y por que exista al menos una línea gravada.
  const headerPricesIncludeTax =
    cartState.has_vat &&
    !!cartState.prices_include_tax &&
    items.some((it) => Number(it.tax_rate) > 0);

  return {
    organization_id: organizationId,
    supplier_id: cartState.supplierId!,
    location_id: cartState.locationId!,
    // A.10 — el estado NO viaja en el payload. El backend escribía tal cual el
    // `status` que llegara, así que una orden podía NACER APROBADA a petición
    // del navegador y saltarse el permiso de aprobación
    // (`store:orders:purchase_orders:approve`). La orden nace en `draft` por
    // defecto de la columna y quien la aprueba es la ACCIÓN de aprobar, que sí
    // pasa por el permiso y deja rastro (`approved_by_user_id` + auditoría).
    // IVA cycle (F1): dominant invoice mode captured in the POP header, GATED
    // by the master switch `cartState.has_vat`. When the purchase has no VAT,
    // force `false` so the header cannot reintroduce tax-inclusive semantics
    // that the $0 IVA preview never showed.
    // El validador cruzado del backend rechaza «precios con IVA incluido» sin
    // una sola línea gravada: es una cabecera que se contradice. Se exige aquí
    // el mismo `some(tax_rate > 0)` para no mandar una combinación que la
    // pantalla nunca mostró y que vuelve como un 400 sin campo señalado.
    prices_include_tax: headerPricesIncludeTax,
    order_type: isIngredientOrder ? 'ingredient' : 'retail',
    order_date: cartState.orderDate.toISOString(),
    expected_date: cartState.expectedDate?.toISOString(),
    payment_terms: cartState.paymentTerms,
    shipping_method: cartState.shippingMethod,
    shipping_cost: shippingCost,
    // Sólo con flete: `prorate` sin monto también es 400.
    ...(shippingCost > 0
      ? {
          shipping_cost_allocation:
            cartState.shippingCostAllocation ?? 'prorate',
        }
      : {}),
    // QUI-661: descuento general de la factura. El backend lo prorratea por
    // línea; acá sólo viaja el monto que el proveedor rebajó sobre el total.
    discount_amount: cartState.discountAmount || 0,
    subtotal_amount: cartState.summary.subtotal,
    tax_amount: cartState.summary.tax_amount,
    total_amount: cartState.summary.total,
    notes: cartState.notes,
    internal_notes: cartState.internalNotes,
    created_by_user_id: userId,
    items,
  };
}

/**
 * Save draft request (minimal validation)
 */
export interface SaveDraftRequest {
  supplier_id: number;
  location_id: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  internal_notes?: string;
  items: Array<{
    product_id: number;
    quantity_ordered: number;
    unit_cost: number;
  }>;
}
