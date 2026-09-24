# D.4 FE — modal compartido "Destino del plato": preview + carril mesa

FE del step D.4 (CP-pos-order-flows-remediation). El modal "Destino del plato"
(commit `6131c70`, inline en order-details) se extrajo a componente compartido
con preview de totales, y se reutilizó en el carril mesa. HALT E2E vigente:
sin Playwright; verificación = watch + spot-check aritmético + auditoría de
código.

## 1. Archivos y hunks

NUEVOS — `apps/frontend/src/app/shared/components/item-cancellation-modal/`:

- `item-cancellation-totals.ts` — espejo puro del recálculo backend
  (`previewItemCancellation`, `rederivePercentageTip`,
  `cancellationTypeForDestination` + tipos). Sin imports de Angular.
- `item-cancellation-modal.component.ts` — wrapper standalone sobre
  `app-modal`. Dueño del form (motivo + destino, waste preseleccionado);
  `isOpen = model<boolean>` (canal único, sin `isOpenChange` duplicado);
  emite `(confirmed)` con `{ reason, destination }` ya validado 3–500.
- `item-cancellation-modal.component.html` — radios waste/reuse en
  `fieldset`+`legend`, textarea con `label`, error con `role="alert"`, bloque
  de preview con pipe de moneda propio (cero `$` en duro) o nota fallback,
  footer con Volver/Confirmar.
- `README.md` — contrato de uso del componente.

EDITADOS:

- `shared/components/index.ts` — barrel: componente + tipos + 3 funciones.
- `store/orders/interfaces/order.interface.ts` — `Order` += `tip_amount?`,
  `tip_type?`, `tip_value?`; `OrderItem` += `order_item_taxes?`. Todo YA
  viaja por el cable (`findOne` sin `select` + `order_item_taxes: true`);
  solo se declara lo que llega (precedente `delivered_at`).
- `store/orders/pages/order-details/order-details-page.component.ts` —
  import del compartido + `previewItemCancellation`; `ItemCancellationModalComponent`
  en `imports:`; NUEVO `cancellationPreview = computed(...)` sobre el Order
  vivo; `submitItemCancellation(result: ItemCancellationSubmit)` consume el
  motivo/destino del modal (validación fail-closed conservada);
  eliminadas `cancellationReason`/`cancellationDestination` (el form vive en
  el modal). Hunk C.3 (`deliverItem`, ~4032) intacto — verificado por diff.
- `store/orders/pages/order-details/order-details-page.component.html` —
  bloque inline (~75 líneas) reemplazado por
  `<app-item-cancellation-modal>` con `[preview]="cancellationPreview()"`.
- `store/orders/pages/order-details/order-details-page.component.spec.ts`
  (karma) — nuevo `describe` D.4: 6 tests del espejo (exclusión de la línea
  objetivo + línea ya cancelada, propina % re-derivada, fija respetada,
  redondeo idéntico al backend, clamp a 0, `null` sin línea, mapper mesa).
- `restaurant-ops/tables/pages/table-session-page/table-session-page.component.ts` —
  `cancellationTarget`/`cancellationError` + computeds; `onRemoveItem` deriva
  preparados al modal (`openItemCancellationModal`); `onCancellationConfirmed`
  conecta `cancellation_type` canónico (`cancellationTypeForDestination`) al
  `tablesService.cancelOrderItem` existente; no-preparados conservan el flujo
  confirm+prompt sin cambios.
- `restaurant-ops/tables/pages/table-session-page/table-session-page.component.html` —
  `<app-item-cancellation-modal mode="cancel">` junto a los demás modales,
  `showDestination`/`canReuse` = `cancellationPreparedFired()`.

## 2. Fórmula espejo (idéntica al backend D.4)

Backend: `OrderFlowService.rederivePercentageTip` + recálculo en
`cancelOrderItem` (~2864) y `cancelDeliveredOrderItem` (~3157), que mesa
reutiliza vía delegación (`table-sessions.service.ts` → mismo seam).

- Base viva = Σ `total_price` + Σ `order_item_taxes[].tax_amount` de líneas
  con `cancelled_at IS NULL`, excluyendo la objetivo. NUNCA
  `tax_amount_item` (F-082: mezcla convenciones por unidad/línea).
- `tip_type === 'percentage'` y `Number(tip_value) > 0` →
  `nueva_propina = Math.round((base_viva * pct/100 + EPSILON) * 100) / 100`;
  si no, se conserva `tip_amount` actual.
- `nuevo_total = max(0, subtotal + impuesto + envío + propina − descuento)`.
- Fuente: valores vivos del Order cargado en la página, NO del payload de
  cancel (que no trae totales).
