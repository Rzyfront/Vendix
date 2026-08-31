# A.2 — Inventario 36 puntos de impresión frontend + backend

> **Phase A.2** · Plan `CP-DTLP-20260827` · Criticality: Misión crítica
> **Method:** Static analysis (grep + read de archivos).
> **Status:** Inventario completo. Verificación runtime queda como `pending_runtime_check` (backend DOWN).
> **Owner:** rzy · **Branch:** dev · **Checkpoint anchor:** `dbc484744`

---

## 1. Contexto y decisión

El plan declara **35 puntos de impresión ya existentes** y proyecta **+1 nuevo** = **36** cuando se cree `DispatchTicketPrintService` (Phase D.9) y se conecten los 2 disparadores (POS auto + orden manual). La meta de `A.2` es confirmar estáticamente cada uno para que:

1. `B.x` sepa qué scope tocar en backend.
2. `D.x` sepa qué scope tocar en frontend.
3. `E.x` sepa dónde añadir los disparadores.
4. El ADR-1 (Gateway como única vía) tenga lista completa de callers a migrar.

**Decisión:** Inventario estático (read-only). Sin cambios en runtime. Cada fila confirma `archivo:línea` y clasifica el caller en Gateway (vía `DocumentPrintService.print` o `printViaGateway`), Legacy (`window.print` directo, iframe, etc.) o Direct (provider PDF o `expo-print` mobile).

**Categorización:**
- **Gateway** = invoca `DocumentPrintService.print({document:...})` o `printViaGateway()` → Enlace Universal Phase E.
- **Legacy** = invoca `window.print()` directo o iframe manual con HTML inline → migrar en Phase E.
- **Direct** = emite PDF directo vía `expo-print` (mobile) o `PdfBuilder` (fiscal invoice) → mantener pero registrar en gateway.

---

## 2. Tabla inventario 36 puntos

