/**
 * Reglas compartidas del ciclo de vida de proveedores.
 *
 * Viven en `common/` porque los dominios `store/inventory/suppliers` y
 * `organization/inventory/suppliers` deben decidir "documento abierto" con
 * exactamente el mismo criterio: si divergen, un proveedor archivable desde el
 * panel de organización quedaría bloqueado desde el de tienda (o al revés).
 */

/**
 * Estados de orden de compra que ya no esperan nada del proveedor.
 * Todo lo demás (`draft`, `approved`, `partial`) cuenta como documento abierto.
 */
export const TERMINAL_PURCHASE_ORDER_STATUS = [
  'received',
  'cancelled',
] as const;

/**
 * Estados de remisión cerrados. `delivered` NO está aquí: la mercancía salió
 * pero el ciclo documental sigue abierto hasta que se recibe o se factura.
 */
export const TERMINAL_DISPATCH_NOTE_STATUS = [
  'received',
  'invoiced',
  'voided',
] as const;
