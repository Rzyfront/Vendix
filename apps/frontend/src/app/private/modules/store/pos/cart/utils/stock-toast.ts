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
 * El copy es contextual: para líneas vendidas por empaque
 * (`is_package_unit` y `units_per_package > 1`) el `limit` representa
 * empaques (no unidades) y el mensaje debe aclararlo; para el resto el
 * `limit` son unidades. La coletilla "para esta variante" se agrega
 * cuando el ítem tiene `variant_id`.
 */
export function showStockCapToast(
  toast: ToastService,
  item: CartItem,
  limit: number,
): void {
  const isPackageLine =
    item.is_package_unit === true &&
    Number(item.units_per_package ?? 0) > 1;

  if (isPackageLine) {
    const pack = Number(item.units_per_package);
    // `limit` es el número MÁXIMO de empaques (no de unidades) que se
    // pueden vender, ya viene como floor(stock / units_per_package) desde
    // getQuantityMax. El plural "empaques" es seguro porque getQuantityMax
    // usa Math.max(0, ...) y el guard isPackageLine exige > 1 unidades
    // por empaque, lo que implica al menos 1 empaque en stock.
    const variantSuffix = item.variant_id ? ' para esta variante' : '';
    const message = `Solo hay ${limit} empaques disponibles${variantSuffix} (${pack} unidades c/u).`;
    toast.warning(message, 'Stock insuficiente', 2200);
    return;
  }

  const message = item.variant_id
    ? `Solo hay ${limit} unidades disponibles para esta variante.`
    : `Solo hay ${limit} unidades disponibles.`;
  toast.warning(message, 'Stock insuficiente', 2200);
}
