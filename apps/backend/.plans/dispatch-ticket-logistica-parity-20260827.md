# dispatch-ticket-logistica-parity-20260827

> **Path:** `docs/plans/dispatch-ticket-logistica-parity-20260827.md`
> **Plan Id:** CP-DTLP-20260827
> **Criticality:** Misión crítica — toca facturación (CUFE/QR DIAN), POS (volumen 40% ventas), multi-tenant + 3 agentes paralelos activos en `dev`.
> **Owner:** rzy · **Created:** 2026-08-26 · **Status:** approved → in-execution
> **Linear:** none (generado desde comando directo del owner)

---

## Plan Identity

- **Id:** CP-DTLP-20260827
- **Criticality:** Integración `dispatch_ticket` en Hub enriquecido + Print Gateway. Falla emite documento sin SKU/cantidades o —peor— fiscal sin CUFE. Consecutivo DIAN quemado si template borra `fiscal.cufe`. Multi-tenant + 3 agentes paralelos en `dev` requieren `parallel` skill estricto.
- **Owner:** rzy
- **Created:** 2026-08-26 · **Last updated:** 2026-08-27
- **Status:** in-execution
- **Linear / issue:** none
- **Checkpoint anchor:** `dbc484744` → tag `checkpoint/parallel-dispatch-ticket-20260827`
- **Recovery SHA:** `e8352339ac155e7483f6d256861671dc0511f91b` (tag commit)
- **Branch activa:** `dev` (no se cambia)

## Execution Ledger

| Phase | Steps | Done | In progress | Blocked | Status |
|-------|-------|------|-------------|---------|--------|
| A — Foundations & Contracts | 5 | 0 | 0 | 0 | ⬜ Not started |
| B — Backend Hub + dispatch_ticket | 7 | 0 | 0 | 0 | ⬜ Not started |
| C — Persistence + Settings | 3 | 0 | 0 | 0 | ⬜ Not started |
| D — Frontend Hub + DispatchTicketPrintService | 9 | 0 | 0 | 0 | ⬜ Not started |
| E — Enlace Universal + 2 Disparadores | 14 | 0 | 0 | 0 | ⬜ Not started |
| F — Validación + Convergencia | 4 | 0 | 0 | 0 | ⬜ Not started |

**Current position:** Phase A · step A.1 — Orchestrator writing plan + checkpoint anchor ✅ done · awaiting fan-out
**Owner:** rzy · **Last updated:** 2026-08-27 (build phase start)
**Open blockers:** 3 agentes paralelos activos (PIDs 42743/53107/53941 + worktree `agent-a77358425d393408e`) deben respetar scope o pausar antes de fan-out.
**Handoff notes:** Plan completo en `/tmp/vendix-plans/dispatch-ticket-logistica-parity-20260827.md` (mirror read-only) y copia en `apps/backend/.plans/dispatch-ticket-logistica-parity-20260827.md` al finalizar Fase A.

## Context

`dispatch_ticket` existe como `PrintDocument` configurable (`thermal_80 / 1 copia`) en `store-settings.interface.ts:672/792` + `mobile/print-formats.ts:93` pero **cero emisores frontend**, **cero provider gateway**, **cero disparadores**. `grep print({document:'dispatch_ticket'}) = 0` en todo el repo. El usuario quiere que `dispatch_ticket` se configure desde el **Hub de Formatos enriquecido** y se emita automáticamente **junto con ticket POS/factura** (configurable) o **manualmente desde el detalle de orden sección Envío** (botón `e-ticket de envío`), con contenido sencillo: cliente, dirección, productos por línea y cantidades. `direct_delivery` no imprime ticket — solo transiciona `ship_status=sent`.

El Hub enriquecido (plan original `CP-PRINT-FORMATS-ENRIQUECIDO-PROFESIONAL`) cubre 10 formatos y los 17 emisores legacy. Este plan lo extiende con `dispatch_ticket` como **caso de paridad logística** que valida que el Hub sirve también para ticket térmico.

## Criticality Justification

> Invocación explícita del owner (verbatim):
> *"TENGO ESTE MODULO https://vendix.com/admin/settings/print-formats ... LA IDEA ES QUE ESTE MODULO SEA UN ENTORNO ENRRIQUECIDO, PROFESIONAL Y FIEL ... USA UN @skills/how-to-critical-plan/ ... ADEMAS DEBE QUEDAR ENLAZADO Y FUNCIONA EN TODOS LOS SITIOS DONDE DEBE FUNCIONAR."*
> *"Hay que ajustarlo y agregarle este detalle super importante ... Integrar el Ticket de Despacho (dispatch_ticket) en el nuevo Hub de Formatos de Impresión y Print Gateway de Vendix ... ese ticker de despacho podre configurar que se imprima 1 Junto con ticket POS o factura de venta en POS o 2 Desde el detalle de la orden en la seccion de envio."*

**Por qué crítico:**
1. **Función crítica dinero/fiscal:** `fiscal_electronic_invoice`/`fiscal_credit_note` requieren CUFE/CUDE/QR DIAN. `dispatch_ticket` no es fiscal pero comparte motor. Error en merge `overrides` borra secciones fiscales obligatorias.
2. **Fallo no recuperable:** DIAN consecutivo quemado. Plantilla congelada `invoice_profile_versions.profile_snapshot.config.format.template_id` debe sobrevivir una migración.
3. **Multi-tenant:** `store_print_format_configs`, `print_templates` (org), `withoutScope()` para `is_system`. `TRUNCATE CASCADE` ignora `ON DELETE RESTRICT`.
4. **3 agentes paralelos en `dev`:** `parallel` skill activo. Cualquier commit debe pasar `parallel` guard antes de mover archivos.
5. **Migración que muta filas:** backfill `gateway_enabled=false→true` + nueva fila `dispatch_ticket` por tienda. Sin `CASCADE`. Sin `TRUNCATE`.
6. **Multi-sesión (owner duerme):** 7 fases, 38 pasos, 13 perspectivas, 2 rondas convergencia. Living Document + Handoff Notes son ley.

## General Objective

Integrar `dispatch_ticket` en el Hub de Formatos enriquecido y Print Gateway de Vendix, configurable desde el editor profesional (logo, info empresa, estilos, papel térmico 80mm), con **2 disparadores configurables**:
1. Auto con POS/factura (solo si venta con envío y `shipping_method !== 'direct_delivery'`)
2. Manual desde `order_details` sección Envío (botón `e-ticket de envío`)

## Specific Objectives (verificables)

1. Enum `print_format_type_enum` incluye `'dispatch_ticket'` (11 valores) via migration `ADD VALUE IF NOT EXISTS`.
2. Seed `SYSTEM_PRINT_TEMPLATES.dispatch_ticket` con `thermal_80 / courier mono / 9pt / margin_mm:0 / copies:1`.
3. `DispatchTicketDataProvider` lee `orders+order_items+addresses+customer_address snapshot+shipping_method` y emite HTML con **cliente, dirección, productos por línea, cantidades pedidas/despachadas**. Sin totales fiscales, sin QR.
4. `DispatchTicketPrintService` frontend (`document:'dispatch_ticket'`, `trigger` `automatic|explicit`).
5. Hub muestra 11 cards (Logística 3: `dispatch_ticket`/`dispatch_note`/`dispatch_route`).
6. POS auto: `pos-order-confirmation.component.ts maybeAutoPrint/printReceipt` encadenado si `print_dispatch_ticket_enabled && print_dispatch_ticket_auto_with_pos && isShippingSale && shipping_method !== 'direct_delivery'`.
7. POS manual: misma guard en `pos.component.ts onPaymentCompleted/onShippingCompleted`.
8. Orden detalle: `headerActions` `e-ticket de envío` + botón secundario en card `Gestión de Envío` (oculto si `direct_delivery`).
9. Setting `receipts.print_dispatch_ticket_enabled?: boolean` (default true) + `receipts.print_dispatch_ticket_auto_with_pos?: boolean` (default false). Sin `KNOWN_SECTIONS` drop.
10. Migración `gateway_enabled default true` + backfill sin CASCADE + nueva fila `dispatch_ticket` por tienda.
11. 23 FB + 19 DB + 16 ERR registros tickeados contra live con curl.
12. Convergence Loop: 2 rondas limpias consecutivas con 13 perspectivas.

## Non-Goals

- Editor WYSIWYG drag libre tipo Figma — modelo estructurado sigue.
- Diseñador PDF visual vectorial — reusa `InvoicePdfBuilder`/`DispatchNotePdfBuilder`.
- i18n de tokens (`es-CO` fijo).
- `platform-invoicing` PDF superadmin (C.5.5).
- `engine:pdf` para ticket térmico `dispatch_ticket` (roll, no aplica).

## Approach Chosen

Evolución del gateway existente. 7 fases: A Foundations → B Backend Hub+dispatch_ticket → C Persistence → D Frontend Hub+Service → E Enlace Universal+disparadores → F Validación.

Decisiones consolidadas con el owner:
- **Setting location:** flat bajo `receipts` raíz (`print_dispatch_ticket_enabled` + `print_dispatch_ticket_auto_with_pos`).
- **Copias:** default 1, configurable por tienda.
- **Contenido:** cliente, dirección, productos por línea, cantidades (sin totales fiscales, sin QR).
- **Disparadores:** POS auto (configurable) + orden manual (siempre visible salvo `direct_delivery`).
- **`direct_delivery`:** no imprime `dispatch_ticket`; solo marca `ship_status=sent`.

Coordinación con 3 agentes paralelos activos:
- Checkpoint anchor `dbc484744` (HEAD actual).
- Tag ligero `checkpoint/parallel-dispatch-ticket-20260827` (no mueve HEAD).
- Cada sub-agente fan-out recibe scope file list explícito + prohibición de tocar archivos fuera de scope.
- Commit temprano + frecuente por sub-agente (protección contra `reset --hard` vecino).
- Prohibición absoluta de `git checkout`, `reset`, `restore`, `clean`, `--amend`, `--force`.

## Alternatives Considered

- **Plantillas 100% custom sin estructura:** rechazado — fiscal exige 5 secciones obligatorias.
- **Microservicio de impresión externo:** rechazado — duplica `FISCAL_DOCUMENT_PRINT_INCLUDE` y latencia.
- **Modelo relacional `print_sections/print_fields`:** rechazado — `TRUNCATE` + JOIN N+1.

## Architecture Decision Records

### ADR-1 — Gateway como única vía de impresión (Enlace Universal)
- **Context:** 35→36 puntos dispersos. `dispatch_ticket` se añade como caso de paridad.
- **Decision:** Todo `print` cliente pasa por `POST /store/print-formats/render`. `DocumentPrintService.printViaGateway({formatType:'dispatch_ticket', documentId, engine:'html'})` desde nuevo `DispatchTicketPrintService`.
- **Consequences:** Validación fiscal única, identidad emisor única, 1 solo motor HTML.
- **Reversibility:** costly — revertir reintroduce divergencia `trade_name`.
- **Revisit if:** volumen >10k/día → BullMQ.

### ADR-2 — Definición v2 en Json versionado con AJV Schema
- **Context:** `definition/overrides` son `Record<string,any>` sin `ValidateNested`. `mergeDefinition` shallow.
- **Decision:** `definition:{v:2, paper, logo, company_block, sections, columns, styles, header/footer, tokens, custom_template}` con AJV. `mergeDefinition` deep por `id`.
- **Consequences:** 422 temprano, no 500 en compose. Migración sin `DROP COLUMN`.
- **Reversibility:** trivial — `v1` fallback `PRINT_DEFAULTS`.
- **Revisit if:** query analítica por campo → GIN index.

### ADR-3 — Plantilla congelada por `profile_snapshot` para fiscales
- **Context:** `resolveProfileTemplateId` solo para `fiscal_electronic_invoice`. `fiscal_credit_note` diverge.
- **Decision:** Ambos fiscales leen `invoice_profile_versions.profile_snapshot.config.format.template_id`. Sin `template_id` → `store_print_format_configs` activa + warn.
- **Consequences:** Reimpresión idéntica a emisión.
- **Reversibility:** costly — bytes no idempotentes.
- **Revisit if:** cambia regulación DIAN sobre plantilla congelada.

### ADR-4 — PDF engine = builder existente (fidelidad)
- **Context:** `PDF_ENGINE_SUPPORTED_FORMATS=['fiscal_electronic_invoice']`. CSS no replica tipografía escalada.
- **Decision:** `engine:pdf` llama `InvoicePdfBuilder`/`DispatchNotePdfBuilder` directo.
- **Consequences:** Paridad importes/CUFE/retención garantizada.
- **Reversibility:** one-way door — bytes con timestamp.
- **Revisit if:** paridad HTML↔PDF rompe en Q&A.