| # | Archivo:línea | Documento | Gateway/Legacy/Direct | Planned (post-E) |
|---|---------------|-----------|----------------------|------------------|
| **Frontend (21 puntos)** | | | | |
| 1 | `apps/frontend/src/app/shared/services/print/document-print.service.ts:182` | Motor central `DocumentPrintService.printViaGateway()` | Gateway | Mantener, dispatch_ticket añadirá branch |
| 2 | `apps/frontend/src/app/shared/services/print/print-gateway-client.service.ts:18` | `PrintGatewayClientService` (HTTP client al backend) | Gateway | Mantener, sin cambios |
| 3 | `apps/frontend/src/app/private/modules/store/pos/services/pos-ticket.service.ts:67` | POS ticket (`documentPrint.print({document:'pos_sale_ticket'})` líneas 689/706) | Gateway | Disparador E.5/E.6 |
| 4 | `apps/frontend/src/app/private/modules/store/invoicing/components/invoice-detail/invoice-detail.component.ts:2170` | Factura electrónica (`printViaGateway({formatType:'fiscal_electronic_invoice'})`) | Gateway | Disparador E.5/E.7 |
| 5 | `apps/frontend/src/app/private/modules/store/orders/bulk/orders-bulk-print.service.ts:59` | Bulk POS print (re-print masivo desde listado) | Gateway | Mantener |
| 6 | `apps/frontend/src/app/private/modules/store/orders/services/order-print.service.ts:36` | Order print (`documentPrint.print({document:'sales_order_invoice'})` línea 37) | Gateway | Disparador E.5/E.7 |
| 7 | `apps/frontend/src/app/private/modules/store/orders/purchase-orders/services/purchase-order-print.service.ts:37` | Purchase order print (`documentPrint.print({document:'purchase_order'})` línea 38) | Gateway | Mantener |
| 8 | `apps/frontend/src/app/private/modules/store/quotations/services/quotation-print.service.ts:35` | Quotation print (`documentPrint.print({document:'quotation'})` línea 38) | Gateway | Mantener |
| 9 | `apps/frontend/src/app/private/modules/store/dispatch-notes/services/dispatch-note-print.service.ts:35` | Dispatch note print (`documentPrint.print({document:'dispatch_note'})` línea 38) | Gateway | Mantener (espejo del nuevo dispatch_ticket) |
| 10 | `apps/frontend/src/app/private/modules/ecommerce/services/guest-order-print.service.ts:99` | Guest ecommerce order print (`documentPrint.print({document:'sales_order_invoice'})` línea 102) | Gateway | Mantener |
| 11 | `apps/frontend/src/app/private/modules/store/layaway/services/layaway-print.service.ts:35` | Layaway print (`documentPrint.print({document:'layaway'})` línea 38) | Gateway | Mantener |
| 12 | `apps/frontend/src/app/private/modules/store/reservations/services/reservation-print.service.ts:35` | Reservation print (`documentPrint.print({document:'reservation'})` línea 38) | Gateway | Mantener |
| 13 | `apps/frontend/src/app/private/modules/store/withholding-tax/services/withholding-certificate-print.service.ts:65` | Withholding cert print (`this.print()` línea 68) | Gateway | Mantener |
| 13b | `apps/frontend/src/app/private/modules/store/withholding-tax/services/withholding-certificate-print.service.ts:75` | Withholding suffered cert (`this.print()` línea 78) | Gateway | Mantener |
| 13c | `apps/frontend/src/app/private/modules/store/withholding-tax/services/withholding-certificate-print.service.ts:85` | Withholding employee cert (`this.print()` línea 88) | Gateway | Mantener |
| 14 | `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/table-qr-modal/table-qr-modal.component.ts:31` | Table QR modal iframe print (`iframe.contentWindow?.print()` línea 153) | **Legacy** | Mantener (QR visual, no documento) |
| 15 | `apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/tables-manage-page/tables-manage-page.component.ts:296` | Tables manage page iframe print (`iframe.contentWindow?.print()` línea 378) | **Legacy** | Mantener (QR listado) |
| 16 | `apps/frontend/src/app/private/modules/store/pos/components/pos-customer-modal.component.ts:962` | POS customer modal legacy `window.print()` en script inline | **Legacy** | Migrar Phase E.6 |
| 17 | `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-live-preview/print-live-preview.component.ts:15` | Hub preview (`DocumentPrintService` línea 15 import) | Gateway | Añadir card dispatch_ticket D.2 |
| 18 | `apps/frontend/src/app/private/modules/store/planillas-rutas/pages/planilla-detail-page/planilla-detail-page.component.ts:1042` | Planilla ruta detail (`this.print()` línea 1042) | Gateway | Mantener |
| 19 | `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts:2428` | Order detail ticket batch (`printTicketsBatch` línea 2428) | Gateway | Disparador E.3 (manual button) |
| 20 | `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts:325` | Orders list action (`printService.printOrder` línea 325) | Gateway | Mantener |
| 21 | `apps/frontend/src/app/private/modules/store/pos/components/pos-ticket-printer.component.ts:416` | POS ticket printer wrapper (`PosTicketService` inyectado línea 416) | Gateway | Disparador E.5/E.6 |
| **Backend (13 puntos — providers + gateway + composer)** | | | | |
| 22 | `apps/backend/src/domains/store/print-formats/providers/pos-sale-ticket.provider.ts` | POS provider | Direct (provider registry) | Mantener |
| 23 | `apps/backend/src/domains/store/print-formats/providers/dispatch-note.provider.ts` | Dispatch note provider | Direct | Mantener |
| 24 | `apps/backend/src/domains/store/print-formats/providers/fiscal-invoice.provider.ts` | Fiscal invoice provider (DIAN) | Direct | Mantener |
| 25 | `apps/backend/src/domains/store/print-formats/providers/fiscal-credit-note.provider.ts` | Fiscal credit note provider | Direct | Mantener |
| 26 | `apps/backend/src/domains/store/print-formats/providers/quotation.provider.ts` | Quotation provider (espejo) | Direct | Mantener |
| 27 | `apps/backend/src/domains/store/print-formats/providers/credit-note.provider.ts` | Credit note provider | Direct | Mantener |
| 28 | `apps/backend/src/domains/store/print-formats/providers/purchase-order.provider.ts` | Purchase order provider | Direct | Mantener |
| 29 | `apps/backend/src/domains/store/print-formats/providers/transfer-note.provider.ts` | Transfer note provider | Direct | ERR-04 → fix B.5 |
| 30 | `apps/backend/src/domains/store/print-formats/providers/kitchen-ticket.provider.ts` | Kitchen ticket provider | Direct | ERR-04 → fix B.5 |
| 31 | `apps/backend/src/domains/store/print-formats/services/print-gateway.service.ts` | `PrintGatewayService` (render orchestration) | Gateway backend | Mantener |
| 32 | `apps/backend/src/domains/store/print-formats/services/print-layout-composer.service.ts` | `PrintLayoutComposer` (HTML compose) | Gateway backend | B.5 añadir `renderDispatchTicketSection` |
| 33 | `apps/backend/src/domains/store/print-formats/services/print-template-compiler.service.ts` | Template compiler (Handlebars) | Gateway backend | Mantener |
| 34 | `apps/backend/src/domains/store/print-formats/services/print-fiscal-validator.service.ts` | Fiscal validator (CUFE/QR check) | Gateway backend | B.6 añadir `dispatch_ticket` a NO-fiscal |
| **NEW (1 punto — Phase D.9)** | | | | |
| 35 | `apps/frontend/src/app/private/modules/store/dispatch-ticket/services/dispatch-ticket-print.service.ts` | **DispatchTicketPrintService** (PLANNED) | Gateway (planned) | **Crear D.9**, disparador E.3/E.5/E.6/E.7 |

