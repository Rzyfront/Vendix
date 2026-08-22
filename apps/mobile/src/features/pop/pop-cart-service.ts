import { useState, useCallback, useMemo } from 'react';
import type {
  PopCartState,
  PopCartItem,
  AddToPopCartRequest,
  UpdatePopCartItemRequest,
  ShippingMethod,
  PopOrderStatus,
  PopShippingAllocation,
} from './types';
import type { PurchaseOrder } from '../store/types/inventory.types';
import { INITIAL_CART_SUMMARY, recalcItem, calcSummary, itemKey, defaultUnitCost } from './constants';

/**
 * YYYY-MM-DD en hora local del dispositivo. A diferencia de
 * `new Date().toISOString().slice(0,10)` que produce la fecha UTC (y puede
 * quedar desfasada por un día en zonas horarias negativas como Colombia UTC-5),
 * esta helper respeta el calendario que el usuario ve en el picker.
 */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * C.5 — modo de imputación del flete de una orden ya persistida.
 *
 * `PurchaseOrder` (tipo compartido de inventario) todavía no declara la
 * columna, así que se lee por índice sobre un `Record<string, unknown>` en vez
 * de por `as any`: el acceso queda tipado y el valor se valida contra la unión
 * antes de entrar al estado.
 */
function shippingAllocationOf(order: PurchaseOrder): PopShippingAllocation | undefined {
  if (!(Number(order.shipping_cost) > 0)) return undefined;
  const raw = (order as unknown as Record<string, unknown>)['shipping_cost_allocation'];
  return raw === 'expense' ? 'expense' : 'prorate';
}