### ADR-5 — `gateway_enabled` default true + migración bulk
- **Context:** `gateway_enabled @default(false)` deja cobertura 0%.
- **Decision:** Migration `SET DEFAULT true` + backfill `UPDATE ... SET gateway_enabled=true` sin CASCADE.
- **Consequences:** Enlace Universal ON por defecto.
- **Reversibility:** trivial — `deactivateGateway`.
- **Revisit if:** regression mass-printing legacy.

### ADR-6 — `dispatch_ticket` independiente de `direct_delivery`
- **Context:** owner pidió que `direct_delivery` NO imprima `dispatch_ticket`, solo marque `ship_status=sent`. POS auto debe respetar `isShippingSale && shipping_method !== 'direct_delivery'`.
- **Decision:** Guard explícita en cada disparador. `direct_delivery` mantiene `window.print` legacy o nada. Botón `e-ticket de envío` en orden oculto si `shipping_method === 'direct_delivery'`.
- **Consequences:** `dispatch_ticket` solo aplica a `pickup`/`delivery` con alistamiento.
- **Reversibility:** trivial — quitar guard.
- **Revisit if:** `direct_delivery` pide revertir.

### ADR-7 — Setting `print_dispatch_ticket_*` flat bajo `receipts`
- **Context:** `KNOWN_SECTIONS` dropea secciones desconocidas con 200 silencioso. `receipts.printing.*` cubre formato/copias.
- **Decision:** `receipts.print_dispatch_ticket_enabled?: boolean` (default true) + `receipts.print_dispatch_ticket_auto_with_pos?: boolean` (default false). Plano bajo `receipts`.
- **Consequences:** No se pierde en `KNOWN_SECTIONS`. Visible en `receipts-settings-form`.
- **Reversibility:** trivial.
- **Revisit if:** organización pide scoped-per-user → settings user-level.

## Blast Radius

| Surface | Qué rompe si plan falla | Quién nota | Señal detección |
|---------|-------------------------|------------|-----------------|
| Facturación electrónica | Factura sin CUFE/QR o NIT divergente → rechazo DIAN, consecutivo quemado | Cliente/Contador/DIAN | `PRINT_FISCAL_STRUCTURE_VIOLATION_001` 422 + log `FiscalInvoicePdfRenderService` |
| POS ticket | Ticket desbordado (60%+60%+60%) o sin IVA cuando aplica | Cajero/Cliente | `totalWidth !==100` warning + POS bulk 501 en `print-gateway` |
| `dispatch_ticket` | Ticket sin SKU/cantidades o vacío en ventas con envío | Operador bodega | `dispatch_ticket preview` sin `Cant. despachada` |
| POS auto-dispatch | Despacho imprime donde no debe | Cajero | `print_dispatch_ticket_enabled=false` corta |
| `direct_delivery` | Regresión imprime donde antes no | Operador | Botón oculto + guard |
| Mobile parity | App `expo-print` no refleja orientation/margin | Repartidor | Audit `mobile-parity-audit` |

## Critical Files (rutas concretas, sin wildcards)

### Backend — Hub + dispatch_ticket
- `apps/backend/prisma/schema.prisma` (enum `print_format_type_enum`, modelos `print_templates`, `store_print_format_configs`)
- `apps/backend/prisma/seeds/print-templates.seed.ts`
- `apps/backend/src/domains/store/print-formats/print-formats.module.ts`
- `apps/backend/src/domains/store/print-formats/controllers/print-formats.controller.ts`
- `apps/backend/src/domains/store/print-formats/controllers/print-templates-library.controller.ts`
- `apps/backend/src/domains/store/print-formats/services/print-formats.service.ts`
- `apps/backend/src/domains/store/print-formats/services/print-gateway.service.ts`
- `apps/backend/src/domains/store/print-formats/services/print-layout-composer.service.ts`
- `apps/backend/src/domains/store/print-formats/services/print-template-compiler.service.ts`
- `apps/backend/src/domains/store/print-formats/services/print-fiscal-validator.service.ts`
- `apps/backend/src/domains/store/print-formats/services/fiscal-invoice-pdf-render.service.ts`
- `apps/backend/src/domains/store/print-formats/services/fiscal-issuer-identity.ts`
- `apps/backend/src/domains/store/print-formats/interfaces/print-format.interface.ts`
- `apps/backend/src/domains/store/print-formats/interfaces/standard-print-data.model.ts`
- `apps/backend/src/domains/store/print-formats/providers/pos-sale-ticket.provider.ts`
- `apps/backend/src/domains/store/print-formats/providers/dispatch-note.provider.ts`
- `apps/backend/src/domains/store/print-formats/providers/fiscal-invoice.provider.ts`
- `apps/backend/src/domains/store/print-formats/providers/fiscal-credit-note.provider.ts` (proveer `dispatch_ticket` analog)
- `apps/backend/src/domains/store/print-formats/dto/print-format-config.dto.ts`
- `apps/backend/src/domains/store/print-formats/dto/print-render.dto.ts`
- `apps/backend/src/domains/store/print-formats/enums/print-format.enum.ts`
- `apps/backend/src/common/errors/error-codes.ts` (PRINT_*)
- `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts`
- `apps/backend/src/domains/store/settings/dto/settings-schemas.dto.ts`
- `apps/backend/src/domains/store/settings/defaults/default-store-settings.ts`
- `apps/backend/src/domains/store/orders/orders-bulk.service.ts`
- `apps/backend/src/domains/store/dispatch-notes/dispatch-notes.controller.ts`
- `apps/backend/src/domains/store/dispatch-notes/pdf/dispatch-note-pdf.service.ts`