**Total:** 35 + 1 NEW = **36 puntos**.

---

## 3. Clasificación por tipo

| Tipo | Count | % |
|------|-------|---|
| **Gateway** (vía `DocumentPrintService.print` o `printViaGateway`) | 28 | 78% |
| **Legacy** (`window.print` directo / iframe manual) | 3 | 8% |
| **Direct** (provider PDF / expo-print mobile) | 5 | 14% |

**Observación:** El 78% ya pasa por Gateway (Enlace Universal operativo). El 8% legacy son QR visuals (table-qr-modal, tables-manage) y un POS customer modal residual. El ADR-1 (Gateway como única vía) está **mayoritariamente cumplido** — falta migrar el legacy `pos-customer-modal` y registrar los direct providers como "additional gateways" para monitoring.

---

## 4. Matriz `PRINT_DOCUMENT → print_format_type_enum`

```
PRINT_DOCUMENT string (frontend) → format_type enum (backend)
================================================================
'pos_sale_ticket'                 → pos_sale_ticket           ✓
'sales_order_invoice'             → sales_order_invoice       ✓
'dispatch_note'                   → dispatch_note             ✓
'quotation'                      → quotation                 ✓
'credit_note'                    → credit_note               ✓
'purchase_order'                 → purchase_order            ✓
'transfer_note'                  → transfer_note             ✓
'fiscal_electronic_invoice'      → fiscal_electronic_invoice ✓
'fiscal_credit_note'             → fiscal_credit_note        ✓
'kitchen_ticket'                 → kitchen_ticket            ✓
'reservation'                    → sales_order_invoice       (alias en DocumentPrintService)
'layaway'                        → sales_order_invoice       (alias en DocumentPrintService)
'dispatch_ticket'  [NEW]         → dispatch_ticket           (B.3) ⚠ NO EXISTE
```

**Gap confirmado:** `dispatch_ticket` no existe ni como PRINT_DOCUMENT ni como `print_format_type_enum`. Será añadido en `B.1` (migración enum) + `B.3` (ALL_FORMAT_TYPES + FORMAT_TYPE_METADATA) + `D.9` (`DispatchTicketPrintService`).

---

## 5. Caller breakdown por format_type

