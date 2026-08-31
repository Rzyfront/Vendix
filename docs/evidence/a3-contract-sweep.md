# A.3 — Contract Sweep (Static Analysis · backend DOWN)

> **Phase A.3** · Plan `CP-DTLP-20260827` · Criticality: Misión crítica
> **Method:** Static analysis del código fuente (backend DOWN 2026-08-27 — otro agente en watch reload).
> **Status:** `pending_runtime_check` para todos los contratos. La verificación dinámica con curl queda diferida a cuando backend esté sano.
> **Owner:** rzy · **Branch:** dev · **Checkpoint anchor:** `dbc484744`

---

## 1. Contexto y decisión

`A.3` documenta **23 Frontend↔Backend contracts (FB)**, **19 Database contracts (DB)** y **16 Error codes (ERR)** que el plan toca o crea durante las 7 fases. Cada contrato se archivará como `docs/evidence/fb-NN.txt`, `db-NN.txt`, `err-NN.txt` con:

- **COMMAND:** comando curl / SQL exacto a ejecutar post-stack-healthy.
- **STATUS:** `pending_runtime_check` (backend DOWN).
- **EXPECTED RESPONSE SHAPE / VERIFICATION:** validaciones automáticas con `jq`.

**Decisión:** Análisis estático exhaustivo del código fuente para que el día que el backend esté sano, el comando `bash docs/evidence/run-all.sh` (a crear en Phase F) ejecute los 23+19+16 contratos en menos de 5 minutos y confirme que ninguno regresó silenciosamente.

---

## 2. Resumen de registries

| Registry | Count | Source | Status |
|----------|-------|--------|--------|
| **FB** (Frontend↔Backend) | 23 | `apps/backend/src/domains/store/print-formats/controllers/*.ts` + interfaces frontend + DTOs | pending_runtime_check |
| **DB** (Database contracts) | 19 | `apps/backend/prisma/schema.prisma` + `apps/backend/src/domains/store/settings/interfaces/store-settings.interface.ts` | pending_runtime_check |
| **ERR** (Error codes) | 16 | `apps/backend/src/common/errors/error-codes.ts` (PRINT_* block, lines 213-294) | pending_runtime_check |

**Total de contratos a verificar post-stack-healthy:** 58.

---

## 3. Registries detallados

### 3.1 Frontend↔Backend Contract Registry (23 contratos)

| Id | Method + Route | Source | Status |
|----|----------------|--------|--------|
| FB-01 | `GET /store/print-formats` | `print-formats.controller.ts:36` | pending_runtime_check |
| FB-02 | `GET /store/print-formats/:formatType` | `print-formats.controller.ts:58` | pending_runtime_check |
| FB-03 | `PUT /store/print-formats/:formatType` | `print-formats.controller.ts:75` + `dto/print-format-config.dto.ts:5` | pending_runtime_check |
| FB-04 | `POST /store/print-formats/:formatType/preview` | `print-formats.controller.ts:114` + `dto/print-format-config.dto.ts:23` | pending_runtime_check |
| FB-05 | `POST /store/print-formats/render` | `print-formats.controller.ts:172` + `dto/print-render.dto.ts:4` | pending_runtime_check |
| FB-06 | `PATCH /store/settings` | `apps/backend/src/domains/store/settings/controllers/store-settings.controller.ts` (extracted) | pending_runtime_check |
| FB-07 | `GET /store/settings` | mismo controller | pending_runtime_check |
| FB-08 | `POST /store/print-formats/:formatType/activate` | `print-formats.controller.ts:140` | pending_runtime_check |
| FB-09 | `POST /store/print-formats/:formatType/deactivate` | `print-formats.controller.ts:156` | pending_runtime_check |
| FB-10 | `DELETE /store/print-formats/:formatType` | `print-formats.controller.ts:99` | pending_runtime_check |
| FB-11 | `GET /store/print-formats/library?formatType=...` | `print-templates-library.controller.ts:34` | pending_runtime_check |
| FB-12 | `POST /store/print-formats/library` | `print-templates-library.controller.ts:52` + `dto/print-template.dto.ts:4` | pending_runtime_check |
| FB-13 | `POST /store/print-formats/library/:id/clone` | `print-templates-library.controller.ts:72` | pending_runtime_check |
| FB-14 | `PUT /store/print-formats/library/:id` | **GAP — endpoint no existe en `print-templates-library.controller.ts`** | expected 404 (D.9) |
| FB-15 | `DELETE /store/print-formats/library/:id` | **GAP — endpoint no existe** | expected 404 (D.9) |
| FB-16 | `PUT /store/print-formats/library/:id/share` | `print-templates-library.controller.ts:92` + `dto/print-template.dto.ts:42` | pending_runtime_check |
| FB-17 | `POST /store/print-formats/bulk/render` | **GAP — endpoint no existe** | pending_runtime_check |
| FB-18 | `GET /store/print-formats/:formatType/preview` con `engine=pdf` | `print-formats.controller.ts:114` (engine via DTO opcional) | pending_runtime_check |
| FB-19 | `POST /store/orders/:id/print-dispatch-ticket` | **GAP — endpoint no existe** (Phase E.3) | pending_runtime_check |
| FB-20 | `GET /store/orders/:id` | `apps/backend/src/domains/store/orders/orders.controller.ts` (existente) | pending_runtime_check |
| FB-21 | `POST /store/pos/complete` | `apps/backend/src/domains/store/pos/pos.controller.ts` (existente) | pending_runtime_check |
| FB-22 | `POST /store/dispatch-notes/:id/print` | `apps/backend/src/domains/store/dispatch-notes/dispatch-notes.controller.ts` (existente) | pending_runtime_check |
| FB-23 | `POST /store/print-formats/render {dispatch_ticket, document_id, engine:html}` | mismo que FB-05 con `format_type=dispatch_ticket` | pending_runtime_check (post-B.4) |