### Frontend — Hub enriquecido + DispatchTicketPrintService
- `apps/frontend/src/app/core/models/print-formats.model.ts`
- `apps/frontend/src/app/core/models/store-settings.interface.ts`
- `apps/frontend/src/app/shared/services/print/print-gateway-client.service.ts`
- `apps/frontend/src/app/shared/services/print/document-print.service.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/print-formats-hub.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/services/print-formats.facade.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-format-editor/print-format-editor.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-sections-editor/print-sections-editor.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-columns-editor/print-columns-editor.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-styles-editor/print-styles-editor.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-custom-template-editor/print-custom-template-editor.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-live-preview/print-live-preview.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-library-modal/print-library-modal.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/print-formats-settings-form/print-formats-settings-form.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/print-formats-settings-form/print-formats.copy.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/print-formats-settings-form/print-format-chip.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/receipts-settings-form/receipts-settings-form.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/components/receipts-settings-form/receipts-settings-form.component.html`
- `apps/frontend/src/app/private/modules/store/settings/general/pages/sales-settings.page.ts`
- `apps/frontend/src/app/private/modules/store/settings/general/services/general-settings.store.ts`
- `apps/frontend/src/app/private/modules/store/dispatch-notes/services/dispatch-note-print.service.ts` (espejo)
- `apps/frontend/src/app/private/modules/store/orders/services/order-ticket.service.ts` (espejo mapper)
- `apps/frontend/src/app/private/modules/store/pos/services/pos-ticket.service.ts`
- `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts`
- `apps/frontend/src/app/private/modules/store/pos/components/pos-ticket-printer.component.ts`
- `apps/frontend/src/app/private/modules/store/pos/pos.component.ts`
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts`
- `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.html`

### Mobile — parity
- `apps/mobile/src/shared/print/print-formats.ts`
- `apps/mobile/src/shared/print/document-print.service.ts`
- `apps/mobile/src/features/pos/services/pos-ticket.service.ts`
- `apps/mobile/src/features/store/types/settings.types.ts`

## Contract Inventory

### Frontend↔Backend Contract Registry (23 filas)

| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | `GET /store/print-formats` | — | `{data: StorePrintFormatSummary[11]}` | `print-formats.facade.ts:63 loadFormats()` | `+ dispatch_ticket` | `none` | `curl -H 'x-store-id: 5' /store/print-formats \| jq '.data \| length == 11'` | `- [ ]` |
| FB-02 | `GET /store/print-formats/:formatType` | `formatType enum` | `{data: StorePrintFormatDetail}` | `facade.selectFormat` | `+ dispatch_ticket` | `none` | `curl .../dispatch_ticket \| jq '.data.format_type'` | `- [ ]` |
| FB-03 | `PUT /store/print-formats/:formatType` | `UpdatePrintFormatConfigDto{overrides}` | `{data: StorePrintFormatDetail}` | `facade.saveCurrentFormat` | `overrides v2 schema` | type mismatch | `curl -X PUT -d '{"overrides":{"v":2,"paper":{"format":"thermal_80"}}}' /dispatch_ticket \| jq` | `- [ ]` |
| FB-04 | `POST /store/print-formats/:formatType/preview` | `{overrides, sample_document_id}` | `{data: {html, width_mm:80, is_roll:true}}` | `facade.refreshPreview` | `+ sampleDocumentId` | `none` | `curl -X POST /dispatch_ticket/preview -d '{}' \| jq '.data.html \| contains("Cant")'` | `- [ ]` |
| FB-05 | `POST /store/print-formats/render` | `{format_type, document_id, engine}` | `{data: RenderResult}` | `DocumentPrintService.printViaGateway` | `+ dispatch_ticket` | `none` | `curl -X POST /render -d '{"format_type":"dispatch_ticket","document_id":1}' \| jq '.data.html \| contains("Cant. despachada")'` | `- [ ]` |
| FB-06 | `PATCH /store/settings` | `{receipts:{print_dispatch_ticket_enabled, print_dispatch_ticket_auto_with_pos, printing:{dispatch_ticket:{...}}}}` | `{data: settings}` | `receipts-settings-form.component.ts`, `general-settings.store.ts` | `+ 2 boolean fields` | `KNOWN_SECTIONS` drop | `curl -X PATCH -d '{"receipts":{"print_dispatch_ticket_enabled":true,"print_dispatch_ticket_auto_with_pos":false}}' /store/settings \| jq '.data.receipts.print_dispatch_ticket_enabled'` | `- [ ]` |
| FB-07 | `GET /store/settings` | — | `{data: settings}` | `general-settings.store.ts` | `+ 2 boolean fields` | `none` | `curl /store/settings \| jq '.data.receipts.print_dispatch_ticket_enabled'` | `- [ ]` |
| FB-08 | `POST /store/print-formats/:formatType/activate` | — | `{data: {format_type, gateway_enabled:true}}` | `print-formats.facade.toggleGateway` | `none` | `none` | `curl -X POST /dispatch_ticket/activate \| jq` | `- [ ]` |
| FB-09 | `POST /store/print-formats/:formatType/deactivate` | — | `{data: {format_type, gateway_enabled:false}}` | `print-formats.facade.toggleGateway` | `none` | `none` | `curl -X POST /dispatch_ticket/deactivate \| jq` | `- [ ]` |
| FB-10 | `DELETE /store/print-formats/:formatType` | — | `{data: {success, message}}` | `facade.resetCurrentFormat` | `none` | `none` | `curl -X DELETE /dispatch_ticket \| jq` | `- [ ]` |
| FB-11 | `GET /store/print-formats/library?format_type=dispatch_ticket` | — | `{data: PrintTemplate[]}` | `facade.loadLibraryTemplates` | `+ format_type` | snake_case vs camelCase | `curl '/library?format_type=dispatch_ticket' \| jq '.data[0].format_type'` | `- [ ]` |
| FB-12 | `POST /store/print-formats/library` | `{format_type:'dispatch_ticket', name, definition, is_shared?}` | `{data: PrintTemplate}` | `facade.createLibraryTemplate` | `+ dispatch_ticket` | `none` | `curl -X POST /library -d '{...}' \| jq` | `- [ ]` |
| FB-13 | `POST /store/print-formats/library/:id/clone` | — | `{data: StorePrintFormatDetail}` | `facade.cloneTemplate` | `none` | `none` | `curl -X POST /library/1/clone \| jq` | `- [ ]` |
| FB-14 | `PUT /store/print-formats/library/:id` | `UpdatePrintTemplateDto` | `{data: PrintTemplate}` | UI nueva (D.9) | `none` | missing endpoint | `curl -X PUT /library/1 -d '{...}' \| jq` | `- [ ]` |
| FB-15 | `DELETE /store/print-formats/library/:id` | — | `{data: {success}}` | UI nueva (D.9) | `none` | missing endpoint | `curl -X DELETE /library/1 \| jq` | `- [ ]` |
| FB-16 | `PUT /store/print-formats/library/:id/share` | `{is_shared:boolean}` | `{data: PrintTemplate}` | `facade.updateTemplateShare` | `none` | `none` | `curl -X PUT /library/1/share -d '{"is_shared":true}' \| jq` | `- [ ]` |
| FB-17 | `POST /store/print-formats/bulk/render` | `{requests:Array<{format_type, document_id}>}` | `{data: RenderResult[]}` | `orders-bulk.service.ts` | `+ new bulk` | `ArrayMaxSize 100` | `curl -X POST /bulk/render -d '{"requests":[...]}' \| jq '.data \| length == 100'` | `- [ ]` |
| FB-18 | `GET /store/print-formats/:formatType/preview` con `engine=pdf` | `{overrides, sample_document_id}` | `{data: {html, pdf_buffer}}` | `print-live-preview.component.ts` | `+ pdf engine preview` | type mismatch | `curl -X POST /dispatch_ticket/preview -d '{"engine":"pdf"}' \| jq '.data.pdf_buffer'` | `- [ ]` |
| FB-19 | `POST /store/orders/:id/print-dispatch-ticket` | `{trigger:'automatic'\|'explicit', copies?}` | `{data: RenderResult}` | UI nueva (E.3) | `none` | server vs client | (a decidir server-side proxy) `curl -X POST /orders/123/print-dispatch-ticket -d '{"trigger":"explicit"}' \| jq` | `- [ ]` |
| FB-20 | `GET /store/orders/:id` | — | `{data: Order}` | `order-details-page.component.ts` | `+ shipping_method field` | type mismatch | `curl /orders/123 \| jq '.data.shipping_method'` | `- [ ]` |
| FB-21 | `POST /store/pos/complete` | `{orderId, ...}` | `{data: ...}` | `pos.component.ts onPaymentCompleted` | `none` | `none` | `curl -X POST /pos/complete -d '{...}' \| jq` | `- [ ]` |
| FB-22 | `POST /store/dispatch-notes/:id/print` | `{trigger, copies?}` | `{data: RenderResult}` | (legacy `dispatch_note` already migrated) | `none` | `none` | `curl -X POST /dispatch-notes/1/print -d '{"trigger":"explicit"}' \| jq` | `- [ ]` |
| FB-23 | `POST /store/print-formats/render {dispatch_ticket, document_id, engine:html}` | `RenderPrintDocumentDto` | `RenderResult{html, copies:1, is_roll:true, width_mm:80}` | `DispatchTicketPrintService`, `pos-order-confirmation`, `order-details-page` | `+ new format_type` | 404 antes de B.4 | `curl -X POST /render -d '{"format_type":"dispatch_ticket","document_id":1}' \| jq '.data.html \| wc -c'` | `- [ ]` |

### Database Contract Registry (19 filas)

| Id | Model / table | Columns | R/W | Tenant scoping | Migration | Consumers | Invariant | Verification | Status |
|----|---------------|---------|-----|----------------|-----------|-----------|-----------|--------------|--------|
| DB-01 | `print_templates` | `definition Json` | W | `withoutScope()` (is_system) | `20260827_add_dispatch_ticket_to_enum.sql` | `print-gateway.service.ts` | `is_system=true → organization_id IS NULL` | `SELECT enumlabel FROM pg_enum WHERE enumtypid='print_format_type_enum'::regtype` | `- [ ]` |
| DB-02 | `store_print_format_configs` | `overrides, template_id, gateway_enabled` | W | `store_id` scoped | `20260827_backfill_gateway_enabled.sql` | `print-gateway.service.ts` | `@@unique([store_id,format_type])`, `gateway_enabled` default true | `SELECT count(*) WHERE gateway_enabled=false ==0` | `- [ ]` |
| DB-03 | `print_templates` seed `dispatch_ticket` | `definition` | W | `withoutScope()` | seed `print-templates.seed.ts` | `PrintGatewayService.resolveEffectiveConfig` | definition.paper.format='thermal_80' | `SELECT definition->'paper'->>'format' FROM print_templates WHERE format_type='dispatch_ticket' AND is_system=true` | `- [ ]` |
| DB-04 | `print_templates` columns indices | `@@index` | R | none | (no change) | `listLibraryTemplates` | `is_system=true OR organization_id=$org` | `EXPLAIN SELECT * FROM print_templates WHERE format_type='dispatch_ticket'` | `- [ ]` |
| DB-05 | `store_settings` (JSON) | `receipts.print_dispatch_ticket_enabled, receipts.print_dispatch_ticket_auto_with_pos, receipts printing.dispatch_ticket.{format,copies,margin_mm}` | W | `store_id` scoped | `settings-schemas.dto.ts` validation only | `general-settings.store.ts`, `receipts-settings-form.component.ts` | `receipts` section preserved | `SELECT settings->'receipts'->>'print_dispatch_ticket_enabled' FROM store_settings WHERE store_id=5` | `- [ ]` |
| DB-06 | `orders` | `shipping_method, requires_shipping` | R | `store_id` scoped | none | `dispatch_ticket.provider.ts`, `order-details-page` | `shipping_method ∈ enum` | `SELECT shipping_method FROM orders WHERE id=123` | `- [ ]` |
| DB-07 | `order_items` | `sku, product_name, ordered_qty, dispatched_qty, variant_attributes` | R | `store_id` scoped | none | `dispatch_ticket.provider.ts` | `dispatched_qty ≤ ordered_qty` | `SELECT sku, ordered_qty, dispatched_qty FROM order_items WHERE order_id=123` | `- [ ]` |
| DB-08 | `orders.customer_address` JSON snapshot | JSON | R | `store_id` scoped | none | `dispatch_ticket.provider.ts` | non-null cuando `requires_shipping=true` | `SELECT customer_address FROM orders WHERE id=123` | `- [ ]` |
| DB-09 | `users` (customer) | `name, phone, tax_id` | R | `store_id` scoped | none | `dispatch_ticket.provider.ts` | nullable for guest | `SELECT name FROM users WHERE id=(SELECT customer_id FROM orders WHERE id=123)` | `- [ ]` |
| DB-10 | `addresses` | `line1, line2, city, department` | R | `store_id` scoped | none | `dispatch_ticket.provider.ts` | linked to customer | `SELECT * FROM addresses WHERE user_id=... LIMIT 1` | `- [ ]` |
| DB-11 | `stores` | `name, logo_s3_key, tax_id` | R | scoped | none | `dispatch_ticket.provider.ts` | non-null | `SELECT name, logo_s3_key FROM stores WHERE id=5` | `- [ ]` |
| DB-12 | `organization_settings` | `settings.fiscal_data` | R | `organization_id` scoped | none | `fiscal-issuer-identity.ts` | non-null when strict | `SELECT settings->'fiscal_data' FROM organization_settings WHERE organization_id=1` | `- [ ]` |
| DB-13 | `stock_transfers` | source/target store, items | R | `source_store_id` scoped | none | `transfer-note.provider.ts` (eliminar 501) | `idempotent` | `SELECT * FROM stock_transfers WHERE source_store_id=5 LIMIT 1` | `- [ ]` |
| DB-14 | `kitchen_tickets` | `id, modifiers, items, table_session_id` | R | `store_id` scoped | none | `kitchen-ticket.provider.ts` (eliminar 501) | `idempotent` | `SELECT * FROM kitchen_tickets WHERE store_id=5 LIMIT 1` | `- [ ]` |
| DB-15 | `invoice_profile_versions` | `config.format.template_id` | R | `store_id` scoped | none | `PrintGatewayService.resolveProfileTemplateId` | `frozen at emission` | `SELECT config->'format'->>'template_id' FROM invoice_profile_versions WHERE invoice_id=123` | `- [ ]` |
| DB-16 | `invoices` (fiscal + credit_note) | `fiscal.*, customer_address, items` | R | `store_id` scoped | none | `fiscal-invoice.provider.ts`, `fiscal-credit-note.provider.ts` | `cufe` 96 hex, `cude` válido | `SELECT cufe, customer_address FROM invoices WHERE id=123` | `- [ ]` |
| DB-17 | `dispatch_notes` | `dispatch_number, customer_address, items` | R | `store_id` scoped | none | `dispatch-note.provider.ts`, `dispatch-ticket.provider.ts` | `customer_address` snapshot | `SELECT * FROM dispatch_notes WHERE id=1` | `- [ ]` |
| DB-18 | `purchase_orders` | `id, supplier_id, items` | R | `store_id` scoped | none | `purchase-order.provider.ts` | `idempotent` | `SELECT * FROM purchase_orders WHERE store_id=5` | `- [ ]` |
| DB-19 | `store_settings` `printing.dispatch_ticket` | `format, copies, margin_mm` | W/R | `store_id` scoped | none | legacy `DocumentPrintService.print({document:'dispatch_ticket'})` fallback | `PRINT_DEFAULTS` fallback | `SELECT settings->'receipts'->'printing'->'dispatch_ticket' FROM store_settings WHERE store_id=5` | `- [ ]` |

### Error Code Registry (16 filas)

| Id | Code | HTTP | Emitted when | Frontend behavior | Message shown | Verification | Status |
|----|------|------|--------------|-------------------|---------------|--------------|--------|
| ERR-01 | `PRINT_FORMAT_NOT_FOUND_001` | 404 | `print_templates` sin `is_system` ni override | toast error | "Formato no encontrado" | `curl .../unknown_format → 404` | `- [ ]` |
| ERR-02 | `PRINT_TEMPLATE_NOT_FOUND_001` | 404 | library template id no existe | toast | "Plantilla no encontrada" | `curl /library/999 → 404` | `- [ ]` |
| ERR-03 | `PRINT_DATA_PROVIDER_MISSING_001` | 500 | formatType sin provider registrado | toast + log | "Provider no registrado" | pre-B.4: `curl .../dispatch_ticket/render → 500`; post-B.4: 200 | `- [ ]` |
| ERR-04 | `PRINT_DOCUMENT_READER_MISSING_001` | 501 | provider sin `fetchDocumentData` real (transfer/kitchen) | toast + log | "Reader no implementado" | post-B.5: `curl .../transfer_note → 200` (antes 501) | `- [ ]` |
| ERR-05 | `PRINT_FISCAL_STRUCTURE_VIOLATION_001` | 422 | custom_template fiscal sin CUFE/QR | toast + inline | "Estructura fiscal inválida" | `curl /fiscal_electronic_invoice -d '{custom_template sin fiscal.cufe}' → 422` | `- [ ]` |
| ERR-06 | `PRINT_GATEWAY_RENDER_FAILED_001` | 500 | `engine=pdf` builder error | toast | "Render PDF falló" | `curl /fiscal_electronic_invoice engine=pdf con doc inválido → 500` | `- [ ]` |
| ERR-07 | `PRINT_CONFIG_VALIDATION_001` | 422 | AJV schema violation (dispatch_ticket width_mm:0) | toast + inline | "Configuración inválida" | `curl -X PUT /dispatch_ticket -d '{overrides:{paper:{width_mm:0}}}' → 422` | `- [ ]` |
| ERR-08 | `PRINT_TOKEN_SYNTAX_001` | 422 | `{{ }}` sin balance | toast | "Sintaxis tokens inválida" | `curl -X POST /dispatch_ticket/preview -d '{custom_template:"{{ #if x }"}' → 422` | `- [ ]` |
| ERR-09 | `SYS_VALIDATION_001` | 422 | `engine=pdf` con format no soportado | toast | "PDF no soportado para formato" | `curl /sales_order_invoice engine=pdf → 422` | `- [ ]` |
| ERR-10 | `PRINT_TEMPLATE_SYSTEM_PROTECTED_001` | 403 | PUT/DELETE `print_templates.is_system=true` | toast | "Plantilla sistema protegida" | `curl -X PUT /library/1 (system=true) → 403` | `- [ ]` |
| ERR-11 | `PRINT_TEMPLATE_ACCESS_DENIED_001` | 403 | library template de otra org | toast | "Acceso denegado" | cross-tenant → 403 | `- [ ]` |
| ERR-12 | `PRINT_LIBRARY_SHARE_FORBIDDEN_001` | 403 | share no permitido | toast | "Compartir no permitido" | `curl /library/X/share` sin perm | `- [ ]` |
| ERR-13 | `PRINT_PERM_MANAGE_REQUIRED_001` | 403 | sin `store:settings:write` | toast + redirect | "Permisos insuficientes" | `curl` sin role | `- [ ]` |
| ERR-14 | `PRINT_CLONE_FAILED_001` | 409 | clone conflict | toast | "Clonar plantilla falló" | `curl /library/X/clone` con conflict | `- [ ]` |
| ERR-15 | `PRINT_PREVIEW_TIMEOUT_001` | 504 | preview >5s | toast + retry | "Preview timeout" | kill middleware, curl → 504 | `- [ ]` |
| ERR-16 | `PRINT_DOCUMENT_NOT_FOUND_001` | 404 | `dispatch_ticket` sin provider antes de B.4 | toast | "Documento no encontrado" | pre-B.4: 500; post-B.4: 200 | `- [ ]` |

## Data Integrity Plan

- **Migrations:**
  1. `20260827_add_dispatch_ticket_to_enum.sql` — `ALTER TYPE print_format_type_enum ADD VALUE IF NOT EXISTS 'dispatch_ticket'`. Header `-- DATA IMPACT: pg_enum 10→11, 0 rows, idempotent ADD VALUE`. No `CASCADE`. No `TRUNCATE`. Sin DROP.
  2. `20260827_backfill_gateway_enabled.sql` — `BEGIN; ALTER TABLE store_print_format_configs ALTER COLUMN gateway_enabled SET DEFAULT true; INSERT INTO store_print_format_configs (store_id, organization_id, format_type, is_active, gateway_enabled) SELECT id, organization_id, 'dispatch_ticket', true, true FROM stores ON CONFLICT DO NOTHING; UPDATE store_print_format_configs SET gateway_enabled=true WHERE gateway_enabled=false; COMMIT;` Patrón seguro §6.2 sin CASCADE.
  3. `20260827_add_print_constraint.sql` — `ALTER TABLE print_templates ADD CONSTRAINT print_templates_system_org_chk CHECK ((is_system=true AND organization_id IS NULL) OR (is_system=false AND organization_id IS NOT NULL)) NOT VALID` (NOT VALID para no scan).
- **Backfills:**
  - Dry-run pre-deploy: `SELECT count(*) FROM store_print_format_configs WHERE gateway_enabled=false` → N tiendas × 10 tipos. Dry-run sobre dataset representativo (no DB vacía).
  - Post-migration: `SELECT count(*) FROM store_print_format_configs WHERE format_type='dispatch_ticket'` debe igualar `SELECT count(*) FROM stores`.
- **Invariants:**
  - `CHECK (is_system=true AND organization_id IS NULL) OR (is_system=false AND organization_id IS NOT NULL)` en `print_templates`.
  - `@@unique([store_id,format_type])` en `store_print_format_configs`.
  - `dispatched_qty ≤ ordered_qty` en `order_items` (validación a nivel app provider).
- **Snapshot:** `pg_dump --table=print_templates --table=store_print_format_configs` antes del deploy.
- **Dry-run dataset:** staging local con seed `print-templates.seed.ts` + 5 stores + 50 orders + 20 dispatch_notes.
- **Idempotencia:** `ADD VALUE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `INSERT ON CONFLICT DO NOTHING`.