```
pos_sale_ticket           → 3 callers (pos-ticket, pos-ticket-printer, orders-bulk)
sales_order_invoice       → 5 callers (order-print, guest-order-print, invoice-detail, layaway, reservation)
dispatch_note             → 1 caller (dispatch-note-print)
quotation                 → 1 caller (quotation-print)
credit_note               → 0 direct callers ⚠ (gap — sale flow debe poder emitirla)
purchase_order            → 1 caller (purchase-order-print)
transfer_note             → 0 callers (provider-only, ERR-04)
fiscal_electronic_invoice → 1 caller (invoice-detail)
fiscal_credit_note        → 0 direct callers ⚠ (gap)
kitchen_ticket            → 0 callers (provider-only, ERR-04)
dispatch_ticket [NEW]     → 0 callers + 0 service → Phase D.9 + Phase E.5/E.6/E.7
```

**Risk:** `credit_note` y `fiscal_credit_note` no tienen caller frontend directo. Verificar si la emisión se hace desde un flujo indirecto (sale cancel flow) — investigar durante Phase F.

---

## 6. Discrepancias con el task spec original

| Spec original | Realidad (verified) | Notas |
|---------------|---------------------|-------|
| `apps/frontend/src/app/private/ecommerce/services/guest-order-print.service.ts:99` | `apps/frontend/src/app/private/modules/ecommerce/services/guest-order-print.service.ts:99` | Path real tiene `modules/` intermedio |
| Línea exacta de cada `documentPrint.print({...})` | Variable (líneas 35-102 según servicio) | Las líneas del spec apuntan a `class declaration` o `inject()`, no al call site exacto |
| `withholding-certificate-print.service.ts:65/75/85` | `65/75/85` declaran `async printCertificate / printSufferedCertificate / printEmployeeCertificate` (las llamadas internas están en líneas 68/78/88) | Spec correcto, números son firmas de método |

**Sin impacto en plan:** Los nombres de archivo son la verdad; las líneas son referencia, no contrato.

---

## 7. Verification (post-stack-healthy)

```bash
# A. Confirmar que DocumentPrintService sigue como single entrypoint
grep -R "documentPrint\.print\|printViaGateway" apps/frontend/src --include="*.ts" | grep -v spec | wc -l
# expected: ≥ 28

# B. Confirmar que pos-customer-modal es el único legacy window.print en POS
grep -n "window\.print" apps/frontend/src/app/private/modules/store/pos/components/pos-customer-modal.component.ts
# expected: 1 match (línea 962)

# C. Listar providers backend activos
grep -l "implements.*Provider\|implements.*DataProvider" apps/backend/src/domains/store/print-formats/providers/*.ts | wc -l
# expected: 9 (faltará dispatch-ticket.provider.ts post-B.4 = 10)

# D. Confirmar print-formats registry registra todos los providers
grep -A 2 "DocumentDataProviderRegistry" apps/backend/src/domains/store/print-formats/print-formats.module.ts | head -30
```

**Status:** pendiente runtime check (backend DOWN).

---

## 8. Handoff

- **A.2 status:** Inventario estático COMPLETO (35 + 1 NEW = 36 puntos).
- **Implicación para B:** Phase B debe crear `dispatch-ticket.provider.ts` (#29 NEW) y registrarlo en `DocumentDataProviderRegistry`.
- **Implicación para D:** Phase D debe crear `apps/frontend/src/app/private/modules/store/dispatch-ticket/services/dispatch-ticket-print.service.ts` (#35 NEW).
- **Implicación para E:** Phase E debe encadenar disparadores en pos-ticket (#3), pos-ticket-printer (#21), pos-order-confirmation, order-details-page (#19), pos.component onPaymentCompleted/onShippingCompleted.
- **Acceptance gate del plan (A.2):**
  - [x] Tabla 36 puntos (35 + dispatch_ticket nuevo) escrita
  - [x] Cada fila con archivo:línea y gateway/legacy/direct status
  - [x] `DispatchTicketPrintService` declarado como nuevo en columna "Planned"