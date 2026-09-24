# A.1 — Anti-regresión frontend (CP-pos-order-flows-remediation)

- Fecha (UTC): 2026-09-24
- Rama: `develop` — HEAD `2431a1152` (tomado en la misma sesión que la corrida)
- Rol: A.1 frontend regression verifier (solo lectura + este archivo)
- Skills: `vendix-zoneless-signals`, `vendix-frontend`, `buildcheck-dev`

## 1. Verificación en código (lectura)

Todas las rutas son relativas al repo.

### 1.1 `editingOrderId` declarado en el shipping step — OK

`apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/steps/pos-shipping-step.component.ts:100`

```ts
readonly editingOrderId = input<number | null>(null);
```

Signal input tipado `number | null` con default `null`, junto a `cartState` y
`customerAlias`. Se consume invocado: `this.editingOrderId()` al llamar a
`processShippingSale` (línea 991, 6.º argumento).

### 1.2 El shell se lo pasa — OK

`apps/frontend/src/app/private/modules/store/pos/components/pos-checkout-shell/pos-checkout-shell.component.html:376`

```html
[editingOrderId]="editingOrderId()"
```

dentro de `<app-pos-shipping-step>`. El shell a su vez lo declara como
`input<number | null>(null)` (`pos-checkout-shell.component.ts:124`) y también
se lo pasa a `<app-pos-payment-step>` (línea 95 del HTML).

### 1.3 `processShippingSale` envía `order_id` solo cuando el carrito está adoptado — OK

`apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts:562-616`

- Firma: `processShippingSale(cartState, shippingData, paymentRequest, createdBy, creditConfig?, editingOrderId?: number | null)`.
- Payload (líneas 612-616):

```ts
...((editingOrderId ?? cartState.linkedOrderId) != null
  ? { order_id: editingOrderId ?? cartState.linkedOrderId }
  : {}),
```

La clave `order_id` solo existe cuando hay id de edición del shell o
`linkedOrderId` del carrito; en carrito fresco la clave se omite (no viaja ni
como `null`). Precedencia: `editingOrderId` del shell gana sobre
`linkedOrderId` (cubre el caso "el carrito aún no hidrató su link").

### 1.4 `error-messages.ts` mapea los dos códigos a español accionable — OK

`apps/frontend/src/app/core/utils/error-messages.ts:1140-1143`

| Código | Copy |
|---|---|
| `POS_DRAFT_REQUIRES_PAYMENT_001` | No puedes cobrar y guardar borrador al mismo tiempo. Guarda la orden primero y luego cobra. |
| `POS_DRAFT_DUPLICATE_ORDER_001` | Esta orden ya tiene un cobro o no se puede volver a cobrar. Revisa su detalle antes de intentar otra venta. |

Ambos en español, con acción concreta (guardar-primero-luego-cobrar /
revisar-detalle), sin tecnicismos ni devMessage.

### 1.5 Zoneless/signals — OK

- `pos-shipping-step.component.ts`: `input()`/`signal()`/`computed()`/`effect()`
  con invocación (`this.x()`); sin `NgZone`, `markForCheck`, `detectChanges`,
  `@Input/@Output` ni `EventEmitter` nuevos (búsqueda regex sobre el archivo:
  0 coincidencias para esos tokens).
- `pos-checkout-shell.component.html`: `@if`/`@for`, bindings a señales
  invocadas; sin directivas estructurales legacy en el bloque tocado.
- `error-messages.ts`: mapa plano `Record<string,string>`, sin Angular.

## 2. Specs acotados — UN comando `ng test`

### 2.1 Comando

```bash
cd apps/frontend
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
npx ng test --watch=false --browsers=ChromeHeadlessNoSandbox \
  --include='**/pos-shipping-step.component.spec.ts' \
  --include='**/error-messages.spec.ts'
```

Headless (`ChromeHeadlessNoSandbox`, el launcher de CI), `watch=false`,
single-run. Duración total muy por debajo del límite de 5 min (la fase de
ejecución en navegador: 0.513 s).

### 2.2 Resultado

```text
Chrome Headless 153.0.0.0 (Mac OS 10.15.7): Executed 44 of 44 SUCCESS (0.513 secs / 0.491 secs)
TOTAL: 44 SUCCESS
```

- **Pass: 44 — Fail: 0.** Ningún test existente falla; no se modificó ningún spec.

### 2.3 Qué fijan los specs (verificado por lectura + corrida en verde)

`pos-shipping-step.component.spec.ts:328` — `passes the reopened order id to
the shipping charge`: `setInput('editingOrderId', 700)` y luego
`processShippingSale.calls.mostRecent().args[5]` es `700`.

`error-messages.spec.ts:47-58` — `ERROR_MESSAGES — POS draft payment guards`:
para `POS_DRAFT_DUPLICATE_ORDER_001` y `POS_DRAFT_REQUIRES_PAYMENT_001`,
`parseApiError({ error: { statusCode: 409, error_code, ... } })` resuelve al
copy español propio (no al genérico).

Cobertura adicional por lectura (mismo comportamiento, spec no incluido en la
corrida acotada): `pos-payment.service.spec.ts:6-56` fija `order_id: 41` en
carrito adoptado, omisión de la clave en carrito fresco, y `order_id: 57`
desde el id del shell cuando el carrito aún no hidrata su link.

## 3. Estado del watcher (buildcheck-dev, verificación liviana)

```bash
bash scripts/buildcheck.sh --watch
# ng serve      CAÍDO (nadie escucha en :4200)
# último ciclo  RANCIO — la bitácora es de hace 30241s y el proceso ya no está
# errores       ninguno en el último ciclo
```

El watcher nativo no estaba levantado al momento de la verificación. No se
tocó código, así que no había ciclo que validar; se reporta como contexto, no
como bloqueo (la evidencia de compilación/ejecución es la corrida Karma de
§2, que construye el bundle de test con AOT).

## 4. Conclusión

A.1 frontend **sin regresión**: los cuatro puntos de código están presentes y
conformes con `vendix-zoneless-signals`, y los specs acotados pasan 44/44.
No se modificó ningún archivo del repo salvo la creación de esta evidencia.