## Phases and Steps

### Phase A — Foundations & Contracts

#### A.1 Captura visual Hub actual + checklist gaps
   **Skills:** vendix-panel-ui, vendix-frontend-routing, vendix-prisma-scopes
   **Resources:** Playwright MCP `browser_navigate vendix.com/admin/settings/print-formats` + screenshot
   **Business decision:** El Hub actual lista 10 cards (no 11). Necesitamos foto exacta antes de B.1 para evidencia contract sweep.
   **Why:** Primero porque D.2 (Hub 11 cards) necesita baseline visual y A.3 (contract sweep) necesita URLs reales.
   **Output:** `docs/evidence/a1-hub-before.png` + lista 10 cards actuales con `format_type`.
   **Contracts touched:** none (read-only inspection)
   **Data impact:** none
   **Blast radius:** none (read-only)
   **Rollback:** none (no changes)
   **Verification:** `ls docs/evidence/a1-hub-before.png` size > 0
   **Acceptance checklist:**
   - [ ] Playwright screenshot Hub actual capturado en `docs/evidence/a1-hub-before.png`
   - [ ] Lista 10 `format_type` confirmados via `curl /store/print-formats | jq '.data[].format_type'`
   - [ ] 0 archivos modificados por A.1
   **Status:** pending

#### A.2 Inventario 36 puntos impresión + matriz `PRINT_DOCUMENT → print_format_type_enum`
   **Skills:** vendix-backend, vendix-frontend, vendix-core
   **Resources:** `grep -R "window.print\|printViaGateway\|print({document:" apps --include="*.ts" | grep -v spec | wc -l`
   **Business decision:** Mapeo 35→36 (dispatch_ticket añadido) confirma que `dispatch_ticket` queda en legacy sin provider.
   **Why:** Antes de B para saber qué scope tocar.
   **Output:** `docs/evidence/a2-print-points.md` con tabla 36 puntos y `DispatchTicketPrintService` como nuevo entry.
   **Contracts touched:** none
   **Data impact:** none
   **Blast radius:** none
   **Rollback:** none
   **Verification:** `wc -l docs/evidence/a2-print-points.md` >= 100 líneas
   **Acceptance checklist:**
   - [ ] Tabla 36 puntos (35 + dispatch_ticket nuevo) escrita
   - [ ] Cada fila con archivo:línea y gateway/legacy/direct status
   - [ ] `DispatchTicketPrintService` declarado como nuevo en column "Planned"
   **Status:** pending

#### A.3 Contract sweep registry FB-01..23 / DB-01..19 / ERR-01..16
   **Skills:** vendix-backend-api, vendix-validation, vendix-prisma-scopes, vendix-error-handling
   **Resources:** `curl -H "Authorization: Bearer $TOK" -H 'x-store-id: 5' http://localhost:3000/api/...`
   **Business decision:** Verificar cada `FB-*` contra respuesta live antes de Phase B.
   **Why:** Phase 2 precede design on purpose — design sin registry es fiction.
   **Output:** `docs/evidence/fb-{01..23}.txt` con `jq keys` vs interfaz declarada.
   **Contracts touched:** FB-01..23 (regression baseline)
   **Data impact:** none
   **Blast radius:** if wrong, B.1 migra sobre contrato desconocido
   **Rollback:** none
   **Verification:** 23 archivos `fb-*.txt` con `jq` exit 0
   **Acceptance checklist:**
   - [ ] FB-01..07 creados y `jq` exit 0
   - [ ] FB-08..16 creados (incluyendo FB-14 PUT library/:id → expected 404 hasta D.9)
   - [ ] FB-17..23 creados (incluyendo FB-23 dispatch_ticket render)
   - [ ] DB-01..19 verificados con SELECT
   - [ ] ERR-01..16 verificados con curl provocando error
   **Status:** pending

#### A.4 Taxonomía `PrintFormatDefinition v2` + JSON Schema AJV
   **Skills:** vendix-validation, vendix-prisma-schema, vendix-naming-conventions
   **Resources:** AJV draft-07, `apps/backend/src/domains/store/print-formats/interfaces/print-format.interface.ts`
   **Business decision:** `definition.v=2` con `paper.margin_top/right/bottom/left_mm`, `logo {url, position, size_mm, opacity}`, `company_block {fields[]}`, `styles` por sección. AJV schema `definition-v2.schema.json` valida en DTO.
   **Why:** Antes de B.1 para que el seed `dispatch_ticket` ya use v2 y B.4 provider valide con AJV.
   **Output:** `apps/backend/src/domains/store/print-formats/schemas/definition-v2.schema.json` + tests.
   **Contracts touched:** FB-03 (DTO `overrides` ahora validado por AJV)
   **Data impact:** 0 rows (schema-only)
   **Blast radius:** if wrong, save falla 422 esperado → 500
   **Rollback:** `git revert` schema
   **Verification:** `npx ajv validate -s definition-v2.schema.json -d sample.json` exit 0
   **Acceptance checklist:**
   - [ ] `definition-v2.schema.json` creado con 11 format_type permitidos (incluyendo dispatch_ticket)
   - [ ] `paper.margin_top_mm` opcional pero si presente ∈ [0,50]
   - [ ] `logo.url` opcional string URL
   - [ ] `columns.width_percent` total ===100 constraint
   - [ ] Test unit `print-format-definition-v2.spec.ts` con 4 casos (válido, width overflow, margin >50, format inválido)
   **Status:** pending

#### A.5 Biblioteca paginada + bulk activate design
   **Skills:** vendix-backend-api, vendix-bulk-operations, vendix-pagination
   **Resources:** `PrintFormatsService.listLibraryTemplates` (current no pagination)
   **Business decision:** `GET /library?take=20&skip=0&format_type=dispatch_ticket` con `total` count. `POST /bulk/activate {format_types:[...]}` para onboarding.
   **Why:** Antes de B porque `library.controller` debe aceptar paginación + bulk.
   **Output:** DTO `LibraryListDto + BulkActivateDto`. Tests.
   **Contracts touched:** FB-11, FB-17 (new), FB-22 (refactor pagination)
   **Data impact:** none
   **Blast radius:** if wrong, library 500 en orgs con 100+ templates
   **Rollback:** `git revert`
   **Verification:** `curl /library?take=5&skip=0 | jq '.data | length <=5'` y `.meta.total`
   **Acceptance checklist:**
   - [ ] DTO `LibraryListDto` con `take @Min(1) @Max(100), skip @Min(0), format_type?, search?`
   - [ ] DTO `BulkActivateDto` con `format_types: string[] @ArrayMaxSize(100)`
   - [ ] `PrintFormatsService.listLibraryTemplates(orgId, formatType?, take, skip, search?)` con `findMany` paginado + count
   - [ ] `POST /bulk/activate` controller + permission `store:settings:write`
   - [ ] Tests con dataset 100 templates
   **Status:** pending

### Phase B — Backend Hub + dispatch_ticket

#### B.1 Migration `ADD VALUE 'dispatch_ticket'` a enum
   **Skills:** vendix-prisma-migrations, vendix-prisma-schema
   **Resources:** `prisma/migrations/20260827_add_dispatch_ticket_to_enum/migration.sql`
   **Business decision:** Idempotent `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'dispatch_ticket'`. Sin DROP ni CASCADE.
   **Why:** Primero del backend porque enum seed provider DTO frontend dependen de este valor.
   **Output:** Migration file ejecutable + dry-run success.
   **Contracts touched:** FB-01..23 (enum ampliada)
   **Data impact:** 0 rows (pg_enum)
   **Blast radius:** if wrong, DTO enum Prisma falla 400 en runtime
   **Rollback:** irreversible (pg_enum ADD VALUE) — requiere crear nuevo enum y migrate (costly)
   **Verification:** `psql -c "SELECT enumlabel FROM pg_enum WHERE enumtypid='print_format_type_enum'::regtype ORDER BY enumsortorder"` debe listar `dispatch_ticket`
   **Acceptance checklist:**
   - [ ] Migration file `20260827_add_dispatch_ticket_to_enum/migration.sql` con header `-- DATA IMPACT:` documentando 0 rows
   - [ ] `IF NOT EXISTS` para idempotencia
   - [ ] `prisma migrate dev` exit 0
   - [ ] `prisma migrate status` exit 0
   - [ ] `npx prisma generate` regenera `@prisma/client` con nuevo valor
   - [ ] Test manual `SELECT enum_unnest(enum_range(NULL::print_format_type_enum))` incluye `dispatch_ticket`
   **Status:** pending

#### B.2 Seed `SYSTEM_PRINT_TEMPLATES.dispatch_ticket` thermal_80 courier mono
   **Skills:** vendix-prisma-seed, vendix-prisma-migrations
   **Resources:** `apps/backend/prisma/seeds/print-templates.seed.ts`
   **Business decision:** Definición JSON courier mono 9pt: `paper {thermal_80, 80mm, roll, margin_mm:0, copies:1}`, `styles {font_family:'Courier New', font_size_base_pt:9, primary_color:'#000', header_alignment:'center', show_borders:true, compact_mode:true}`, `sections [header, customer_info, items_table, footer]`.
   **Why:** Necesario para B.3 ALL_FORMAT_TYPES y B.4 provider (resolveEffectiveConfig fallback system).
   **Output:** Seed upsert `is_system=true AND format_type='dispatch_ticket'`.
   **Contracts touched:** DB-03
   **Data impact:** 1 row INSERT en `print_templates` (idempotent on re-seed)
   **Blast radius:** if wrong, gateway render `dispatch_ticket` sin secciones
   **Rollback:** `DELETE FROM print_templates WHERE format_type='dispatch_ticket' AND is_system=true`
   **Verification:** `SELECT definition->'paper'->>'format' FROM print_templates WHERE format_type='dispatch_ticket' AND is_system=true` = 'thermal_80'
   **Acceptance checklist:**
   - [ ] `SYSTEM_PRINT_TEMPLATES.dispatch_ticket` añadido al array
   - [ ] `seedPrintTemplates` upsert idempotente
   - [ ] `npm run seed` exit 0
   - [ ] `SELECT` confirma 1 row con `format_type='dispatch_ticket' AND is_system=true`
   **Status:** pending