- Mesa pasa `preview = null` a propósito: el GET de sesión no trae
  `order_item_taxes` por línea ni `tip_*` de la orden, así que el espejo no
  puede correr exacto — el modal muestra la nota de total actual. Mismo
  componente, sin inventar el impuesto de la línea. (Backend: prohibido
  tocar en este step; si el plan quiere preview en mesa, el contrato GET
  debe proyectar esos campos primero.)

UI: bloque "Totales previstos" con badge `calculado`, filas Total actual /
Nuevo total previsto / Nueva propina prevista (con nota "recalculada al %
sobre la base viva" o "se mantiene"), `aria-live="polite"` y aclaración
"Valores calculados antes de confirmar; se aplican al guardar".

## 3. Estado del watch

`bash scripts/buildcheck.sh --watch` → `ng serve ACTIVO` + `último ciclo OK`,
`errores: ninguno en el último ciclo`, ciclo 20:56:52 posterior al último
edit (20:56:00). Sin reinicios. `zoneless-audit.sh`: mis archivos aportan
0 violaciones (sin `EventEmitter`/`NgZone`/`@Input`/`*ngIf`/`subscribe` sin
`takeUntilDestroyed`; el `effect` de reset usa `allowSignalWrites` con
precedente documentado); el FAIL global es pre-existente en otros archivos.

## 4. Specs

- Karma `order-details-page.component.spec.ts` extendido (6 tests D.4).
  NO corrido: harness karma exige navegador y la tarea solo autoriza correr
  spec bajo jest (no existe harness jest para frontend) — no se creó ninguno.
- Spot-check independiente: `item-cancellation-totals.ts` transpilado tal
  cual a `/tmp/d4check/` y 10 asserts node contra el artefacto real — 10/10
  OK (incluye redondeo byte-idéntico a la expresión backend y clamp a 0).

## 5. Cómo abrir el modal en cada carril (para el E2E de boss)

Carril orden — ruta `store/orders/:id` (`OrderDetailsPageComponent`):

1. Abrir una orden abierta (no `finished`/`cancelled`/`refunded`, sin pago
   liquidado) con un ítem `prepared`.
2. Cancelación: botón `Cancelar` de la fila
   (`order-details-page.component.html:859`, `(clicked)="cancelItem(item)"`)
   → modal "Destino del plato" (radios solo si el plato fue disparado a
   cocina; si no, nota "Aún no se ha preparado" + motivo + preview).
3. Reversa: botón `Reversar` de un ítem entregado (idem `:816`,
   `(clicked)="reverseDeliveredItem(item)"`) → mismo modal en modo reverse
   (radios siempre, reuse habilitado).
4. Llenar motivo (≥3 chars), elegir destino, `Confirmar cancelación` → toast
   + refresh; el preview debe coincidir con el total recargado.

Carril mesa — ruta `store/tables/session/:id` (`TableSessionPageComponent`):

1. Abrir una sesión abierta con un preparado en la cuenta (disparado o no;
   no entregado, no cancelado).
2. Botón eliminar de la fila (`table-session-page.component.html:590`,
   `(clicked)="onRemoveItem(item)"`) → MISMO modal "Destino del plato".
   Preparado disparado: radios waste (default) / reuse + motivo, sin bloque
   de preview (nota de total actual). Preparado sin disparar: solo motivo.
   Ítem no-preparado: conserva el flujo viejo confirm+prompt (sin modal).
3. `Confirmar cancelación` → `POST
   /api/store/table-sessions/:id/items/:itemId/cancel` con `{ reason,
   cancellation_type? }` (`after_fire_waste`/`after_fire_reused` si hubo
   disparo; omitido si no) → toast "Plato cancelado como merma" + sesión
   recargada con la línea marcada cancelada.

## 6. Accesibilidad verificada en código (sin navegador)

- Foco inicial: `app-modal` (`modal.component.ts:328-330`, modo `dialog`)
  mueve el foco al primer focuseable vía `queueMicrotask` al abrir → radio
  waste, o textarea si no hay destino. Restauración al disparador al cerrar
  (`:336-344`).
- Escape: listener a nivel documento, solo topmost (`:366-372`); el wrapper
  pasa `[closeOnEscape]="!inFlight()"`.
- Trampa de foco Tab/Shift+Tab dentro del diálogo (`:375-413`).
- Semántica: `role="dialog"` + `aria-modal` + `aria-labelledby`
  (`modal.component.ts:52-54`), `fieldset`/`legend` en destinos, `label`
  en motivo, `role="alert"` en errores, `aria-live="polite"` en preview.
- Sin tapado por shell: wrapper `fixed inset-0 z-[9999]`
  (`modal.component.ts:284`); modales hermanos comparten z y gana el último
  en DOM (`isTopmostOpenModal`).
- Respeta `prefers-reduced-motion` (transiciones `motion-reduce:none`).
