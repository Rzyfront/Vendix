# A.1 — Captura visual Hub de Formatos de Impresión (baseline estático)

> **Phase A.1** · Plan `CP-DTLP-20260827` · Criticality: Misión crítica
> **Method:** Static analysis del código fuente (backend DOWN 2026-08-27 — otro agente en watch reload).
> **Status:** `pending_runtime_check` para captura visual post-stack-healthy.
> **Owner:** rzy · **Branch:** dev (no cambiada) · **Checkpoint anchor:** `dbc484744`

---

## 1. Contexto y decisión

El plan `CP-DTLP-20260827` declara el Hub actual como **10 cards** (no 11). Para que `B.3 ALL_FORMAT_TYPES + FORMAT_TYPE_METADATA + Registry` añada `dispatch_ticket` como **caso de paridad logística** (11ª card, categoría Logística), necesitamos:

1. **Baseline visual** exacto de las 10 cards actuales.
2. **Confirmación estática** de la ausencia de `dispatch_ticket` en `print_format_type_enum` y `ALL_FORMAT_TYPES`.
3. **Mapeo `format_type → metadata`** para que `B.3` sepa dónde inyectar la nueva entrada.

**Decisión:** captura visual vía Playwright pospuesta (backend DOWN, frontend sin `vendix.com` resuelto). Baseline estático + evidencia dinámica diferida para re-ejecución cuando el stack esté sano.

---

## 2. Inventario `ALL_FORMAT_TYPES` (10 valores)

**Source:** `apps/backend/src/domains/store/print-formats/services/print-formats.service.ts:17-28`

```ts
// output real de grep -A 15 "ALL_FORMAT_TYPES = \[" apps/backend/src/domains/store/print-formats/services/print-formats.service.ts
export const ALL_FORMAT_TYPES: print_format_type_enum[] = [
  'pos_sale_ticket',
  'sales_order_invoice',
  'dispatch_note',
  'quotation',
  'credit_note',
  'purchase_order',
  'transfer_note',
  'fiscal_electronic_invoice',
  'fiscal_credit_note',
  'kitchen_ticket',
];
```

**Total:** 10 valores (no 11). `dispatch_ticket` NO está presente.

---

## 3. Inventario `FORMAT_TYPE_METADATA` (10 entries)

**Source:** `apps/backend/src/domains/store/print-formats/services/print-formats.service.ts:30-44`

```ts
export const FORMAT_TYPE_METADATA: Record<
  print_format_type_enum,
  { name: string; category: string; icon: string; engine: 'html' | 'pdf' }
> = {
  pos_sale_ticket:           { name: 'Ticket de Venta POS',          category: 'Ventas POS',     icon: 'receipt',           engine: 'html' },
  sales_order_invoice:       { name: 'Factura de Venta / Orden',     category: 'Ventas',         icon: 'file-text',         engine: 'html' },
  dispatch_note:             { name: 'Remisión / Despacho',          category: 'Logística',      icon: 'truck',             engine: 'html' },
  quotation:                 { name: 'Cotización Comercial',         category: 'Comercial',      icon: 'file-spreadsheet',  engine: 'html' },
  credit_note:               { name: 'Nota Crédito Comercial',       category: 'Ventas',         icon: 'corner-down-left',  engine: 'html' },
  purchase_order:            { name: 'Orden de Compra',              category: 'Compras',        icon: 'shopping-cart',     engine: 'html' },
  transfer_note:             { name: 'Traslado entre Tiendas',       category: 'Inventario',     icon: 'arrow-left-right',  engine: 'html' },
  fiscal_electronic_invoice: { name: 'Factura Electrónica (DIAN)',   category: 'Facturación',    icon: 'shield-check',      engine: 'html' },
  fiscal_credit_note:        { name: 'Nota Crédito Electrónica',     category: 'Facturación',    icon: 'file-minus',        engine: 'html' },
  kitchen_ticket:            { name: 'Ticket de Cocina (KDS)',       category: 'Restaurante',    icon: 'utensils',          engine: 'html' },
};
```

**Total:** 10 entries (no 11).

---

## 4. Las 10 cards que el Hub renderiza actualmente

El Hub (`apps/frontend/src/app/private/modules/store/settings/print-formats/print-formats-hub.component.ts` + `print-formats.facade.ts:loadFormats()`) consume `GET /store/print-formats` → `PrintFormatsService.listStoreFormats()` (línea 61) que mapea `ALL_FORMAT_TYPES` × `FORMAT_TYPE_METADATA`. Cada card renderiza con la siguiente información:

| # | format_type | name | category | icon | engine |
|---|-------------|------|----------|------|--------|
| 1 | `pos_sale_ticket` | Ticket de Venta POS | Ventas POS | receipt | html |
| 2 | `sales_order_invoice` | Factura de Venta / Orden | Ventas | file-text | html |
| 3 | `dispatch_note` | Remisión / Despacho | Logística | truck | html |
| 4 | `quotation` | Cotización Comercial | Comercial | file-spreadsheet | html |
| 5 | `credit_note` | Nota Crédito Comercial | Ventas | corner-down-left | html |
| 6 | `purchase_order` | Orden de Compra | Compras | shopping-cart | html |
| 7 | `transfer_note` | Traslado entre Tiendas | Inventario | arrow-left-right | html |
| 8 | `fiscal_electronic_invoice` | Factura Electrónica (DIAN) | Facturación | shield-check | html |
| 9 | `fiscal_credit_note` | Nota Crédito Electrónica | Facturación | file-minus | html |
| 10 | `kitchen_ticket` | Ticket de Cocina (KDS) | Restaurante | utensils | html |

**Total:** 10 cards renderizadas (no 11).