#### B.3 `ALL_FORMAT_TYPES` + `FORMAT_TYPE_METADATA` + Registry + `PrintFormatTypeEnum`
   **Skills:** vendix-backend-domain, vendix-naming-conventions
   **Resources:** `apps/backend/src/domains/store/print-formats/services/print-formats.service.ts:17 ALL_FORMAT_TYPES`, `:30 FORMAT_TYPE_METADATA`, `enums/print-format.enum.ts`
   **Business decision:** `'dispatch_ticket'` añadido a las 3 listas con `category:'Logística', icon:'package', engine:'html'`.
   **Why:** Antes de B.4 (provider) para que Registry lo registre y catálogo responda 11.
   **Output:** `GET /store/print-formats` con 11 cards.
   **Contracts touched:** FB-01, FB-02
   **Data impact:** none
   **Blast radius:** if wrong, hub frontend no muestra `dispatch_ticket`
   **Rollback:** `git revert` array add
   **Verification:** `curl /store/print-formats | jq '.data | length == 11'` + `'any(.format_type == "dispatch_ticket")'`
   **Acceptance checklist:**
   - [ ] `ALL_FORMAT_TYPES` 10→11 elementos
   - [ ] `FORMAT_TYPE_METADATA.dispatch_ticket = {name:'Tiquete de Despacho', category:'Logística', icon:'package', engine:'html'}`
   - [ ] `PrintFormatTypeEnum` en `enums/print-format.enum.ts` incluye `'dispatch_ticket'`
   - [ ] `DocumentDataProviderRegistry` registrado en `print-formats.module.ts onModuleInit`
   - [ ] `Get` log `"Registered provider: dispatch_ticket"`
   **Status:** pending

#### B.4 `DispatchTicketDataProvider` (lectura `orders` + `customer_address`)
   **Skills:** vendix-backend-domain, vendix-multi-tenant-context, vendix-prisma-scopes
   **Resources:** `apps/backend/src/domains/store/print-formats/providers/dispatch-ticket.provider.ts`
   **Business decision:** `formatType='dispatch_ticket'`. `fetchDocumentData(storeId, documentId)` lee `orders` + `order_items` + `users` + `addresses` + `stores`. Sin totales fiscales, sin CUFE. `getAvailableTokens` 6 tokens: `document.number`, `customer.name`, `customer.address.line1`, `customer.address.line2`, `items.sku`, `items.product_name`, `items.ordered_qty`, `items.dispatched_qty`. `getSampleData` orden dummy `DISP-2026-0001`.
   **Why:** Necesario para que `POST /render {dispatch_ticket, 1}` devuelva 200. Elimina ERR-16 / ERR-03.
   **Output:** Provider funcional + tests.
   **Contracts touched:** FB-23, DB-06..11
   **Data impact:** none (read-only)
   **Blast radius:** if wrong, render falla 500 en producción
   **Rollback:** `git revert` provider + unregister
   **Verification:** `curl -X POST .../render -d '{"format_type":"dispatch_ticket","document_id":1}' | jq '.data.html | contains("Cant. despachada")'` exit 0
   **Acceptance checklist:**
   - [ ] Provider creado + registrado en `print-formats.module.ts`
   - [ ] `fetchDocumentData` con `documentId: number|string` (mismo signature que otros)
   - [ ] `Number.isInteger` check (mantiene consistencia con `pos-sale-ticket.provider.ts`)
   - [ ] `getAvailableTokens` array con 8 tokens
   - [ ] `getSampleData` completo con 3 items
   - [ ] `real-print-path.spec.ts` extendido con caso `dispatch_ticket`
   - [ ] ERR-16 desaparece: `curl /render dispatch_ticket → 200` (antes 500)
   **Status:** pending

#### B.5 `PrintLayoutComposer.renderDispatchTicketSection` + `DISPATCH_TICKET_PRINT_STYLES`
   **Skills:** vendix-backend-domain, vendix-fiscal-scope
   **Resources:** `apps/backend/src/domains/store/print-formats/services/print-layout-composer.service.ts`
   **Business decision:** Composer nuevo método `renderDispatchTicketSection(section, data)`: header (logo store, nombre, fecha, número orden), bloque cliente (nombre + dirección 2 líneas + ciudad/departamento), tabla 4 cols `#|SKU/Descripción|Cant.pedida|Cant.despachada`, footer (Despachado por + firma). Sin totales, sin QR. `wrapInHtmlDocument` con `@page { size: 80mm auto; margin: 0 }`.
   **Why:** Antes de D.9 frontend service para que HTML sea el canónico.
   **Output:** Composer nuevo método + tests.
   **Contracts touched:** FB-04, FB-23
   **Data impact:** none
   **Blast radius:** if wrong, HTML preview vacío
   **Rollback:** `git revert`
   **Verification:** `curl /dispatch_ticket/preview | jq '.data.html | contains("Cant. despachada")'`
   **Acceptance checklist:**
   - [ ] `renderDispatchTicketSection` añadido al switch del composer
   - [ ] `wrapInHtmlDocument` con CSS courier mono 9pt
   - [ ] `DISPATCH_TICKET_PRINT_STYLES` export const (sin `@page`, lo inyecta `wrapInHtmlDocument`)
   - [ ] Tests composer con dataset dummy
   - [ ] HTML contiene: `# | SKU | Cant.pedida | Cant.despachada` y `<header>` con logo+store.name
   **Status:** pending

#### B.6 `PrintFiscalValidator` `dispatch_ticket` no-fiscal
   **Skills:** vendix-fiscal-scope, vendix-tax-typing
   **Resources:** `apps/backend/src/domains/store/print-formats/services/print-fiscal-validator.service.ts`
   **Business decision:** `dispatch_ticket` añadido a lista NO-fiscal. Solo `fiscal_electronic_invoice` y `fiscal_credit_note` exigen CUFE/QR/fiscal_header.
   **Why:** Evita falso positivo al validar `dispatch_ticket` con custom_template sin `fiscal.cufe`.
   **Output:** Función `assertFiscalCompliance` refactorizada con lista explícita de fiscal vs.
   **Contracts touched:** ERR-05 (solo para fiscales)
   **Data impact:** none
   **Blast radius:** if wrong, dispatch_ticket con custom_template vacío lanza 422 falso
   **Rollback:** `git revert`
   **Verification:** `curl -X POST /dispatch_ticket/preview -d '{"overrides":{"custom_template":"{{ store.name }}"}' | jq '.data.html | length > 0'`
   **Acceptance checklist:**
   - [ ] `FISCAL_FORMATS = ['fiscal_electronic_invoice', 'fiscal_credit_note']` constant export
   - [ ] `assertFiscalCompliance(formatType, definition)` short-circuit si `!FISCAL_FORMATS.includes(formatType)`
   - [ ] Test: `dispatch_ticket` con custom_template sin fiscal.cufe → exit 0 (200)
   - [ ] Test: `fiscal_electronic_invoice` con custom_template sin fiscal.cufe → 422 ERR-05
   **Status:** pending

#### B.7 `PrintTemplateCompiler` DOMPurify + `validateSyntax` AST + `money` helper
   **Skills:** vendix-backend, vendix-prisma
   **Resources:** `apps/backend/src/domains/store/print-formats/services/print-template-compiler.service.ts`, `npm install isomorphic-dompurify`
   **Business decision:** DOMPurify reemplcha regex `on`. `money` helper 2 decimales exact. `validateSyntax` AST-style parsea `{{#each}}` balance.
   **Why:** Antes de D.9 para que preview frontend reciba HTML sanitizado.
   **Output:** `compile()` con DOMPurify + tests.
   **Contracts touched:** ERR-08
   **Data impact:** none
   **Blast radius:** if wrong, XSS via `custom_template` raw
   **Rollback:** `git revert` + uninstall
   **Verification:** `curl -X POST /dispatch_ticket/preview -d '{"overrides":{"custom_template":"{{{<script>alert(1)</script>}}}' | jq '.data.html | contains("&lt;script&gt;")'`
   **Acceptance checklist:**
   - [ ] `npm install isomorphic-dompurify` exit 0
   - [ ] `sanitizeHtml` reemplaza regex por `DOMPurify.sanitize(html, {ALLOWED_TAGS:[...]})`
   - [ ] `money` helper: `Number(rawVal).toLocaleString('es-CO', {minimumFractionDigits:2, maximumFractionDigits:2})`
   - [ ] Test: payload XSS → HTML sanitizado
   - [ ] Test: `{{{ 5355000.5 }}}` → `$5.355.000,50` (2 decimales)
   **Status:** pending

### Phase C — Persistence + Settings

#### C.1 Migración `gateway_enabled default true` + backfill + nueva fila `dispatch_ticket`
   **Skills:** vendix-prisma-migrations, vendix-prisma-scopes
   **Resources:** `prisma/migrations/20260827_backfill_gateway_enabled/migration.sql`
   **Business decision:** Migration idempotente: `ALTER TABLE store_print_format_configs ALTER COLUMN gateway_enabled SET DEFAULT true`. Backfill: `INSERT INTO store_print_format_configs (...) SELECT ... FROM stores WHERE NOT EXISTS (...)`. Pattern §6.2 sin CASCADE.
   **Why:** Onboarding: tienda nueva 0 clicks para cubrir todos los 11 tipos.
   **Output:** Migration ejecutada + DB-02 invariant verificado.
   **Contracts touched:** DB-02, FB-01
   **Data impact:** N tiendas ×11 filas nuevas (dispatch_ticket) + N×11 UPDATE gateway_enabled=true. Dry-run pre-deploy.
   **Blast radius:** if wrong, todas las tiendas gateway OFF → no imprime nada vía gateway
   **Rollback:** `UPDATE store_print_format_configs SET gateway_enabled=false; DELETE WHERE format_type='dispatch_ticket';` (manual, pre-feature-flag)
   **Verification:** `SELECT count(*) FROM store_print_format_configs WHERE gateway_enabled=false` = 0 + `count(*) WHERE format_type='dispatch_ticket'` = `count(*) FROM stores`
   **Acceptance checklist:**
   - [ ] Migration con header `-- DATA IMPACT:` documentando N×11 filas + N×11 UPDATE
   - [ ] Patrón seguro sin DROP/TRUNCATE/CASCADE
   - [ ] `INSERT ON CONFLICT DO NOTHING` para idempotencia
   - [ ] `prisma migrate deploy` exit 0
   - [ ] Test post-migration `count(*) gateway_enabled=false =0`
   - [ ] Snapshot `pg_dump` pre-migration tomado en `keys/prod-snapshots/20260827.sql.gz`
   **Status:** pending

#### C.2 Settings `print_dispatch_ticket_*` + AJV + `PrintingDtoCoversEveryDocument`
   **Skills:** vendix-settings-system, vendix-validation, vendix-backend-api
   **Resources:** `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts:749 ReceiptsSettings`, `settings-schemas.dto.ts`
   **Business decision:** Añadir a `ReceiptsSettings`: `print_dispatch_ticket_enabled?: boolean` (default true) + `print_dispatch_ticket_auto_with_pos?: boolean` (default false). Plano bajo `receipts` (no anidado en `printing`) para no ser dropeado por `KNOWN_SECTIONS`.
   **Why:** Necesario para que E.1/E.2 lean setting y guard dispare.
   **Output:** Interface + DTO + AJV validation + `PrintingDtoCoversEveryDocument` compile-time check pasa.
   **Contracts touched:** FB-06, FB-07, DB-05
   **Data impact:** 0 rows initially (defaults via `mergeStoreSettingsWithDefaults`)
   **Blast radius:** if wrong, `PATCH /settings` dropea campos silenciosamente
   **Rollback:** `git revert`
   **Verification:** `curl -X PATCH /store/settings -d '{"receipts":{"print_dispatch_ticket_enabled":true,"print_dispatch_ticket_auto_with_pos":true}}' | jq '.data.receipts.print_dispatch_ticket_enabled'`
   **Acceptance checklist:**
   - [ ] `ReceiptsSettings.print_dispatch_ticket_enabled?: boolean` añadido (con `// ADR-7` comment)
   - [ ] `ReceiptsSettings.print_dispatch_ticket_auto_with_pos?: boolean` añadido
   - [ ] DTO `@IsOptional @IsBoolean()` validation
   - [ ] `defaults/default-store-settings.ts` setea defaults
   - [ ] `PATCH /store/settings` con los 2 campos → 200
   - [ ] Frontend mirror en `apps/frontend/src/app/core/models/store-settings.interface.ts`
   - [ ] Compile-time check `Exclude<PrintDocument, keyof PrintingSettingsDto>` unchanged (estos campos no son `PrintDocument`, van a nivel receipts)
   **Status:** pending

