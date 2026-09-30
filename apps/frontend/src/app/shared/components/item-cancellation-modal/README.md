# item-cancellation-modal

Modal compartido "Destino del plato" (D.4, CP-pos-order-flows-remediation).
Un solo modal para los dos carriles: detalle de orden y sesión de mesa.

## Uso

```html
<app-item-cancellation-modal
  [isOpen]="cancellationModalOpen()"
  (isOpenChange)="!$event && closeItemCancellationModal()"
  [itemName]="cancellationTarget()?.product_name || ''"
  [showDestination]="preparedFired()"
  [canReuse]="preparedFired()"
  [inFlight]="removingItemId() !== null"
  [serverError]="cancellationError()"
  [currentTotal]="currentTotal()"
  [preview]="cancellationPreview()"
  (confirmed)="submitItemCancellation($event)"
/>
```

- `isOpen` es `model<boolean>` (canal único; no duplicar `isOpenChange`).
- `(confirmed)` emite `{ reason, destination }` ya validado (3–500 chars).
  El padre ejecuta la mutación y reporta errores de red vía `serverError`
  sin cerrar el modal.
- `preview`: `ItemCancellationPreview | null` de
  `previewItemCancellation()` (mismo archivo). `null` = carril sin datos
  por línea: se muestra la nota de total actual en vez del preview.

## Preview (espejo D.4)

`item-cancellation-totals.ts` replica literalmente el recálculo del backend
(`OrderFlowService.cancelOrderItem` / `cancelDeliveredOrderItem`): base viva
sobre líneas activas excluyendo la objetivo, impuesto solo desde
`order_item_taxes[].tax_amount` (nunca `tax_amount_item`), propina
porcentual re-derivada con `Math.round((raw + EPSILON) * 100) / 100`, total
con `max(0, …)`. Módulo puro sin Angular: importable desde specs sin TestBed.