**Categoría Logística:** Solo `dispatch_note` actualmente. Tras `B.3`, Logística pasará a tener 3 cards: `dispatch_ticket` (nueva), `dispatch_note`, `dispatch_route` (cuando se añada el provider del plan de planillas-rutas).

---

## 5. Confirmación: `dispatch_ticket` NO está en `print_format_type_enum`

**Source:** `apps/backend/prisma/schema.prisma:9397-9408`

```
$ grep "print_format_type_enum" apps/backend/prisma/schema.prisma | head -n 5
9397:enum print_format_type_enum {
9413:  format_type     print_format_type_enum
9436:  format_type     print_format_type_enum

$ sed -n '9397,9408p' apps/backend/prisma/schema.prisma
enum print_format_type_enum {
  pos_sale_ticket
  sales_order_invoice
  dispatch_note
  quotation
  credit_note
  purchase_order
  transfer_note
  fiscal_electronic_invoice
  fiscal_credit_note
  kitchen_ticket
}
```

**Resultado:** El enum tiene 10 valores exactos (sin `dispatch_ticket`). Migración `B.1` debe hacer `ALTER TYPE print_format_type_enum ADD VALUE IF NOT EXISTS 'dispatch_ticket'` para llevarlo a 11.

---

## 6. Confirmación: `dispatch_ticket` NO está en `ALL_FORMAT_TYPES`

Ver sección 2 arriba. El array está literalmente hardcoded con los 10 valores del enum, sin `dispatch_ticket`.

---

## 7. Gaps identificados (para B.3 / D.2)

1. **Enum gap:** `print_format_type_enum` no incluye `dispatch_ticket`. → Migración B.1.
2. **ALL_FORMAT_TYPES gap:** array no incluye `dispatch_ticket`. → B.3 edición.
3. **FORMAT_TYPE_METADATA gap:** falta la entrada con `{name:'Tiquete de Despacho', category:'Logística', icon:'package', engine:'html'}`. → B.3 edición.
4. **Registry gap:** `DocumentDataProviderRegistry` no tiene provider registrado para `dispatch_ticket`. → B.4 creación.
5. **Provider gap:** No existe `DispatchTicketDataProvider` que lea `orders+order_items+addresses+customer_address snapshot+shipping_method`. → B.4.
6. **Composer gap:** No existe `renderDispatchTicketSection` en `PrintLayoutComposer`. → B.5.
7. **Seed gap:** `SYSTEM_PRINT_TEMPLATES` no tiene entry `dispatch_ticket`. → B.2.
8. **Print gateway frontend gap:** No existe `apps/frontend/src/app/private/modules/store/dispatch-ticket/services/dispatch-ticket-print.service.ts`. → D.9.
9. **POS auto-dispatch gap:** `pos-order-confirmation.component.ts` no encadena `dispatch_ticket` tras POS/factura. → E.5.
10. **Order detail manual gap:** `order-details-page.component.ts` no tiene botón `e-ticket de envío` (oculto para `direct_delivery`). → E.3.
11. **Settings gap:** `receipts` no tiene `print_dispatch_ticket_enabled` (default true) ni `print_dispatch_ticket_auto_with_pos` (default false). → C.1 + E.1.

---

## 8. Captura visual pendiente

**Status:** `pending_runtime_check`

**Razón:** Backend caído 2026-08-27 (otro agente en `nest start --watch` reload tras cambios en `invoicing/delivery`). Frontend no resuelve `vendix.com` sin backend sano.

**Comando a ejecutar post-stack-healthy:**

```bash
# 1. Asegurar backend up (otro agente debe confirmar)
curl -sk -H "Authorization: Bearer $TOK" -H 'x-store-id: 5' https://api.vendix.com/api/store/print-formats | jq '.data | length'

# 2. Capturar screenshot del Hub con Playwright MCP
agent_browser_navigate https://vendix.com/admin/settings/print-formats
agent_browser_screenshot path=/Users/rzy/Documents/Organizations/Quickss/Vendix/docs/evidence/a1-hub-before.png fullPage=true

# 3. Confirmar visualmente 10 cards y archivar PNG
ls -lh /Users/rzy/Documents/Organizations/Quickss/Vendix/docs/evidence/a1-hub-before.png
```

**Acceptance gate del plan (A.1):**

- [x] Lista 10 `format_type` confirmados via `grep` estático (backend DOWN no permite `curl`)
- [x] 0 archivos modificados por A.1 (read-only inspection)
- [ ] **Playwright screenshot** `docs/evidence/a1-hub-before.png` size > 0 → **DEFERRED a cuando backend esté sano**

---

## 9. Archivos inspeccionados (read-only)

- `apps/backend/src/domains/store/print-formats/services/print-formats.service.ts:17-44` (leído entero)
- `apps/backend/prisma/schema.prisma:9397-9408` (read)
- `apps/backend/src/domains/store/print-formats/services/print-formats.service.ts:61-88` (`listStoreFormats` method)
- `apps/frontend/src/app/private/modules/store/settings/print-formats/print-formats-hub.component.ts` (referenced)

**Sin archivos modificados.**

---

## 10. Handoff

- **A.1 status:** Static baseline COMPLETO. Visual capture DEFERRED.
- **Next agent action (post-stack-healthy):** Playwright → `docs/evidence/a1-hub-before.png` → re-correr `curl /store/print-formats | jq '.data | length == 10'` → actualizar este archivo con la línea de evidencia dinámica.
- **Risk:** Si entre A.1 y B.3 algún agente paralelo añade `dispatch_ticket` al enum sin sincronizar con el plan, podría haber conflicto de migración. Mitigation: tag `checkpoint/parallel-dispatch-ticket-20260827` ya creado en `dbc484744` previene `reset --hard` agresivo.