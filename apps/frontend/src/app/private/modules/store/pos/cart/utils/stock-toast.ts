import { CartItem } from '../../models/cart.model';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

/**
 * Muestra un toast de advertencia cuando la cantidad ingresada por el
 * usuario fue clamp'ada al stock máximo disponible.
 *
 * Se usa desde los cart components (POS panel, POS modal, POP cart, POP
 * modal) cuando el `quantity-control` emite el evento `valueClamped`
 * con `reason: 'max'`.
 *
 * El copy es contextual: incluye el hint de empaque para líneas con
 * `is_package_unit`, y la coletilla "para esta variante" cuando el
 * ítem tiene `variant_id`.
 */
export function showStockCapToast(
  toast: ToastService,
  item: CartItem,
  max: number,
): void {
  const hint =
    item.is_package_unit && item.units_per_package
      ? ` (${item.units_per_package} unidades por empaque)`
      : '';
  const message = item.variant_id
    ? `Solo hay ${max} unidades disponibles para esta variante${hint}.`
    : `Solo hay ${max} unidades disponibles${hint}.`;
  toast.warning(message, 'Stock insuficiente', 2200);
}