function emptyState(): PopCartState {
  return {
    items: [],
    summary: { ...INITIAL_CART_SUMMARY },
    orderDate: todayLocal(),
    shippingCost: 0,
    // C.5 — sin flete no hay modo que declarar. El backend rechaza `prorate`
    // sin flete tanto como un flete sin modo, así que el default es "ausente".
    shippingCostAllocation: undefined,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function usePopCart() {
  const [cart, setCart] = useState<PopCartState>(emptyState());

  const summary = useMemo(() => calcSummary(cart.items, cart.shippingCost), [cart.items, cart.shippingCost]);
  const itemCount = cart.items.length;
  const totalItems = cart.items.reduce((s, i) => s + i.quantity, 0);
  const isEmpty = cart.items.length === 0;

  const addToCart = useCallback((req: AddToPopCartRequest) => {
    const id = itemKey(req.product, req.variant);
    setCart((prev) => {
      const existing = prev.items.find((i) => i.id === id || (i.product.id === req.product.id && i.variant?.id === req.variant?.id));
      if (existing && !req.is_prebulk) {
        const updated = prev.items.map((i) =>
          i.id === existing.id
            ? recalcItem({
                ...i,
                quantity: i.quantity + req.quantity,
                unit_cost: req.unit_cost,
                notes: req.notes ?? i.notes,
              })
            : i
        );
        return { ...prev, items: updated, updatedAt: new Date().toISOString() };
      }
      const newItem: PopCartItem = {
        id: `POP_ITEM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        product: req.product,
        variant: req.variant,
        quantity: req.quantity,
        unit_cost: req.unit_cost,
        subtotal: req.quantity * req.unit_cost,
        total: req.quantity * req.unit_cost,
        lot_info: req.lot_info,
        notes: req.notes,
        is_prebulk: req.is_prebulk,
        prebulk_data: req.prebulk_data,
        addedAt: new Date().toISOString(),
      };
      return { ...prev, items: [...prev.items, recalcItem(newItem)], updatedAt: new Date().toISOString() };
    });
  }, []);

  const updateCartItem = useCallback((req: UpdatePopCartItemRequest) => {
    setCart((prev) => {
      const items = prev.items.map((i) =>
        i.id === req.itemId
          ? recalcItem({
              ...i,
              quantity: req.quantity ?? i.quantity,
              unit_cost: req.unit_cost ?? i.unit_cost,
              variant: req.variant !== undefined ? req.variant : i.variant,
              lot_info: req.lot_info ?? i.lot_info,
              notes: req.notes ?? i.notes,
            })
          : i
      );
      return { ...prev, items, updatedAt: new Date().toISOString() };
    });
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.id !== itemId),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const clearCart = useCallback(() => {
    setCart(emptyState());
  }, []);

  const setSupplier = useCallback((id?: number, name?: string) => {
    setCart((prev) => ({ ...prev, supplierId: id, supplierName: name }));
  }, []);

  const setLocation = useCallback((id?: number, name?: string) => {
    setCart((prev) => ({ ...prev, locationId: id, locationName: name }));
  }, []);

  const setOrderDate = useCallback((date: string) => {
    setCart((prev) => ({ ...prev, orderDate: date }));
  }, []);

  const setExpectedDate = useCallback((date?: string) => {
    setCart((prev) => ({ ...prev, expectedDate: date }));
  }, []);

  /**
   * C.5 — cambiar a un método que NO es flete limpia el costo y su modo. Sin
   * esto queda un "flete fantasma" en el estado: el campo desaparece de la
   * pantalla y el monto sigue viajando a la vista previa, al cuerpo de la
   * creación y al costo sellado. La pantalla y el carrito tienen que contar la
   * misma historia en todo momento.
   */
  const setShippingMethod = useCallback((method?: ShippingMethod) => {
    setCart((prev) =>
      method === 'freight'
        ? { ...prev, shippingMethod: method }
        : { ...prev, shippingMethod: method, shippingCost: 0, shippingCostAllocation: undefined }
    );
  }, []);

  /**
   * C.5 — el monto se recorta a un no-negativo finito con 2 decimales: la
   * columna es `Decimal(12,2)` y el DTO rechaza el tercer decimal con 400.
   *
   * Con monto > 0 se SIEMBRA el modo en `prorate` (la imputación contable
   * correcta por defecto: el flete es parte de lo que costó poner el producto
   * en bodega) porque el backend devuelve 400 ante un flete sin modo. Al volver
   * a cero se LIMPIA el modo, porque el mismo validador rechaza `prorate` sin
   * monto — y sin limpiarlo quedaría un modo colgando sin flete.
   */
  const setShippingCost = useCallback((cost: number) => {
    const raw = Number(cost);
    const safe = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
    setCart((prev) =>
      safe === 0
        ? { ...prev, shippingCost: 0, shippingCostAllocation: undefined }
        : {
            ...prev,
            shippingCost: safe,
            shippingCostAllocation: prev.shippingCostAllocation ?? 'prorate',
          }
    );
  }, []);

  /**
   * C.5 — el conmutador prorratear/asumir. Sólo tiene sentido con flete > 0;
   * con flete en cero se ignora, porque el backend rechaza un modo sin monto.
   */
  const setShippingCostAllocation = useCallback((mode: PopShippingAllocation) => {
    setCart((prev) =>
      Number(prev.shippingCost) > 0 ? { ...prev, shippingCostAllocation: mode } : prev
    );
  }, []);

  const setPaymentTerms = useCallback((terms?: string) => {
    setCart((prev) => ({ ...prev, paymentTerms: terms }));
  }, []);

  const setNotes = useCallback((notes?: string) => {
    setCart((prev) => ({ ...prev, notes }));
  }, []);

  const setInternalNotes = useCallback((internalNotes?: string) => {
    setCart((prev) => ({ ...prev, internalNotes }));
  }, []);

  const loadOrder = useCallback((order: PurchaseOrder) => {
    const items: PopCartItem[] = (order.purchase_order_items || []).map((poItem, idx) => ({
      id: `LOADED_${idx}_${Date.now()}`,
      product: {
        id: poItem.product_id,
        name: poItem.products?.name || poItem.product_name || `Producto #${poItem.product_id}`,
        sku: poItem.products?.sku ?? undefined,
      },
      variant: poItem.product_variant_id ? { id: poItem.product_variant_id, name: '' } : null,
      quantity: poItem.quantity_ordered,
      unit_cost: poItem.unit_price,
      subtotal: poItem.quantity_ordered * poItem.unit_price,
      total: poItem.quantity_ordered * poItem.unit_price,
      addedAt: new Date().toISOString(),
    }));
    setCart({
      orderId: order.id,
      items,
      summary: { ...INITIAL_CART_SUMMARY },
      supplierId: order.supplier_id,
      supplierName: order.suppliers?.name,
      locationId: order.location_id,
      locationName: order.inventory_locations?.name,
      orderDate: order.created_at?.slice(0, 10) || todayLocal(),
      shippingCost: Number(order.shipping_cost) || 0,
      // C.5 — una orden con flete SIEMPRE tiene modo (el backend lo exige al
      // crearla). Las órdenes anteriores a C.1 no lo tienen persistido: se
      // asume `prorate`, que es lo que su costeo hizo de hecho.
      shippingCostAllocation: shippingAllocationOf(order),
      paymentTerms: order.payment_terms || undefined,
      notes: order.notes || undefined,
      internalNotes: order.internal_notes || undefined,
      status: (order.status as PopOrderStatus) || 'draft',
      createdAt: order.created_at,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  return {
    cart,
    summary,
    itemCount,
    totalItems,
    isEmpty,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    setSupplier,
    setLocation,
    setOrderDate,
    setExpectedDate,
    setShippingMethod,
    setShippingCost,
    setShippingCostAllocation,
    setPaymentTerms,
    setNotes,
    setInternalNotes,
    loadOrder,
  };
}