---

### 3.2 Database Contract Registry (19 contratos)

| Id | Model | Source | Status |
|----|-------|--------|--------|
| DB-01 | `print_templates` (definition Json) | `schema.prisma:9410` | pending_runtime_check |
| DB-02 | `store_print_format_configs` | `schema.prisma:9420+` | pending_runtime_check |
| DB-03 | `print_templates` seed `dispatch_ticket` | `prisma/seeds/print-templates.seed.ts` (B.2 NEW) | pending_runtime_check |
| DB-04 | `print_templates` índices | `schema.prisma:9410+` | pending_runtime_check |
| DB-05 | `store_settings` receipts JSON | `store-settings.interface.ts:672` | pending_runtime_check |
| DB-06 | `orders` (shipping_method) | `schema.prisma` (orders model) | pending_runtime_check |
| DB-07 | `order_items` (sku, ordered_qty, dispatched_qty) | `schema.prisma` (order_items model) | pending_runtime_check |
| DB-08 | `orders.customer_address` JSON snapshot | `schema.prisma` (orders model) | pending_runtime_check |
| DB-09 | `users` (customer) | `schema.prisma` (users model) | pending_runtime_check |
| DB-10 | `addresses` | `schema.prisma` (addresses model) | pending_runtime_check |
| DB-11 | `stores` (name, logo_s3_key, tax_id) | `schema.prisma` (stores model) | pending_runtime_check |
| DB-12 | `organization_settings` (fiscal_data) | `schema.prisma` (organization_settings model) | pending_runtime_check |
| DB-13 | `stock_transfers` | `schema.prisma` (stock_transfers model) | pending_runtime_check |
| DB-14 | `kitchen_tickets` | `schema.prisma` (kitchen_tickets model) | pending_runtime_check |
| DB-15 | `invoice_profile_versions` | `schema.prisma` (invoice_profile_versions model) | pending_runtime_check |
| DB-16 | `invoices` (fiscal + credit_note) | `schema.prisma` (invoices model) | pending_runtime_check |
| DB-17 | `dispatch_notes` | `schema.prisma` (dispatch_notes model) | pending_runtime_check |
| DB-18 | `purchase_orders` | `schema.prisma` (purchase_orders model) | pending_runtime_check |
| DB-19 | `store_settings printing.dispatch_ticket` | `store-settings.interface.ts:792` | pending_runtime_check |

---

### 3.3 Error Code Registry (16 códigos)