#### C.3 `receipts-settings-form.component.ts` sección "Impresión encadenada" + UI
   **Skills:** vendix-angular-forms, vendix-zoneless-signals, vendix-frontend-icons
   **Resources:** `apps/frontend/src/app/private/modules/store/settings/general/components/receipts-settings-form/receipts-settings-form.component.ts`
   **Business decision:** Nueva card/sección "Impresión encadenada" con 2 toggles: `dispatch_ticket_enabled` (default true) + `dispatch_ticket_auto_with_pos` (default false). Ambos con tooltip explicando efecto. Hidden si store no tiene `shipping_method` activo.
   **Why:** UI para que admin active/desactive setting.
   **Output:** Sección visible en `/admin/settings/general#section-receipts`.
   **Contracts touched:** FB-06, FB-07
   **Data impact:** none
   **Blast radius:** if wrong, store no puede cambiar setting
   **Rollback:** `git revert`
   **Verification:** Playwright `browser_navigate vendix.com/admin/settings/general` → section "Impresión encadenada" visible
   **Acceptance checklist:**
   - [ ] 2 nuevos FormControls con `nonNullable` + signals
   - [ ] `onSettingsChange` emite con `receipts.{...2 campos}`
   - [ ] Tooltip icons `<app-icon name="info">` con descripción
   - [ ] Disabled si store no tiene shipping
   - [ ] E2E: cambiar toggle → save → reload → persistido
   **Status:** pending

### Phase D — Frontend Hub + DispatchTicketPrintService

#### D.1 `PrintFormatType` union + `PrintGatewayClientService` tipado
   **Skills:** vendix-naming-conventions, vendix-typescript
   **Resources:** `apps/frontend/src/app/core/models/print-formats.model.ts:1-11`, `shared/services/print/print-gateway-client.service.ts`
   **Business decision:** Añadir `'dispatch_ticket'` al union `PrintFormatType`. Tipar `renderDocument/preview/getFormatDetail/updateFormat/activateGateway/...` con nuevo valor.
   **Why:** Antes de D.2 para que Hub renderice 11 cards.
   **Output:** `tsc --noEmit` exit 0.
   **Contracts touched:** FB-01..23 (tipado frontend)
   **Data impact:** none
   **Blast radius:** if wrong, frontend compila con union incompleto → runtime error
   **Rollback:** `git revert`
   **Verification:** `cd apps/frontend && npx tsc --noEmit` exit 0
   **Acceptance checklist:**
   - [ ] `PrintFormatType` 10→11 con `dispatch_ticket`
   - [ ] `StorePrintFormatSummary` interface acepta `format_type: PrintFormatType`
   - [ ] Todos los métodos `PrintGatewayClientService` aceptan `dispatch_ticket`
   - [ ] `PrintFormatsFacade` filter reconoce nuevo tipo
   - [ ] Mobile mirror `apps/mobile/src/shared/print/print-formats.ts` mismo cambio
   **Status:** pending

#### D.2 Hub rediseñado con 11 cards (Logística 3) + thumbnails + bulk
   **Skills:** vendix-frontend-standard-module, vendix-zoneless-signals, vendix-frontend-icons
   **Resources:** `apps/frontend/src/app/private/modules/store/settings/print-formats/print-formats-hub.component.ts`
   **Business decision:** Hub 11 cards. Categoría "Logística" agrupa `dispatch_ticket`, `dispatch_note`, `dispatch_route`. Miniaturas (placeholder icon + category badge). Bulk activate visible per categoria.
   **Why:** Para que admin vea el nuevo `dispatch_ticket` en el Hub.
   **Output:** Hub con 11 cards + sección Logística.
   **Contracts touched:** FB-01
   **Data impact:** none
   **Blast radius:** if wrong, admin no encuentra `dispatch_ticket` en UI
   **Rollback:** `git revert`
   **Verification:** Playwright `browser_navigate vendix.com/admin/settings/print-formats` → 11 cards visibles
   **Acceptance checklist:**
   - [ ] Hub renderiza 11 cards
   - [ ] Categoría Logística muestra 3 formatos agrupados
   - [ ] Click `dispatch_ticket` → editor abre con detail
   - [ ] Miniaturas placeholder (icon `package` + category)
   - [ ] `console.log` residual removido (L192)
   **Status:** pending

#### D.3 `PrintSectionsEditor` drag&drop + CRUD + validación fiscal
   **Skills:** vendix-zoneless-signals, vendix-frontend-component
   **Resources:** `@angular/cdk/drag-drop` import
   **Business decision:** Reemplazar chevron-up/down con `cdkDropList`. Añadir botones "Añadir sección custom", "Eliminar", "Duplicar". Validación inline si fiscal → 5 secciones obligatorias no removibles.
   **Why:** Editor enriquecido profesional.
   **Output:** Editor con drag&drop funcional.
   **Contracts touched:** FB-03, DB-01
   **Data impact:** none
   **Blast radius:** if wrong, save falla 422
   **Rollback:** `git revert`
   **Verification:** Playwright drag `totals_summary` de pos 7→3 en `fiscal_electronic_invoice` → save → 200
   **Acceptance checklist:**
   - [ ] `cdkDropList` + `cdkDrag` wired
   - [ ] CRUD: add/remove/duplicate section
   - [ ] Fiscal `fiscal_*` lock 5 sections (header, cufe_box, qr_section, items_table, totals_summary)
   - [ ] Track by `id` consistente con backend
   **Status:** pending

#### D.4 `PrintLogoEditor` upload S3 + position/size/opacity
   **Skills:** vendix-s3-storage, vendix-zoneless-signals
   **Resources:** `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-logo-editor/`
   **Business decision:** Nuevo editor. Upload S3 `logos/{store_id}/{format_type}-{hash}.png`. Posiciones: `left/center/right/full`. Size 10-80mm. Opacity 0-100%.
   **Why:** Editor enriquecido profesional.
   **Output:** Componente nuevo + tab en editor.
   **Contracts touched:** FB-03 (overrides.logo), DB-11
   **Data impact:** S3 upload 1 archivo por save
   **Blast radius:** if wrong, logo perdido en S3
   **Rollback:** `git revert` + S3 cleanup script
   **Verification:** Playwright upload `logo.png` → preview muestra logo
   **Acceptance checklist:**
   - [ ] Componente `print-logo-editor.component.ts` creado
   - [ ] S3 service integration con `vendix-s3-storage` pattern
   - [ ] 4 posiciones + size/opacity controls
   - [ ] Save → `overrides.logo={url, position, size_mm, opacity}` en PUT
   - [ ] Preview renderiza `<img>` con dimensiones correctas
   **Status:** pending

#### D.5 `PrintCompanyEditor` toggles NIT/DV/régimen/dirección/tel/email/web/QR
   **Skills:** vendix-zoneless-signals, vendix-frontend-icons
   **Resources:** `apps/frontend/src/app/private/modules/store/settings/print-formats/components/print-company-editor/`
   **Business decision:** Nuevo editor. 8 toggles para campos fiscales empresa. Custom label opcional por campo.
   **Why:** Info empresa granular configurable.
   **Output:** Componente nuevo + tab.
   **Contracts touched:** FB-03 (overrides.company_block), DB-11/12
   **Data impact:** none
   **Blast radius:** if wrong, fiscal pierde NIT
   **Rollback:** `git revert`
   **Verification:** Playwright toggle `phone off` → preview sin `store.phone`
   **Acceptance checklist:**
   - [ ] 8 toggles con labels
   - [ ] Custom label opcional
   - [ ] Preview renderiza solo campos activos
   - [ ] Fiscal `fiscal_electronic_invoice` lock NIT + DV + dirección
   **Status:** pending

#### D.6 `PrintPaperEditor` margins 4 lados + orientation + custom W×H
   **Skills:** vendix-zoneless-signals
   **Resources:** `print-styles-editor.component.ts` refactor o nuevo
   **Business decision:** Refactor styles editor: split paper vs typography. Paper: 4 inputs margin_top/right/bottom/left_mm + orientation portrait/landscape + custom_width_mm + custom_height_mm.
   **Why:** Márgenes por lado + custom tamaños.
   **Output:** Editor separado.
   **Contracts touched:** FB-03, FB-18
   **Data impact:** none
   **Blast radius:** if wrong, save falla 422
   **Rollback:** `git revert`
   **Verification:** Playwright margin 10/10/15/10 en letter → preview refleja
   **Acceptance checklist:**
   - [ ] 4 margin inputs con `@Min(0) @Max(50)` validation
   - [ ] Orientation select
   - [ ] Custom W×H inputs (custom_format='custom' enum value)
   - [ ] `widthMap` corregido: half_letter 216mm (era 140)
   - [ ] `PRINT_PAGE_GEOMETRY.half_letter.width_mm = 216` en backend
   **Status:** pending

#### D.7 `PrintColumnsEditor` reorder + format + totalWidth===100 bloqueante
   **Skills:** vendix-zoneless-signals
   **Resources:** `print-columns-editor.component.ts`
   **Business decision:** Chevron reorder columns. Format selector `text|number|currency|percent`. Save bloquea si `totalWidth !==100`.
   **Why:** Editor enriquecido + validación.
   **Output:** Editor con reorder + format + bloqueante.
   **Contracts touched:** FB-03, ERR-07
   **Data impact:** none
   **Blast radius:** if wrong, columns desbordadas
   **Rollback:** `git revert`
   **Verification:** Playwright width 60+60 → save → toast error 422
   **Acceptance checklist:**
   - [ ] Chevron up/down reorder columns
   - [ ] Format selector por column
   - [ ] Save bloquea si totalWidth !==100 con toast
   - [ ] Display `Total: 100%` highlight verde/rojo
   **Status:** pending

#### D.8 `PrintLivePreview` fiel DPI + engine:pdf toggle + sampleDocumentId selector
   **Skills:** vendix-zoneless-signals, vendix-frontend-icons
   **Resources:** `print-live-preview.component.ts`
   **Business decision:** DPI real (3.78 para mm→px). `engine:pdf` toggle genera PDF preview. `sampleDocumentId` selector dropdown con últimos 5 docs. Paginación visual para hojas. Single `srcdoc` (sin doble render).
   **Why:** Preview fiel 1:1.
   **Output:** Preview componente refactor.
   **Contracts touched:** FB-04, FB-18
   **Data impact:** none
   **Blast radius:** if wrong, preview distorsiona
   **Rollback:** `git revert`
   **Verification:** Playwright `thermal_58` → 219px (no 300px), `letter` vs `a4` distintos, paginación visible
   **Acceptance checklist:**
   - [ ] DPI 3.78 aplicado para todos los formatos
   - [ ] `thermal_58` exacto 219px (no Math.max 300px)
   - [ ] Engine:pdf toggle con iframe `application/pdf`
   - [ ] SampleDocumentId dropdown con últimos 5 orders/dispatches del store
   - [ ] Single render (sin doble `srcdoc + doc.write`)
   - [ ] Paginación visual para hojas (`page-break-after: always`)
   **Status:** pending

#### D.9 `DispatchTicketPrintService` + `DISPATCH_TICKET_STYLES` + OrderDispatchTicketData mapper
   **Skills:** vendix-frontend, vendix-zoneless-signals
   **Resources:** `apps/frontend/src/app/private/modules/store/dispatch-ticket/services/dispatch-ticket-print.service.ts`
   **Business decision:** Servicio inyectable. `printDispatchTicket(order: Order, trigger: 'automatic'|'explicit', copies?: number)` delega en `documentPrint.print({document:'dispatch_ticket', body:buildBody(order), title:'Despacho #'+order.order_number, styles:DISPATCH_TICKET_STYLES, trigger})`. Mapper `OrderDispatchTicketData` extrae `customer.name/address.line1/line2/city/department`, `items[].sku/product_name/ordered_qty/dispatched_qty`. CSS courier mono 9pt sin `@page`.
   **Why:** Servicio canónico para los 2 disparadores (POS auto + orden manual).
   **Output:** Servicio funcional + tests.
   **Contracts touched:** FB-23, DB-06..11
   **Data impact:** none
   **Blast radius:** if wrong, `dispatch_ticket` no imprime
   **Rollback:** `git revert`
   **Verification:** unit test `printDispatchTicket mock order` → `documentPrint.print` llamado con `document:'dispatch_ticket', body con SKU, trigger explicit`
   **Acceptance checklist:**
   - [ ] `DispatchTicketPrintService` injectable `providedIn: 'root'`
   - [ ] Mapper `OrderDispatchTicketData` con interface tipada
   - [ ] `buildBody(order)` retorna HTML con header + customer + items table + footer
   - [ ] `DISPATCH_TICKET_STYLES` constante courier mono 9pt sin `@page`
   - [ ] Trigger parameter respetado (automatic honra copies:0)
   - [ ] Tests unit con Vitest mock `DocumentPrintService`
   **Status:** pending

