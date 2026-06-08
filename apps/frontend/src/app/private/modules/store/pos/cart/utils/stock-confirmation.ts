import { CartItem } from '../../models/cart.model';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { PosCartService } from '../../services/pos-cart.service';

export interface StockConfirmationResult {
  /**
   * `true` si el flujo puede continuar al cobro (no había líneas con
   * stock insuficiente, o todas las respuestas fueron "Sí").
   */
  canProceed: boolean;
  /** Cantidad de líneas removidas del carrito (cliente dijo "No" o dismiss). */
  removedCount: number;
  /** Nombres de las líneas removidas (para mostrar en el toast). */
  removedNames: string[];
}

/**
 * Itera las líneas del carrito y, para cada una cuya cantidad actual ===
 * máxima cantidad vendible (heurística: la línea fue clamp'eada en el
 * input de cantidad, posiblemente por el evento `valueClamped` del
 * `quantity-control` agregado en el fix del clamp de stock), muestra
 * un diálogo de confirmación.
 *
 * Comportamiento:
 * - **SÍ**: mantiene la cantidad actual, continúa al siguiente ítem.
 * - **NO** (o dismiss con X / backdrop / Esc): remueve la línea del carrito
 *   y registra el nombre para el toast de feedback.
 *
 * El resultado se evalúa al final:
 * - Si NO se removió ninguna línea → `canProceed: true` (caller debe abrir
 *   la pantalla de cobro).
 * - Si al menos una línea fue removida → `canProceed: false` (caller debe
 *   mostrar el toast y NO abrir la pantalla de cobro).
 *
 * Filtrado: se ignoran `is_weight_product` e `itemType === 'custom'`
 * (no siguen el modelo de stock por unidad).
 */
export async function confirmStockCappedLines(
  cart: PosCartService,
  dialog: DialogService,
  toast: ToastService,
): Promise<StockConfirmationResult> {
  const items = cart.getCurrentState().items;

  const problemLines = items.filter(
    (item) =>
      !item.is_weight_product &&
      item.itemType !== 'custom' &&
      item.quantity > 0 &&
      item.quantity === cart.getMaxSellableForItem(item),
  );

  if (problemLines.length === 0) {
    return { canProceed: true, removedCount: 0, removedNames: [] };
  }

  const removedNames: string[] = [];

  for (const item of problemLines) {
    const max = cart.getMaxSellableForItem(item);
    const productName = item.variant_display_name || item.product.name;

    const ok = await dialog.confirm({
      title: 'Stock limitado',
      message: `Solo hay <strong>${max}</strong> unidades disponibles de <strong>${productName}</strong>. ¿El cliente se las lleva?`,
      confirmText: 'Sí, llevarlo',
      cancelText: 'No, quitar',
      confirmVariant: 'primary',
    });

    if (!ok) {
      // Dismiss (X / backdrop / Esc) Y click "No, quitar" → ambos retornan
      // false. Por seguridad tratamos ambos igual: removemos y NO cobramos.
      try {
        cart.removeFromCart(item.id).subscribe({
          next: () => removedNames.push(productName),
          error: (err: Error) =>
            toast.error(err.message || 'Error al quitar producto del carrito'),
        });
      } catch {
        // removeFromCart is sync-signal-based; the subscribe fires
        // synchronously. The try/catch is a defensive net for unexpected
        // throws from the service.
      }
    }
  }

  return {
    canProceed: removedNames.length === 0,
    removedCount: removedNames.length,
    removedNames,
  };
}