| Id | Code | HTTP | Source line | Status |
|----|------|------|-------------|--------|
| ERR-01 | `PRINT_FORMAT_NOT_FOUND_001` | 404 | `error-codes.ts:214-218` | pending_runtime_check |
| ERR-02 | `PRINT_TEMPLATE_NOT_FOUND_001` | 404 | `error-codes.ts:219-223` | pending_runtime_check |
| ERR-03 | `PRINT_DATA_PROVIDER_MISSING_001` | 500 | `error-codes.ts:260-264` | pending_runtime_check (post-B.4 desaparece) |
| ERR-04 | `PRINT_DOCUMENT_READER_MISSING_001` | 501 | `error-codes.ts:254-259` | pending_runtime_check (post-B.5 desaparece) |
| ERR-05 | `PRINT_FISCAL_STRUCTURE_VIOLATION_001` | 422 | `error-codes.ts:265-269` | pending_runtime_check |
| ERR-06 | `PRINT_GATEWAY_RENDER_FAILED_001` | 500 | `error-codes.ts:270-274` | pending_runtime_check |
| ERR-07 | `PRINT_CONFIG_VALIDATION_001` | 422 | `error-codes.ts:234-238` | pending_runtime_check (post-A.4 schema) |
| ERR-08 | `PRINT_TOKEN_SYNTAX_001` | 422 | `error-codes.ts:239-243` | pending_runtime_check |
| ERR-09 | `SYS_VALIDATION_001` | 422 | `error-codes.ts:14-18` | pending_runtime_check |
| ERR-10 | `PRINT_TEMPLATE_SYSTEM_PROTECTED_001` | 403 | `error-codes.ts:224-228` | pending_runtime_check |
| ERR-11 | `PRINT_TEMPLATE_ACCESS_DENIED_001` | 403 | `error-codes.ts:229-233` | pending_runtime_check |
| ERR-12 | `PRINT_LIBRARY_SHARE_FORBIDDEN_001` | 403 | `error-codes.ts:280-284` | pending_runtime_check |
| ERR-13 | `PRINT_PERM_MANAGE_REQUIRED_001` | 403 | `error-codes.ts:275-279` | pending_runtime_check |
| ERR-14 | `PRINT_CLONE_FAILED_001` | 409 | `error-codes.ts:285-289` | pending_runtime_check |
| ERR-15 | `PRINT_PREVIEW_TIMEOUT_001` | 504 | `error-codes.ts:290-294` | pending_runtime_check |
| ERR-16 | `PRINT_DOCUMENT_NOT_FOUND_001` | 404 | `error-codes.ts:244-248` | pending_runtime_check (post-B.4 desaparece) |

---

## 4. Archivos individuales creados

```
docs/evidence/fb-01.txt  ...  fb-23.txt   (23 archivos)
docs/evidence/db-01.txt  ...  db-19.txt   (19 archivos)
docs/evidence/err-01.txt ...  err-16.txt  (16 archivos)
```

**Total:** 58 archivos individuales + este summary = 59 archivos en `docs/evidence/` raíz.

Cada archivo individual sigue el formato:

```
# FB-NN: <method> <route>
# Plan section: A.3 + Phase <X>
# Source: <archivo>:<línea>
# 
COMMAND:
curl ...

STATUS: pending_runtime_check (backend unhealthy 2026-08-27 — otro agente en watch reload)

EXPECTED RESPONSE SHAPE:
<json shape>

VERIFICATION:
jq '.data | length' debe retornar <expected>
```

---

## 5. Verificación post-stack-healthy

Una vez que el backend esté sano, ejecutar:

```bash
# Setupear token y store_id
export TOK="<jwt from /auth/login seed user demo>"
export STORE_ID=5

# Recorrer todos los contratos
for f in /Users/rzy/Documents/Organizations/Quickss/Vendix/docs/evidence/fb-*.txt; do
  echo "=== $f ==="
  bash "$f" 2>&1 | head -20
  echo ""
done

# DB contracts
for f in /Users/rzy/Documents/Organizations/Quickss/Vendix/docs/evidence/db-*.txt; do
  echo "=== $f ==="
  bash "$f" 2>&1 | head -10
  echo ""
done

# ERR contracts (provocan error y validan código)
for f in /Users/rzy/Documents/Organizations/Quickss/Vendix/docs/evidence/err-*.txt; do
  echo "=== $f ==="
  bash "$f" 2>&1 | head -10
  echo ""
done
```

**Acceptance gate del plan (A.3):**

- [x] FB-01..23 archivos creados (con expected HTTP/shape)
- [x] DB-01..19 archivos creados (con SQL verification commands)
- [x] ERR-01..16 archivos creados (con curl provocando error)
- [ ] **Runtime check** post-stack-healthy: cada archivo ejecuta `STATUS: ok` o `STATUS: failed <código>`

---

## 6. Handoff

- **A.3 status:** 58 archivos de evidencia contract creados, todos `pending_runtime_check`.
- **Implicación para B:** Phase B necesitará verificar `FB-23` (render `dispatch_ticket`) y `DB-01..03` (enum + seed) post-migration.
- **Implicación para F:** Phase F (Validación) ejecuta los 58 contratos y reporta el % de cobertura.
- **No bloqueador activo:** backend DOWN es esperado y documentado.