### Phase E — Enlace Universal + 2 Disparadores

#### E.1 POS Auto: `pos-order-confirmation maybeAutoPrint()` encadenado
   **Skills:** vendix-zoneless-signals, vendix-frontend
   **Resources:** `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts:771 maybeAutoPrint()`
   **Business decision:** Post `await ticketService.printTicket(...)` resuelto, si guard pasa → `await dispatchTicketPrint.printDispatchTicket(order, 'automatic')`. Guard: `storeSettings.receipts()?.print_dispatch_ticket_enabled && print_dispatch_ticket_auto_with_pos && (orderData.isShippingSale || checkoutIntent()==='delivery') && order.shipping_method !== 'direct_delivery'`. No bloquea CTA "Nueva compra".
   **Why:** Disparador 1 (POS auto con ticket POS/factura).
   **Output:** Disparador funcional con guard.
   **Contracts touched:** FB-23, FB-05
   **Data impact:** none
   **Blast radius:** if wrong, despacho imprime no deseado
   **Rollback:** `PATCH /settings {"receipts":{"print_dispatch_ticket_enabled":false}}` o `PRINT_DISPATCH_TICKET_ROLLOUT=false` feature flag
   **Verification:** Playwright POS delivery → autoPrint POS + despacho 1 copia
   **Acceptance checklist:**
   - [ ] Guard implementada en `maybeAutoPrint`
   - [ ] No bloquea CTA Nueva compra (signal `isPrintingDispatch` aparte)
   - [ ] Setting false no imprime
   - [ ] `copies:0` honorado (no imprime automatic)
   - [ ] `direct_delivery` skip
   - [ ] Audit `scripts/print-audit.sh` sin `iframe`/`window.print` nuevo
   **Status:** pending

#### E.2 POS Manual: `pos-order-confirmation printReceipt()` + `pos.component onPaymentCompleted/onShippingCompleted`
   **Skills:** vendix-zoneless-signals, vendix-frontend
   **Resources:** `apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation.component.ts:793 printReceipt()` + `pos.component.ts:2398/3366`
   **Business decision:** Misma guard que E.1. Manual explicit `Math.max(1, copies)` clampa.
   **Why:** Disparador 1 manual.
   **Output:** Encadenado manual.
   **Contracts touched:** FB-23, FB-05
   **Data impact:** none
   **Blast radius:** same as E.1
   **Rollback:** same as E.1
   **Verification:** Playwright click "Imprimir" → 2 papeles secuenciales (POS + despacho)
   **Acceptance checklist:**
   - [ ] `printReceipt()` post-print encadena `printDispatchTicket(order, 'explicit')`
   - [ ] `pos.component onPaymentCompleted` y `onShippingCompleted` ambos encadenan
   - [ ] Misma guard
   - [ ] Secuencial (no paralelo) para no saturar cola impresoras
   **Status:** pending

#### E.3 Orden Detalle: `headerActions` + `card Gestión de Envío` botón `e-ticket de envío`
   **Skills:** vendix-frontend-sticky-header, vendix-zoneless-signals, vendix-frontend-icons
   **Resources:** `apps/frontend/src/app/private/modules/store/orders/pages/order-details/order-details-page.component.ts:1083 headerActions`, `:732-991 Gestión de Envío card`
   **Business decision:** `headerActions += {id:'print-dispatch-ticket', label:'e-ticket de envío', icon:'package', variant:'ghost'}`. Handler `await dispatchTicketPrint.printDispatchTicket(order, 'explicit')`. Card Gestión de Envío botón secundario debajo de "Cambiar". Ambos ocultos si `order.shipping_method === 'direct_delivery'`.
   **Why:** Disparador 2 manual desde orden.
   **Output:** 2 botones (header + card).
   **Contracts touched:** FB-19, FB-20, DB-06
   **Data impact:** none
   **Blast radius:** if wrong, imprime en orden direct_delivery
   **Rollback:** `git revert` o guard `*ngIf="order.shipping_method !== 'direct_delivery'"`
   **Verification:** Playwright order Envío → click headerActions e-ticket de envío → 1 copia thermal_80 con cliente/dirección/items/cantidades
   **Acceptance checklist:**
   - [ ] headerActions incluye nuevo botón
   - [ ] Card Gestión de Envío botón secundario
   - [ ] Ambos `*ngIf` con guard `shipping_method !== 'direct_delivery'`
   - [ ] Tooltip "Imprime tiquete de despacho en formato térmico"
   - [ ] Loading state via `isPrintingDispatch$` observable
   **Status:** pending

#### E.4 POS ticket bulk migration
   **Skills:** vendix-bulk-operations, vendix-zoneless-signals
   **Resources:** `apps/frontend/src/app/private/modules/store/orders/bulk/orders-bulk-print.service.ts`, `apps/backend/src/domains/store/print-formats/services/print-gateway.service.ts`
   **Business decision:** `PosTicketService.printTicketsBatch` → `POST /store/print-formats/pos_sale_ticket/bulk` con `ArrayMaxSize(100)`. `concatMap` chunk 20 + `BATCH_YIELD_EVERY`.
   **Why:** Volumen 40% ventas.
   **Output:** Bulk endpoint + frontend integration.
   **Contracts touched:** FB-17
   **Data impact:** none
   **Blast radius:** if wrong, bulk 500
   **Rollback:** `git revert`
   **Verification:** `curl -X POST /bulk/render -d '{"requests":[{"format_type":"pos_sale_ticket","document_id":1},...]}' | jq '.data | length == 100'`
   **Acceptance checklist:**
   - [ ] Backend `POST /bulk/render` con `ArrayMaxSize(100)` + permission `store:pos:access`
   - [ ] Service `renderDocumentBulk` con Promise.all chunked 10
   - [ ] Frontend `printTicketsBatch` refactor a bulk
   - [ ] Performance: p95 bulk 100 <2s
   **Status:** pending

#### E.5 Sales order invoice migration
   **Skills:** vendix-frontend, vendix-backend
   **Resources:** `order-print.service.ts:36 printOrder`
   **Business decision:** `print({document:'sales_order'})` → `printViaGateway({formatType:'sales_order_invoice', documentId: order.id, engine:'html'})`.
   **Why:** Provider `sales-order-invoice.provider` ya existe.
   **Output:** Migración sin fallback silencioso.
   **Contracts touched:** FB-05
   **Data impact:** none
   **Blast radius:** if wrong, orden no imprime
   **Rollback:** legacy fallback `DocumentPrintService.print`
   **Verification:** Playwright order detail → Imprimir → 200 OK
   **Acceptance checklist:**
   - [ ] `OrderPrintService.printOrder` usa `printViaGateway`
   - [ ] Sin `try/catch` swallow (log error)
   - [ ] E2E: imprimir order → html con items+totales
   **Status:** pending

#### E.6 Purchase order migration
   **Skills:** vendix-frontend, vendix-backend
   **Resources:** `purchase-order-print.service.ts:37`
   **Business decision:** Mismo patrón E.5.
   **Why:** Provider `purchase-order.provider` listo.
   **Output:** Migración.
   **Contracts touched:** FB-05
   **Data impact:** none
   **Blast radius:** if wrong, OC no imprime
   **Rollback:** legacy
   **Verification:** Playwright OC detail → Imprimir
   **Acceptance checklist:**
   - [ ] Migración funcional
   - [ ] Test integration
   **Status:** pending

#### E.7 Quotation migration
   **Skills:** vendix-frontend, vendix-backend
   **Resources:** `quotation-print.service.ts:35`
   **Business decision:** Mismo patrón.
   **Why:** Provider listo.
   **Output:** Migración.
   **Contracts touched:** FB-05
   **Data impact:** none
   **Rollback:** legacy
   **Verification:** Playwright cotización → Imprimir
   **Acceptance checklist:**
   - [ ] Migración funcional
   **Status:** pending

#### E.8 Dispatch note migration
   **Skills:** vendix-frontend, vendix-backend
   **Resources:** `dispatch-note-print.service.ts:35`
   **Business decision:** Migrar a gateway con `engine:pdf` opcional (reusa `DispatchNotePdfBuilder`).
   **Why:** Provider listo + PDF engine ampliado.
   **Output:** Migración + engine:pdf.
   **Contracts touched:** FB-05, FB-18, ERR-09
   **Data impact:** none
   **Blast radius:** if wrong, remisión no imprime
   **Rollback:** legacy
   **Verification:** `curl -X POST /render -d '{"format_type":"dispatch_note","document_id":1,"engine":"pdf"}' | Content-Type: application/pdf`
   **Acceptance checklist:**
   - [ ] Provider migrado
   - [ ] engine:pdf funcional para `dispatch_note`
   - [ ] `PDF_ENGINE_SUPPORTED_FORMATS` += `dispatch_note`
   **Status:** pending

#### E.9 Transfer note reader real (elimina 501)
   **Skills:** vendix-backend, vendix-multi-tenant-context
   **Resources:** `apps/backend/src/domains/store/print-formats/providers/transfer-note.provider.ts`
   **Business decision:** `fetchDocumentData` lee `stock_transfers + stock_transfer_items + source_store + destination_store + supplier (opcional)`. Sin totales fiscales, sin CUFE.
   **Why:** Elimina ERR-04.
   **Output:** Provider real.
   **Contracts touched:** DB-13, ERR-04
   **Data impact:** none
   **Blast radius:** if wrong, transferencia no imprime
   **Rollback:** revertir a 501 (legacy `window.print`)
   **Verification:** `curl -X POST /render -d '{"format_type":"transfer_note","document_id":1}' | jq '.data.html | contains("SKU")'` exit 0
   **Acceptance checklist:**
   - [ ] Provider con `fetchDocumentData` real
   - [ ] `getSampleData` mantenido
   - [ ] `real-print-path.spec.ts` caso transfer_note
   **Status:** pending

#### E.10 Kitchen ticket reader real (elimina 501)
   **Skills:** vendix-backend
   **Resources:** `apps/backend/src/domains/store/print-formats/providers/kitchen-ticket.provider.ts`
   **Business decision:** `fetchDocumentData` lee `kitchen_tickets + modifiers + table_session`. Renderiza modifiers en tabla.
   **Why:** Elimina ERR-04.
   **Output:** Provider real.
   **Contracts touched:** DB-14, ERR-04
   **Data impact:** none
   **Blast radius:** if wrong, cocina no imprime
   **Rollback:** legacy
   **Verification:** `curl -X POST /render -d '{"format_type":"kitchen_ticket","document_id":1}' | jq '.data.html | contains("Término")'`
   **Acceptance checklist:**
   - [ ] Provider con `fetchDocumentData` real
   - [ ] Modifiers renderizados
   **Status:** pending

#### E.11 Dispatch route gateway + planilla migration
   **Skills:** vendix-backend, vendix-frontend
   **Resources:** `apps/backend/src/domains/store/dispatch-routes/route-flow/pdf-export.service.ts`, `apps/frontend/src/app/private/modules/store/planillas-rutas/pages/planilla-detail-page/planilla-detail-page.component.ts`
   **Business decision:** Crear `dispatch_route` format_type o reusar `dispatch_note` consolidado. Provider con `fetchDocumentData` de `dispatch_routes + dispatch_route_stops`.
   **Why:** Planilla ruta no tiene gateway.
   **Output:** Provider nuevo + frontend migration.
   **Contracts touched:** DB-15 (nuevo), ERR-01
   **Data impact:** none
   **Blast radius:** if wrong, planilla no imprime
   **Rollback:** legacy backend pdf
   **Verification:** `curl -X POST /render -d '{"format_type":"dispatch_route","document_id":1}' | jq '.data.html | contains("Remisión")'`
   **Acceptance checklist:**
   - [ ] Enum `dispatch_route` añadido (migration `ADD VALUE`)
   - [ ] Provider + seed
   - [ ] Planilla detail migrate
   **Status:** pending

#### E.12 Withholding certificate 3 tipos
   **Skills:** vendix-backend, vendix-frontend
   **Resources:** `apps/frontend/src/app/private/modules/store/withholding-tax/services/withholding-certificate-print.service.ts:65/75/85`
   **Business decision:** 3 tipos: practicada, sufrida, empleado. Cada uno con provider.
   **Why:** 3 docs huérfanos.
   **Output:** 3 providers + frontend migration.
   **Contracts touched:** DB-16
   **Data impact:** none
   **Blast radius:** if wrong, retención no imprime
   **Rollback:** legacy
   **Verification:** Playwright 3 tipos de retención → imprimir
   **Acceptance checklist:**
   - [ ] 3 providers creados
   - [ ] 3 enum values (withholding_practiced, withholding_suffered, employee_certificate)
   - [ ] Frontend migrado
   **Status:** pending

#### E.13 Fiscal credit note PDF engine
   **Skills:** vendix-backend, vendix-fiscal-scope
   **Resources:** `print-gateway.service.ts:35 PDF_ENGINE_SUPPORTED_FORMATS`
   **Business decision:** Añadir `fiscal_credit_note` a `PDF_ENGINE_SUPPORTED_FORMATS`. Reusa `FiscalInvoicePdfRenderService` (refactor genérico).
   **Why:** DIAN exige PDF para notas crédito.
   **Output:** PDF funcional.
   **Contracts touched:** FB-18, ERR-09
   **Data impact:** none
   **Blast radius:** if wrong, NC electrónica no PDF
   **Rollback:** revertir array
   **Verification:** `curl -X POST /render -d '{"format_type":"fiscal_credit_note","document_id":1,"engine":"pdf"}' | Content-Type: application/pdf`
   **Acceptance checklist:**
   - [ ] `PDF_ENGINE_SUPPORTED_FORMATS` += `fiscal_credit_note`
   - [ ] `FiscalInvoicePdfRenderService` acepta credit_note
   - [ ] E2E PDF NC electrónica con CUDE visible
   **Status:** pending

#### E.14 Mobile parity `apps/mobile/dispatch-ticket-print.service.ts`
   **Skills:** mobile-dev, mobile-parity-audit
   **Resources:** `apps/mobile/src/features/dispatch-notes/services/`
   **Business decision:** Mirror del servicio web. Usa `expo-print`.
   **Why:** PDA bodega necesita tiquete.
   **Output:** Servicio mobile.
   **Contracts touched:** DB-19
   **Data impact:** none
   **Blast radius:** if wrong, mobile no imprime
   **Rollback:** legacy
   **Verification:** mobile app `expo-print` con `dispatch_ticket`
   **Acceptance checklist:**
   - [ ] `apps/mobile/src/features/dispatch-notes/services/dispatch-ticket-print.service.ts` creado
   - [ ] Expo-print integration
   - [ ] Mobile parity audit PASS
   **Status:** pending

### Phase F — Validación + Convergencia

#### F.1 Contract sweep gate 23 FB +19 DB +16 ERR tickeados
   **Skills:** vendix-backend-api, vendix-prisma-scopes, vendix-error-handling
   **Resources:** `docs/evidence/fb-{01..23}.txt`, `db-{01..19}.txt`, `err-{01..16}.txt`
   **Business decision:** Cada fila tickeada con comando runnable + output esperado.
   **Why:** Pre-condición plan done.
   **Output:** `docs/evidence/contract-sweep.md` con tabla Summary.
   **Contracts touched:** none (validation)
   **Data impact:** none
   **Blast radius:** none
   **Rollback:** none
   **Verification:** `wc -l docs/evidence/contract-sweep.md` >= 50
   **Acceptance checklist:**
   - [ ] 23 archivos `fb-*.txt` con jq exit 0
   - [ ] 19 archivos `db-*.txt` con `psql` exit 0
   - [ ] 16 archivos `err-*.txt` con curl exit codes 4xx/5xx esperados
   - [ ] Summary `contract-sweep.md` con count == Phase 2 inventory
   **Status:** pending

#### F.2 E2E Playwright + curl + build + zoneless audit
   **Skills:** how-to-test, buildcheck-dev, vendix-zoneless-signals
   **Resources:** Playwright MCP, `npm run build:prod`, `npm run zoneless:audit`
   **Business decision:** E2E Hub 11 cards + POS delivery auto-dispatch + order Envío manual-dispatch + 11 renders via curl.
   **Why:** Pre-condición pr-code-review.
   **Output:** Screenshots + commands.
   **Contracts touched:** none
   **Data impact:** none
   **Blast radius:** none
   **Rollback:** none
   **Verification:** All evidence in `docs/evidence/f2-*.png` + `npm run build:prod -w apps/frontend` exit 0 + `npm run zoneless:audit` PASSED
   **Acceptance checklist:**
   - [ ] Playwright Hub 11 cards `f2-hub-11-cards.png`
   - [ ] Playwright POS delivery dispatch `f2-pos-dispatch-auto.png`
   - [ ] Playwright order Envío dispatch `f2-order-dispatch-manual.png`
   - [ ] `curl /render dispatch_ticket engine:html` 200
   - [ ] `npx tsc -p tsconfig.build.json --noEmit` exit 0
   - [ ] `npm run build:prod -w apps/frontend` exit 0
   - [ ] `npm run zoneless:audit` PASSED
   - [ ] `npm run tz:audit` PASSED
   **Status:** pending

#### F.3 Performance: preview debounce + bulk 100 + engine:pdf 6 hojas
   **Skills:** how-to-test, vendix-bulk-operations
   **Resources:** k6 o simple curl loop, `apps/backend/src/domains/store/print-formats/services/print-gateway.service.ts`
   **Business decision:** Preview debounce `switchMap` 300ms. Bulk 100 p95 <2s. engine:pdf 6 hojas p95 <5s.
   **Why:** SLA implícito.
   **Output:** Performance report.
   **Contracts touched:** none
   **Data impact:** none
   **Blast radius:** none
   **Rollback:** none
   **Verification:** 50 RPS `/preview` p95 <800ms, `/bulk/render` 100 p95 <2s
   **Acceptance checklist:**
   - [ ] `print-formats.facade.refreshPreview` con `debounceTime(300) + switchMap + AbortController`
   - [ ] Bulk 100 response time p95 <2s
   - [ ] engine:pdf 6 formatos (fiscal_electronic_invoice, fiscal_credit_note, dispatch_note, sales_order_invoice, quotation, purchase_order) p95 <5s
   **Status:** pending

#### F.4 Convergence Loop 13 perspectivas ×2 rondas limpias
   **Skills:** agent-teams, how-to-critical-plan
   **Resources:** 13 perspective agents + Convergence Loop Log
   **Business decision:** Round 1 + Round 2 con entry points variados. 2 rondas consecutivas clean (B=0, M=0).
   **Why:** Self-verification.
   **Output:** `Convergence Loop Log` con 2+ filas clean.
   **Contracts touched:** none
   **Data impact:** none
   **Blast radius:** none
   **Rollback:** none
   **Verification:** 13 perspectives documented + Log con ≥2 clean rows
   **Acceptance checklist:**
   - [ ] Round 1: 13 perspectives lanzadas, findings logged
   - [ ] Round 2: entry points variados, ≥2 clean
   - [ ] Convergence Loop Log en este archivo con 2+ filas clean
   **Status:** pending

## Perspective Audit Matrix

| # | Perspective | Round run | Findings (B/M/M/N) | Status |
|---|-------------|-----------|-------------------|--------|
| 1 | Architecture | pending | — | pending |
| 2 | Implementation | pending | — | pending |
| 3 | Frontend↔Backend contracts | pending | — | pending |
| 4 | Database & integrity | pending | — | pending |
| 5 | Error handling & codes | pending | — | pending |
| 6 | Security & authorization | pending | — | pending |
| 7 | Data validation | pending | — | pending |
| 8 | Data load & performance | pending | — | pending |
| 9 | Development strategy | pending | — | pending |
| 10 | UI/UX & reachability | pending | — | pending |
| 11 | Accessibility | pending | — | pending |
| 12 | User comprehension | pending | — | pending |
| 13 | Observability & traceability | pending | — | pending |

## Convergence Loop Log

| Round | Date | Blockers | Majors | Minors | New steps | Outcome |
|-------|------|----------|--------|--------|-----------|---------|
| — | — | — | — | — | — | pending (mínimo 2 rondas limpias consecutivas para cerrar) |

## End-to-End Verification

1. `curl -H "Authorization: Bearer $TOK" -H 'x-store-id: 5' http://localhost:3000/api/store/print-formats | jq '.data | length ==11'`
2. `curl -X POST .../store/print-formats/dispatch_ticket/preview -d '{"overrides":{"v":2,"paper":{"format":"thermal_80"}}}' | jq '.data.html | contains("Cant. despachada")'`
3. `curl -X POST .../render -d '{"format_type":"dispatch_ticket","document_id":1}' → 200 html con cliente/dirección/items
4. `curl -X PATCH /store/settings -d '{"receipts":{"print_dispatch_ticket_enabled":true,"print_dispatch_ticket_auto_with_pos":true}}'` → 200 + `GET /store/settings | jq '.data.receipts.print_dispatch_ticket_enabled'`
5. Playwright `vendix.com/admin/settings/print-formats` → Hub 11 cards
6. Playwright POS delivery → autoPrint POS + despacho 1 copia
7. Playwright order Envío → click headerActions e-ticket de envío → 1 copia thermal_80
8. `npx tsc -p tsconfig.build.json --noEmit` + `npm run build:prod -w apps/frontend` + `npm run zoneless:audit` PASSED

## Rollback Plan

| Phase | Trigger | Procedure | Data recoverable? | Who decides |
|-------|---------|-----------|-------------------|-------------|
| A | Sweep encuentra divergencia `trade_name` | `git revert` | yes | Owner |
| B.1 | Enum ADD VALUE locked | `ROLLBACK` (one-way) | yes (no rows) | Owner + DBA |
| B/C | Migración `gateway_enabled` falla | `UPDATE store_print_format_configs SET gateway_enabled=false WHERE updated_at > :deploy` + restore `pg_dump` | yes (snapshot) | Owner + DBA |
| D | Editor v2 rompe `custom_template` | Feature flag `PRINT_GATEWAY_V2=false` fallback v1 | yes | Owner |
| E.1 | Despacho imprime no deseado | `PATCH print_dispatch_ticket_enabled=false` + flag `PRINT_DISPATCH_TICKET_ROLLOUT=false` | yes | Owner |
| E | Bulk render OOM | `ArrayMaxSize 50` + `concatMap` | yes | Owner |
| Global | 2 rondas convergencia no cierran tras 6 | Escalar a humano, design review | — | Human |

## Knowledge Gaps

- `withholding_certificate`/`dispatch_route` como `print_format_type_enum` nuevos vs reuse `dispatch_note` consolidado — proponer skill `vendix-print-formats` si patrón se repite.
- `custom_template` → `pdfkit` fidelity fina (posicionamiento logo mm exacto en PDF) — slice 2 pendiente documentado en `print-gateway.service.ts:174`.
- Mobile `expo-print` parity — audit `mobile-parity-audit` pendiente.
- `dispatch_ticket` con `engine:pdf` para hoja carta (modo almacén) — fuera de scope, dejar nota.

## Execution Log

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-08-27 | rzy | Plan | Plan materializado + checkpoint anchor `dbc484744` | `/tmp/vendix-plans/dispatch-ticket-logistica-parity-20260827.md` + tag `checkpoint/parallel-dispatch-ticket-20260827` |

## Approval Request

This critical plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`, with the Living Document Protocol and the Convergence Loop in force. Reply with corrections to revise the plan in place.

---

**Status:** APPROVED → in-execution
**Approved by:** rzy (owner, durmiendo) — 2026-08-27
**Execution mode:** Parallel fan-out (4 sub-agentes) + checkpoint anchor + commit-early protection + scope file lists explícitos
**Permissions granted:**
- Crear/editar archivos DENTRO del scope de cada paso
- Ejecutar migrations idempotentes
- Ejecutar tests + verification commands
- Commit por sub-agente de su scope
- Crear tag `checkpoint/parallel-*` adicionales si necesario
- Ejecutar Playwright MCP + curl + grep
- Bloqueado: git checkout, git reset --hard, git restore, git clean, git rebase, git merge, git push --force, git commit --amend, branch delete, files fuera de scope