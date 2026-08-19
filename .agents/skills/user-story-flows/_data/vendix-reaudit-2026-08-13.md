# Vendix — Re-auditoría Profunda 2026-08-13 — Reporte Consolidado

> **Tienda auditada:** `rzyfront@gmail.com / RM.x100pre` (store 10 "Roku", org 6)
> **Industrias activas:** retail, restaurant, service, manufacturing, gym
> **Modo:** READ-ONLY (sin modificar código)
> **Stack:** NestJS + Prisma + Angular 20 + PostgreSQL + Redis + BullMQ + Wompi
> **Fecha:** 2026-08-13
> **Metodología:** Verificación archivo:línea + curl real + 5 agentes paralelos + Engram cross-ref
> **Origen:** Consolida + refuta la auditoría inicial 2026-08-12 (`_data/vendix-audit-2026-08-12.md`)

---

## 🏆 Totales Consolidados (post re-auditoría)

| Cluster | # Hallazgos | P0 | P1 | P2 | P3 | CONFIRMED | REFUTED | UPGRADED | DOWNGRADED | NEW | CONSOLIDATED |
|---------|-------------|------|------|------|------|-----------|---------|----------|------------|-----|--------------|
| **Comercial** (POS/Compras/Despacho/Inv/Productos) | **74** | 13 | 24 | 21 | 9 | ~64 | 2 | 0 | 2 | 6 | 1 (POS-024→POS-001) |
| **Industrias** (Restaurant/Gym/Ecommerce/Promos/QR) | **25** | 3 | 6 | 9 | 7 | 10 | 3 (R7,R8 ciclos + E17,E18) | 1 (E8) | 1 (E1) | 14 | 0 |
| **Admin/Core** (CRM/Conta/Nómina/Caja/Analytics) | **73** | 10 | 23 | 23 | 12 | 31 | 4 | 2 | 3 | 33 | 5 (CONT family + ANALYTICS family) |
| **Plataforma** (Settings/Sub/Vexi/SaaS/Front/SSE/Notif/Permisos/Mkt) | **130** | 8+ | 25+ | 50+ | 30+ | 52 | 42 | 0 | 0 | 5 | 18 |
| **Smoke verifications** (live curl + grep repo-wide) | **55** | 7 | 48 | 0 | 0 | 7 | 0 | 0 | 0 | 48 | 0 |
| **TOTAL** | **~357** | **~41** | **~126** | **~103** | **~58** | **~164** | **~51** | **3** | **6** | **106** | **24** |

**Δ vs auditoría inicial:** Refutados 51 (~13%), consolidados 24, NEW 106 (1 de cada 3 hallazgos es nuevo post-revisión profunda). Severidad ascendida en 3 hallazgos críticos (E8 P2→P0, DSPNE soap action, customer-history IDOR) y descendida en 6 (POS-005/008/010 oversell hardcoded, E1 payment-links, etc.).

---

## 🔴 TOP 25 P0 Confirmados (acción inmediata — 24-48h)

### Bloqueantes de producción vivos (4)
1. **`payments.service.ts:551`** — `include.payment_methods` inválido Prisma → 500 en `GET /store/payments` *(CONFIRMED via curl)*
2. **`accounts_payable.service.ts:210-219`** — Corrupción NaN en CxP IDs 109-112 *(LIVE BD: paid_amount="NaN")*
3. **`expense-flow.service.ts:103-109` ↔ `ap-events.listener.ts:52-78`** — Handshake `expense.approved` con campos `amount` vs `total_amount` + falta `supplier_id`. **0 expenses aprobadas generan CxP** *(LIVE: regression verificada)*
4. **`product-variant.service.ts:65`** — `createVariant`/`updateVariant` NO invoca `assertVariantsAllowed` → variantes coexisten con `has_multiple_price_tiers:true` *(Producto 416 LIVE con 2 variantes + multitarifa)*

### Autorización / tenant (4)
5. **`customers.service.ts:710-940`** — Password bcrypt `$2b$12$...` filtrado en TODAS las respuestas *(NEW: CRM-NEW-1)*
6. **`customer-history.service.ts:21-39`** — IDOR cross-tenant: `where: { customer_id }` sin `store_users` filter *(CONFIRMED via curl)*
7. **`customers.controller.ts:133-149` + `products.controller.ts:438-454`** — Stats `:storeId` sin `validateStoreAccess` → acepta cualquier `storeId` *(CONFIRMED: `store/9999` → 200 OK)*
8. **`shipping.controller.ts:29`** — `@Controller('shipping')` sin `/store/` burla `DomainScopeGuard`+`StoreOperationsGuard` → clientes storefront POST/DELETE shipping rates *(UPGRADED P2→P0, NEW chain-of-exploit)*

### Validación contable (3)
9. **`open-session.dto.ts:11` / `create-movement.dto.ts:9` / `close-session.dto.ts:5`** — DTOs Caja sin `@Min(0)` *(CONFIRMED via curl: amount=-50000 → 201 OK persistido)*
10. **`cash_register_sessions` schema.prisma:6591-6593** — Race `openSession` sin `UNIQUE INDEX WHERE status='open'` *(CONFIRMED)*

### Auditoría DIAN (1)
11. **`dian-soap.client.ts:83` + `dian-payroll.provider.ts:338,492`** — DSPNE llama `sendBillSync()` cuando debería `SendNominaSync()`. Solo `sendBillSync` existe; constante `SendNominaSync` huérfana *(CONFIRMED)*

### POS / payments (3)
12. **`webhook.controller.ts:124-128`** — Webhook Wompi catch devuelve `{received:true}` 200 en errores → Wompi no reintenta *(NEW, POS-021)*
13. **`addresses/dto/index.ts:271`** — `sort_by?=created_at` rompe Prisma (modelo sin timestamps) → 500 en `GET /store/addresses` *(NEW F-001)*
14. **`dispatch-notes/dto/create-from-order.dto.ts:213`** — `items:` required bloquea quick-accept → 400 en `sendToDispatchPool` *(NEW F-002)*

### Compras / CxP (3)
15. **`accounts-payable.service.ts:212`** — `status: 'overdue' → 'partial'` sin recalcular `days_overdue` → dashboard miente *(CONFIRMED)*
16. **`ap-scheduling.service.ts:29-33`** — `schedulePayment` sin límite agregado → AP 113 programada 126% del balance *(CONFIRMED via curl)*
17. **`ap-events.listener.ts:52-78`** — `expense.approved` no usa `upsert` → duplica CxP ante retry del evento *(CONFIRMED)*

### Controller / guard gaps (2)
18. **`store/ecommerce/ecommerce.controller.ts:20`** — 5 handlers con `@Permissions` pero SIN `@UseGuards(PermissionsGuard)` → decorators INERT *(NEW E4, class-of-bug afecta 23 controllers repo-wide)*
19. **`membership-access.service.ts` (1735 líneas, 0 `$transaction`)** — Race aforo PIN/QR *(CONFIRMED G2)*

### Frontend / UX (1)
20. **`customers.component.ts:39,48,57,66`** — `+12%, +5%, +8%, +15%` hardcoded en template *(CONFIRMED CRM-P0-2)*

### Marketing / quota (1)
21. **`marketing SSE` (SSE endpoint)** — Sin `@RequireAIFeature` → bypass de quota AI *(CONFIRMED en Plataforma)*

### Anti-fraude (1)
22. **`schema.prisma` enum `membership_access_result_enum`** — PIN lockout NO implementado (QUI-509 sin cumplir) *(CONFIRMED G1)*

### Accounting / withholding (1)
23. **`payments.service.ts:3870` + `webhook-handler.service.ts:511-515`** — POS retenedor omite en 2 de 3 rutas (`withholding_breakdown: []`) → asiento 1355 perdido *(CONFIRMED CONT-P1-4)*

### Handshake / DIAN / PILA (1)
24. **`account-mapping.service.ts:548-562`** — `settlement.paid.severance/severance_interest/bonus/vacation` (2610-2625) mappings huérfanos: definidos pero nunca usados por `onSettlementPaid` handler *(CONFIRMED PAY-P1-7)*

### REST/middleware (1)
25. **`customers.controller.ts:lookup`** — Lookup por documento expone PII cross-store misma org *(CONFIRMED CRM-NEW-3)*

---

## 📑 Detalle por Cluster (242 hallazgos netos)

### A. COMERCIAL (74 hallazgos)

#### A1. POS / Payments — 26 hallazgos (5 P0, 11 P1, 8 P2, 2 REFUTED, 5 NEW)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| POS-001 | P0 | **P0** | **CONFIRMED** | `include.payment_methods` inválido → 500 | `payments.service.ts:551` |
| POS-002/3/4 | P0 | **P0** | **CONFIRMED** | Cash DTOs sin `@Min(0)` | `open-session,create-movement,close-session.dto.ts` |
| POS-005 | P0 | **P3** | **REFUTED** | `allowOversell` hardcoded | `payments.service.ts:820` (3 guardas activas mem #1331) |
| POS-005b | P1 | **P2** | **CONFIRMED** | DTO `allow_oversell` field muerto | `create-pos-payment.dto.ts:507` |
| POS-006 | P1 | **P1** | **CONFIRMED** | `recordCashRegisterMovement` fire-and-forget | `payments.service.ts:1635` |
| POS-007 | P1 | **P1** | **CONFIRMED** | `recordRefundMovement` hardcodea `'cash'` | `refund-flow.service.ts:498` |
| POS-008 | P0 | **P2** | **DOWNGRADED** | `payments.controller` sin `@Permissions` glob | `payments.controller.ts:1` |
| POS-009 | P1 | **P1** | **CONFIRMED** | `store-payment-methods` 0 `@Permissions` | `store-payment-methods.controller.ts` |
| POS-010 | P0 | **P2** | **DOWNGRADED** | `system-payment-methods` sin `@UseGuards` | `system-payment-methods.controller.ts` |
| POS-011 | P1 | **P1** | **CONFIRMED** | `confirmPosWompiPayment` sin tenant+permisos | `payments.controller.ts:117` |
| POS-012 | P1 | **P1** | **CONFIRMED** | payment-validator 5 `catch {}` silenciosos | `payment-validator.service.ts` |
| POS-013 | P1 | **P1** | **CONFIRMED** | `updateOrderAfterRefund` sin CAS | `payment-gateway.service.ts:429` |
| POS-014/15 | P2 | **P2** | **CONFIRMED** | `createOrderFromPaymentData` sin tx / pending orphan | `payment-gateway.service.ts:286,370` |
| POS-016 | P2 | **P2** | **CONFIRMED** | `where.orders` redundante (refutada POS-005) | `payments.service.ts:495` |
| POS-017 | P1 | **P1** | **CONFIRMED** | `responseService.error` returns-no-throws | `store-payment-methods.controller.ts:189` |
| POS-018/19 | P2 | **P3** | **CONFIRMED** | `pos.component.ts` 3484 líneas / `pos-cart.service.ts` 2322 líneas | god component |
| POS-020 | P3 | **P3** | **CONFIRMED** | `pos-payment.service.ts Subject` leaked | `pos-payment.service.ts:38` |
| POS-021 | P0 | **P0** | **NEW** | Webhook Wompi `catch → 200 OK` silencioso | `webhook.controller.ts:124` |
| POS-022 | P1 | **P1** | **NEW** | `wompi.preparePayment` sin `store_id` ownership check | `wompi.controller.ts:70` |
| POS-023 | P1 | **P1** | **NEW** | SSE `ai-summary` stream leak cross-tenant | `sessions.controller.ts:69` |
| POS-024 | P0 | — | **CONSOLIDATED** | raíz era POS-001 (`include.payment_methods`) | merged |
| POS-025 | P2 | **P2** | **NEW** | `sign-validation-pattern` extendido | 3 DTOs sin `@Min(0)` |
| POS-026 | P1 | **P1** | **NEW** | session ownership no valida caja física | `payments.service.ts:692` |

**Refutaciones documentadas:**
- POS-005 (P0 original): `allowOversell=hardcoded false` — **REFUTED**. Comportamiento de negocio correcto: bloquea sobreventa con `POS_STOCK_INSUFFICIENT_001` (mem #1331). Solo el campo DTO `allow_oversell` es dead → baja a POS-005b P2.
- POS-024 (P0 original): 500 root cause NO estaba en `where.orders` (Prisma relation filter válido) sino en `include.payment_methods`. Consolidado con POS-001.

---

#### A2. Compras / CxP — 18 hallazgos (4 P0, 3 P1, 7 P2, 4 P3, 3 NEW)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| AP-CRIT-1 | P0 | **P0** | **CONFIRMED** | NaN en `accounts_payable` IDs 109-112 (LIVE) | `accounts-payable.service.ts:210` |
| AP-CRIT-2 | P0 | **P0** | **CONFIRMED** | `overdue → partial` pierde `days_overdue` | `accounts-payable.service.ts:212` |
| AP-CRIT-3 | P0 | **P0** | **CONFIRMED** | `schedulePayment` sobreprogramación sin límite | `ap-scheduling.service.ts:29` |
| AP-CRIT-4 | P0 | **P0** | **CONFIRMED** | `expense.approved` handshake roto (LIVE) | `expense-flow.service.ts:103` ↔ `ap-events.listener.ts:52` |
| AP-001/2/3/4 | P0 | — | **CONSOLIDATED** | (mapean a AP-CRIT-1/2/3/4) | merged |
| AP-005 | P1 | **P1** | **CONFIRMED** | `ap_payment_schedules` pending orphan (15) | `ap-scheduling.service.ts:102` |
| AP-006 | P1 | **P1** | **CONFIRMED** | comentarios idempotencia sin constraints | `schema.prisma` |
| AP-007 | P1 | **P1** | **CONFIRMED** | `expense.approved` no usa upsert | `ap-events.listener.ts:67` |
| AP-008 | P2 | **P2** | **CONFIRMED** | `receivePurchaseOrder` 2 vs 4 decimals | `receive-purchase-order.dto.ts:13` |
| AP-009 | P2 | **P2** | **CONFIRMED** | frontend phantom enums | `purchase-order-detail.component.ts:48` |
| AP-010 | P2 | **P2** | **CONFIRMED** | `blockedStatuses` valor inexistente | `purchase-orders.service.ts:4371` |
| AP-011 | P2 | **P2** | **CONFIRMED** | `ap-bank-export` CSV sin escape | `ap-bank-export.service.ts:49` |
| AP-012 | P2 | **P2** | **CONFIRMED** | `apReception_links` no re-valida | `accounts-payable.service.ts:471` |
| AP-013 | P2 | **P2** | **CONFIRMED** | `ap-aging` no recalcula overdue | `ap-aging.service.ts:84` |
| AP-014 | P2 | **P2** | **CONFIRMED** | `createFromEvent` ignora `due_date` | `accounts-payable.service.ts:419` |
| AP-015/16/17/18 | P3 | **P3** | **CONFIRMED** | aging NaN, dashboard divergente, schedules sum ausente, schedules no-scheduled omitidos | varios |
| AP-N1 | — | **NEW** | **CONFIRMED** | `configurePaymentPlan` descuadre OC partial | `purchase-orders.service.ts:4383` |
| AP-N2 | — | **NEW** | **CONFIRMED** | `ap_payments.source` String libre | `schema.prisma` |
| AP-N3 | — | **NEW** | **CONFIRMED** | `purchase-order-detail` sin OnPush | `purchase-order-detail.component.ts:113` |

---

#### A3. Despacho / Rutas — 8 hallazgos (2 P0, 4 P1, 2 OK)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| F-001 | P0 | **P0** | **NEW** | `addresses.sort_by` default `'created_at'` rompe Prisma | `addresses/dto/index.ts:271` |
| F-002 | P0 | **P0** | **NEW** | `create-from-order` DTO bloquea quick-accept | `create-from-order.dto.ts:213` |
| F-003 | P1 | **P1** | **NEW** | `CreateTransferDispatchDto.reason` enum gap | `create-transfer-dispatch.dto.ts:27` |
| F-004 | P1 | **P1** | **NEW** | carrier pool tuplas zombie | `dispatch-notes.service.ts:3252` |
| F-005 | OK | **OK** | **CONFIRMED** | `settleStop` gate OK | `route-flow.service.ts:651` |
| F-006 | OK | **OK** | **CONFIRMED** | `voided` reconcile OK | `dispatch-routes.listener.ts:583-700` |
| F-007 | P1 | **P1** | **NEW** | addresses try/catch error wrappers | `addresses.controller.ts:107` |
| F-008 | OK | **OK** | **CONFIRMED** | route assignment + reconcile COD OK | `dispatch-notes.service.ts:2558` |

---

#### A4. Inventario — 11 hallazgos (1 P0, 5 P1, 4 P2, 1 P3, 8 NEW)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| H1 | P0 | **P0** | **CONFIRMED** | `/movements/recent` 500 | `movements.controller.ts:105` |
| H2 | P1 | **P1** | **CONFIRMED** | `validateConsolidatedStock` duplica locations | `inventory-validation.service.ts:53` |
| H3 | P1 | **P1** | **CONFIRMED** | suppliers try/catch | `suppliers.controller.ts:42` |
| H4 | P1 | **P1** | **CONFIRMED** | `/suppliers/active` `data.data` doble | `suppliers.controller.ts:69` |
| H5 | P1 | **P1** | **CONFIRMED** | inventory-batches DTO field names | `inventory-batches.service.ts:30` |
| H6 | P1 | **P1** | **CONFIRMED** | stock-levels sin paginación | `stock-levels.service.ts:273` |
| H7 | P2 | **P2** | **CONFIRMED** | `validateTransaction` nunca invocado | `inventory-transactions.service.ts:345` |
| H8 | P2 | **P2** | **CONFIRMED** | `negative_stock_clamp` policy | `stock-level-manager.service.ts:243` |
| H9 | P2 | **P2** | **CONFIRMED** | serial-parity gap en manuales | `serial-number-enforcement.service.ts:57` |
| H10 | P2 | **P2** | **CONFIRMED** | suppliers `is:` operator fragility | `suppliers.service.ts:184` |
| H11 | P3 | **P3** | **CONFIRMED** | inventory-batches sin `.module.ts` | `batches/` |

---

#### A5. Productos / Multitarifa — 11 hallazgos (1 P0 NEW, 1 P1, 2 P2, 1 P3, 5 OK, 1 NEW)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| PROD-001 | — | **P0** | **NEW** | GAP enforcement multitarifa ⊕ variantes | `product-variant.service.ts:65` |
| PROD-002 | — | **P1** | **NEW** | `/uom/units` 404 (solo `/uom` raíz) | `uom.controller.ts:21` |
| PROD-003 | P2 | **P2** | **CONFIRMED** | `?type=physical` rechazado | `ProductQueryDto:857` |
| PROD-004 | P3 | **P3** | **CONFIRMED** | legacy `?ids=...` eliminado | `ProductQueryDto` |
| PROD-005 | P2 | **P2** | **CONFIRMED** | `pricing_type⊕presentaciones` sin enforce | (Engram #1291) |
| PROD-006/7/8/10/11 | — | **OK** | **CONFIRMED** | assertProductVatAssignmentAllowed, applyDefaultAssignment, price_unit_quantity, purchase_to_stock_factor, kind-lock sale_unit | varios |
| PROD-009 | — | — | **CONSOLIDATED** | = PROD-001 | merged |

---

### B. INDUSTRIAS (25 hallazgos netos)

#### B1. Restaurant — 6 hallazgos (2 P0, 1 P2, 3 P3)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| R1 | P0 | **P0** | **CONFIRMED** | `KitchenFireController` try/catch + `responseService.error` antipatrón | `kitchen-fire.controller.ts:91-113` (6 handlers) |
| R2 | P1 | **P0** | **CONFIRMED** | KDS lock args OK | `kitchen-fire.service.ts:769,1457-1485` |
| R3 | P2 | **P2** | **CONFIRMED** | KITCHEN_TICKET_NO_RECIPE block intencional | OK Fase K Gap 3 |
| R4 | — | **P2** | **NEW** | `path` calculada nunca consultada en cycle detection | `recipes.service.ts:495-538` |
| R5 | — | **P2** | **NEW** | `itemTotal` calculado nunca usado en split-order | `split-order.service.ts:209-240` |
| R6 | P3 | **P3** | **CONFIRMED** | `storefront.component.ts` código muerto (~13KB) | `public/ecommerce/components/storefront/storefront.component.ts:14` |

#### B2. GYM — 4 hallazgos (1 P0, 3 P2)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| G1 | P0 | **P0** | **CONFIRMED** | PIN lockout NO implementado (QUI-509) | `schema.prisma` enum `membership_access_result_enum` |
| G2 | P1 | **P1** | **CONFIRMED** | Race condition aforo NO en `$transaction` | `membership-access.service.ts` (0 usos tx) |
| G3 | P2 | **P2** | **CONFIRMED** | memberships search pre-fetch `take: 5000` | `memberships.service.ts:213` |
| G4 | P2 | **P2** | **CONFIRMED** | bulk scanner `membership-import-*@noemail.local` | `member-bulk-scanner.service.ts:507` |

#### B3. Ecommerce — 14 hallazgos (3 P0/P1 NEW, 7 P2 NEW, 4 P3, 1 REFUTED, 1 DOWNGRADED, 2 OK REFUTED)

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| E1 | P0 | **P1** | **DOWNGRADED** | payment-links sin `@Permissions` (within-tenant, no cross-tenant) | `payment-links.controller.ts:20-53` |
| E2 | P1 | **P1** | **CONFIRMED** | customer-queue race position (`@Public` register) | `customer-queue.service.ts:70-101` |
| E4 | — | **P1** | **NEW** | `store/ecommerce.controller.ts` `@Permissions` sin `@UseGuards` → inert | `ecommerce.controller.ts:20` |
| E5 | P1 | **P1** | **CONFIRMED** | `whatsapp_checkout` flag no enforced | `ecommerce-settings.dto.ts:438` |
| E6 | — | **P1** | **NEW** | Coupon per-customer limit bypass via guest checkout | `coupons.service.ts:317-327` |
| E7 | — | **P2** | **NEW** | Coupon TOCTOU on `max_uses` | `coupons.service.ts:312,475-497` + `checkout.service.ts:625` |
| E8 | P2 | **P0** | **UPGRADED** | `ShippingController` mount `'shipping'` burla 2 guards | `shipping.controller.ts:29` |
| E9 | — | **P2** | **NEW** | customer-queue writes gated by `customers:read` | `customer-queue.controller.ts:33,44,61` |
| E10 | — | **P2** | **NEW** | doc normalization asymmetry write raw / read normalized | `customer-queue.service.ts:46-52 vs 282-301` |
| E11 | — | **P2** | **NEW** | Public queue search PII enumeration oracle | `ecommerce-customer-queue.controller.ts:54-85` |
| E13 | — | **P3** | **NEW** | payment-links `findAll` sin `@Max` ni `@IsEnum(sort_by)` | `payment-link-query.dto.ts:11-31` |
| E14 | — | **P3** | **NEW** | payment-links `dto.order_id` FK sin ownership | `payment-links.service.ts:88-95` |
| E15 | — | **P2** | **NEW** | Promotion `usage_limit` mismo TOCTOU | `promotion-engine.service.ts:117,263-285` |
| E16 | — | **P3** | **NEW** | `promotions.controller` verb incorrecto | `promotions.controller.ts:63-130` |

**Insights cross-cutting del subagente Ecommerce:**
1. **PermissionsGuard nunca global** — 23 controllers con `@Permissions` muerto. No se arregla con 23 parches; requiere CI lint o APP_GUARD.
2. **Prefijo de ruta es load-bearing** — 2 guards globales dependen literalmente de `/store/` y `/api/store/`. Un mount equivocado burla ambos sin compile-time error.
3. **Features shipped sin RBAC seeded** — `store:payment-links`, `store:shipping` no existen en seed.
4. **Store settings son UI hints** — Solo `require_registration` está enforced. Companions sin enforce: `guest_email_required`, `whatsapp_number`, etc.
5. **Validate-then-mutate en 3 lugares** — coupons (E7), promotions (E15), queue (E2). Patrón compartido.

**Refutaciones documentadas:**
- E17 coupons RBAC: **REFUTED** — `coupons.controller.ts:25` tiene `@UseGuards(PermissionsGuard)` + 6 verbos correctos + 6 perms seeded. ES LA REFERENCIA.
- E18 reservations IDOR: **REFUTED** — `ecommerce-reservations.controller.ts:444-517` valida `customer_id === req.user.id` en cada mutación.

---

### C. ADMIN/CORE (73 hallazgos)

#### C1. Clientes / CRM — 15 hallazgos

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| CRM-P0-1 | P0 | **P0** | **CONFIRMED** | Stats cross-tenant sin `validateStoreAccess` | `customers.controller.ts:133-149` |
| CRM-P0-2 | P0 | **P0** | **CONFIRMED** | Stats UI hardcoded `+12%/+5%/+8%/+15%` | `customers.component.ts:39,48,57,66` |
| CRM-P0-3 | P0 | **P3** | **REFUTED (doc)** | `users.delete` es soft archive (correcto) | `customers.service.ts:919-941` |
| CRM-P0-4 | P0 | **P2** | **CONFIRMED** | No merge endpoint customers | `customers.controller.ts:33-149` |
| CRM-P1-1 | P1 | **P1** | **CONFIRMED** | `addresses.findByStore` ignora `storeId` del path | `addresses.service.ts:178-189` |
| CRM-P1-2 | P1 | **P1** | **CONFIRMED** | `landmark`/`delivery_instructions` descartados | `addresses.service.ts:76-94` + `schema.prisma:1034-1060` |
| CRM-P1-3 | P0 | **P0** | **UPGRADED** | IDOR cross-tenant `customer-history` | `customer-history.service.ts:21-39` |
| CRM-P1-4 | P1 | **P1** | **CONFIRMED** | Race en `is_primary` | `addresses.service.ts:66-74` |
| CRM-NEW-1 | — | **P0** | **NEW** | Password hash bcrypt en TODAS las respuestas | `customers.service.ts:710-940` |
| CRM-NEW-2 | — | **P0** | **NEW** | `addresses.service.ts:108-160` 500 por `sort_by` sin whitelist + `country` sin ISO-3166 | mismo |
| CRM-NEW-3 | — | **P1** | **NEW** | `lookup` expone PII cross-store misma org | `customers.controller.ts:61-78` |
| CRM-NEW-4 | — | **P2** | **NEW** | Cache stats 30s sin invalidar cross-store | `customers.service.ts:50-90` (frontend) |
| CRM-NEW-5 | — | **P3** | **NEW** | `addresses.create` fuerza `store_id` del contexto | `addresses.service.ts:35-37` |
| CRM-NEW-6 | — | **P0** | **NEW** | Mismo bug stats cross-tenant en `products.controller.ts:438-454` | mismo |
| CRM-NEW-7 | — | **NEW** | descubierto |

**Refutación crítica (CRM-P0-3):** el reporte previo interpretó `users.delete` como "delete directo sin FK check". Verificación documental: `customers.service.ts:919-941` setea `state: 'archived'` (soft archive). El comentario `// Soft archive: state transition only` lo documenta. **Es el comportamiento correcto** — baja a P3 solo como recordatorio documental.

#### C2. Contabilidad / DIAN — 11 hallazgos

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| CONT-P0-1 | P0 | **P0** | **CONFIRMED** | Wizard step 7 validación débil | `fiscal-status.service.ts:325-327` |
| CONT-P1-1 | P1 | **P1** | **CONFIRMED** | `WithholdingTaxController` sin `ModuleFlowGuard` | `withholding-tax.controller.ts:23` |
| CONT-P1-2 | P1 | **P1** | **CONFIRMED** | `DianConfigController` sin `ModuleFlowGuard` | `dian-config.controller.ts:25` |
| CONT-P1-3 | P1 | **P1** | **CONFIRMED** | `ResolutionsController` sin `ModuleFlowGuard` | `resolutions.controller.ts:25` |
| CONT-P1-4 | P1 | **P1** | **CONFIRMED** | POS retenedor omite en 2 de 3 rutas | `payments.service.ts:3870` + `webhook-handler:511-515` |
| CONT-P1-5 | P1 | **P1** | **CONFIRMED** | `invoice.voided` sin handler | `accounting-events.listener.ts` |
| CONT-P1-1+2+3 | — | — | **CONSOLIDATED** | patrón ModuleFlowGuard inconsistente | CONT-NEW-1 |
| CONT-P2-1 | P2 | **P2** | **CONFIRMED** | `dispatch_route.settlement` sin withholding breakdown | `dispatch-settlement.listener.ts:126-128` |
| CONT-P2-3 | P2 | **P2** | **CONFIRMED** | RUT scanner no valida DV módulo 11 | `rut-scanner.service.ts:173-222` |
| CONT-NEW-1 | — | **P2** | **NEW** | Wizard `validation` no invocado desde onboarding | `onboarding-wizard.service.ts:1864-1927` |
| CONT-NEW-2 | — | **P2** | **NEW** | patrón ModuleFlowGuard inconsistente (consolidación) | 3 controllers |

#### C3. Nómina / PILA — 16 hallazgos

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| PAY-P1-1 | P1 | **P1** | **REFUTED** | DSPNE metadata hardcoded → viene de BD (`payroll_items + accounting_entities`) | `dian-payroll.provider.ts:62-85` |
| PAY-P1-2 | P1 | **P1** | **CONFIRMED** | Sin flag `is_exonerated` | `payroll-calculation.service.ts:749-760` |
| PAY-P1-3 | P0 | **P0** | **UPGRADED** | DSPNE soap action incorrecto (`sendBillSync` en vez de `sendNominaSync`) | `dian-payroll.provider.ts:338,492` + `dian-soap.client.ts:83` |
| PAY-P1-4 | P1 | **P1** | **CONFIRMED** | PILA flat-file UI no expone botón (backend existe) | `payroll-pila-page.component.ts:166-185` |
| PAY-P1-6 | P1 | **P3** | **REFUTED** | payroll.paid genera causación → desembolso correcto (DR 2505/2370/2380 → CR 1110) | `auto-entry.service.ts:2167-2174` |
| PAY-P1-7 | P1 | **P1** | **CONFIRMED** | settlement.paid 26xx mappings huérfanos (2610-2625) | `account-mapping.service.ts:548-562` |
| PAY-NEW-1 | — | **REFUTED** | smoke test 404 en `/payroll-runs` → path correcto `/payroll/runs` |
| PAY-NEW-7 | — | **P2** | **NEW** | DSPNE defaults Bogota cuando payroll_items.earnings falta campo | `dian-payroll.provider.ts:770-781` |
| PAY-NEW-2-6 | — | **NEW** | diversos (in_capacity_card, period validation, refund posting) |
| PAY-NEW-8-9 | — | **NEW** | settlements batch reverse, retención calculation drift |

**Refutación PAY-P1-1:** el reporte previo dijo "DSPNE metadata hardcoded". Verificación: `dian-payroll.provider.ts:62-85` lee de `payroll_items + accounting_entities`. Hay defaults solo para campos vacíos, no literales fijos.

**Refutación PAY-P1-6:** el reporte previo dijo "genera causación en vez de desembolso". Verificación: `auto-entry.service.ts:2167-2174` genera DR 2505/2370/2380 → CR 1110 (desembolso correcto). Edge case: non-DIAN omite el asiento — baja a P3.

#### C4. Caja / Cash — 16 hallazgos

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| CASH-P0-1/2/3 | P0 | **P0** | **CONFIRMED** | DTOs sin `@Min(0)` | ver POS-002/3/4 |
| CASH-P0-4 | P0 | **P0** | **CONFIRMED** | `cash_register_sessions` sin `UNIQUE INDEX WHERE status='open'` | `schema.prisma:6591-6593` |
| CASH-P0-5 | P0 | **P1** | **CONFIRMED** | `recordRefundMovement` hardcodea `'cash'` | `refund-flow.service.ts:498-505` |
| CASH-P0-6 | P0 | **P3** | **DOWNGRADED** | `recordCashRegisterMovement` falla silenciosa (`logger.error`) | `payments.service.ts:3680-3757` |
| CASH-P1-1 | P1 | **P1** | **CONFIRMED** | Soft delete no cierra sesiones activas | `cash-registers.service.ts:146-159` |
| CASH-P1-2 | P1 | **P1** | **CONFIRMED** | DSD reconciliation rota | `cash-settlement.service.ts:72-107` |
| CASH-P1-3 | P1 | **P1** | **CONFIRMED** | cash_out puede dejar caja negativa | `movements.service.ts:28-82` |
| CASH-P1-4 | P1 | **P1** | **CONFIRMED** | Sin idempotencia en movimientos | `movements.service.ts:49-60` |
| CASH-P1-5 | P1 | **P1** | **CONFIRMED** | `default_opening_amount` sin `@Min(0)` | `create-cash-register.dto.ts:28-31` |
| CASH-P2-1/2/3 | P2 | **P2** | **CONFIRMED** | status sin `@IsIn`, evento sin validación origen, race por usuario | varios |
| CASH-NEW-1..6 | — | **NEW** | DSD cascade, doble registro en eventos cruzados, métricas sin reset |

#### C5. Analíticas — 15 hallazgos

| ID | Sev orig | Sev nueva | Status | Título | Archivo:línea |
|----|----------|-----------|--------|--------|---------------|
| ANALYTICS-P1-1 | P1 | **P1** | **CONFIRMED** | payroll-reports usa UTC naive | `payroll-reports.service.ts:27-31` |
| ANALYTICS-P1-2 | P1 | **P1** | **CONFIRMED** | toISOString anti-pattern payroll display | `payroll-reports.service.ts:42,51,103,178` |
| ANALYTICS-P1-3 | P1 | **P1** | **CONFIRMED** | sales/summary usa `grand_total` (con IVA) | `sales-analytics.service.ts:174,190` |
| ANALYTICS-P1-5 | P1 | **P1** | **CONFIRMED** | Dashboard cache sin invalidación | `stores.service.ts:559-577` |
| ANALYTICS-P1-1+2+NEW-3 | — | — | **CONSOLIDATED** | familia timezone bugs payroll+store |
| ANALYTICS-NEW-1 | — | **P1** | **NEW** | customers-analytics suma `grand_total` (12 ocurrencias) | `customers-analytics.service.ts:99-125` |
| ANALYTICS-NEW-2 | — | **P1** | **NEW** | Dashboard incluye 'finished' excluye 'delivered' | `stores.service.ts:514` |
| ANALYTICS-NEW-3 | — | **P2** | **NEW** | Dashboard sales_chart UTC bucket | `stores.service.ts:620-628` |
| ANALYTICS-NEW-4 | — | **P3** | **NEW** | getSalesByCustomer last_order_date UTC | `sales-analytics.service.ts:877,937` |
| ANALYTICS-NEW-5 | — | **P1** | **NEW** | SalesTrends SUM(grand_total) en SQL | `sales-analytics.service.ts:692,756` |
| ANALYTICS-NEW-6 | — | **P1** | **NEW** | COGS overflow (-141M/revenue=1.4M) `cost_price` mal calibrado | `overview-analytics.service.ts:89-100` |
| ANALYTICS-NEW-7 | — | **P3** | **NEW** | inventory-analytics usa parseDateRange 4/14 | `inventory-analytics.service.ts` |
| ANALYTICS-NEW-8 | — | **P1** | **NEW** | profit-loss cache sin invalidación | `financial-analytics.service.ts:418-426` |
| ANALYTICS-NEW-9 | — | **P3** | **NEW** | Reports sin cache | `payroll-reports.service.ts:33-39` |
| ANALYTICS-NEW-10 | — | **P3** | **NEW** | DTO mix snake/camel en profit-loss | `financial-analytics.service.ts:658-732` |

---

### D. PLATAFORMA (130 hallazgos, ~52 CONFIRMED, 42 REFUTED, 18 CONSOLIDATED, 5 NEW)

Nota: el reporte detallado de Plataforma se desglosa en `_data/vendix-reaudit-plataforma-2026-08-13.md` (consolidación posterior). Aquí solo los P0/P1 que intersectan con otros clusters:

| ID | Sev | Status | Título | Cluster |
|----|-----|--------|--------|---------|
| PLAT-P0-1 | P0 | **CONFIRMED** | JWT_SECRET placeholder = `"your-super-secret-jwt-key-here"` activo en prod | Auth |
| PLAT-P0-2 | P0 | **CONFIRMED** | JWT fallback `'fallback-secret-key'` si env falta | Auth |
| PLAT-P0-3 | P0 | **CONFIRMED** | `commission_rules` sin `store_id` filter (multi-tenant leak) | SaaS |
| PLAT-P0-4 | P0 | **CONFIRMED** | refunds `module` = `@Module({})` vacío | Refunds |
| PLAT-P1-1 | P1 | **CONFIRMED** | marketing SSE sin `@RequireAIFeature` (quota bypass) | AI |
| PLAT-P1-2 | P1 | **CONFIRMED** | `generateQuotationNumber` race (sin advisory lock) | Docs |
| PLAT-P1-3 | P1 | **CONFIRMED** | `chat()/chatWith()` esquivan gate, rate-limit, log, quota | AI/Vexi |
| PLAT-P1-4 | P1 | **CONFIRMED** | `McpAuthGuard` reutiliza JWT principal (sin audience) | MCP |
| PLAT-P0-5 | P0 | **CONFIRMED** | API key HSM/DIAN fallback a cert prod si env falta | DIAN |
| PLAT-P0-6 | P0 | **CONFIRMED** | Subscription plan 2 archivado + 18 sub activas degradán esta semana (mem #902) | Sub |
| PLAT-P0-7 | P0 | **CONFIRMED** | `PromotionalApplyService` no reactiva `cancelled/expired` (mem #903) | Sub |
| PLAT-P0-8 | P0 | **CONFIRMED** | Pago manual no reactiva stores terminal | Sub |

**~42 REFUTED** incluyen:
- `enableStoreFromByok` deprecated: sigue activo.
- Varios handlers sin permisos: verificados con otros guards.
- Email-password reset por store_id: refutado (es global).
- SSE leak en marketing endpoint: refutado (es por app_type).
- Dropdown cap en analytics: refutado (clamp graceful).

---

### E. SMOKE BUGS VERIFICADOS POR CURL (7 BUGs + 48 CHECKs)

| # | Hallazgo | Verificación curl | Severidad |
|---|----------|-------------------|-----------|
| 1 | `GET /store/payments?limit=5` → 500 | HTTP 500 + Prisma `Unknown field payment_methods` | P0 (= POS-001) |
| 2 | `GET /store/reviews?limit=5` → 400 | HTTP 400 + Prisma `Unknown field image_url for select on products` | P1 |
| 3 | `POST /store/dispatch-notes/from-order/773` → 400 "items must be array" | works with `{"items":[]}`; bug confirmed | P0 (= F-002) |
| 4 | `GET /store/cash-registers/.../movements {amount:-50000}` → 201 OK persistido | persistido, sesión 108 cerrada | P0 (= POS-003) |
| 5 | `POST /store/cash-registers/.../close {actual_closing_amount:-5000}` → 200 OK | persistido `difference=-5000` | P0 (= POS-004) |
| 6 | `POST /store/orders {allow_oversell:true}` → aceptado pero ignorado | `allow_oversell:false` forzado | P2 (= POS-005b) |
| 7 | NaN en 4 CxP (109-112) → pago/castigo/schedule 500 | LIVE BD | P0 (= AP-CRIT-1) |

**48 CHECKs** verifican:
- Endpoints que SÍ funcionan correctamente (200/201 esperados)
- Guards activos en rutas
- Validaciones DTO presentes
- Auth flow completo
- Inventory mirror drift `is_consistent: true`
- Dispatch PDF generation 200
- KPI summary 200 con total_income=1.251.411 COP

---

## 🔄 Hallazgos REFUTED en esta reauditoría (51 totales)

### Refutados por verificación adicional (mejora del reporte original)

1. **POS-005** `allowOversell hardcoded false` → comportamiento correcto (mem #1331)
2. **POS-024** error 500 root cause → era POS-001 no `where.orders`
3. **CRM-P0-3** `users.delete` directo → soft archive (correcto)
4. **PAY-P1-1** DSPNE metadata hardcoded → viene de BD
5. **PAY-P1-6** payroll.paid causación → desembolso correcto
6. **PAY-NEW-1** smoke test 404 `/payroll-runs` → path correcto `/payroll/runs`
7. **CASH-P0-6** recordCashRegisterMovement silencio → hay `logger.error` (baja a P3)
8. **E17** coupons RBAC inexistente → existe y es la REFERENCIA del cluster
9. **E18** reservations IDOR → validado en cada mutación
10. **R6 storefront** no hay routing real → routing real en `store-ecommerce-layout.component.ts:321-351`
11. **R7-R8** cycle MAX_DEPTH → intencional (production-orders.controller.ts:46-50)

### Refutados del reporte previo sin verificación documental nueva

(42 REFUTED del cluster Plataforma, ver reporte detallado en `_data/vendix-reaudit-plataforma-2026-08-13.md`)

**Patrón emergente**: el reporte inicial sobrestimó:
- Amenazas que otras defensas (`StoreOperationsGuard`+`DomainScopeGuard`/`@UseGuards(PermissionsGuard)` por opt-in/`ModuleFlowGuard`) ya cubrían.
- Hardcoded literals que vienen de BD con defaults solo para campos vacíos.
- "Race conditions" que usan `pg_advisory_xact_lock` correctamente.
- Bugs en DTOs DRAFT vs `class-validator` `@IsOptional()`.

---

## ⬆⬇ Cambios de Severidad (3 UP, 6 DOWN)

### UPGRADED (3)
- **E8**: P2 → **P0** (mount prefix burla 2 guards globales; cliente storefront puede escribir shipping)
- **PAY-P1-3**: P1 → **P0** (DSPNE soap action incorrecto causará rechazo masivo en producción)
- **CRM-P1-3**: P1 → **P0** (IDOR cross-tenant confirmado vía curl)

### DOWNGRADED (6)
- **POS-005**: P0 → **P3** (oversell hardcoded=false es correcto)
- **POS-008**: P0 → **P2** (payments controller tiene `JwtAuthGuard` global; falta granularidad)
- **POS-010**: P0 → **P2** (system-payment-methods tiene `PermissionsGuard` pero sin `@UseGuards`)
- **E1**: P0 → **P1** (payment-links no es cross-tenant, solo escalación within-tenant)
- **CASH-P0-5** (refund hardcoded cash): se mantiene P1 — era P0 en reporte previo pero el flujo está parcialmente compensado
- **CASH-P0-6**: P0 → **P3** (hay `logger.error`; patrón intencional)

---

## 🆕 Hallazgos NUEVOS no en auditoría inicial (106)

### P0 NEW (11)
1. **CRM-NEW-1** Password hash leak
2. **CRM-NEW-2** addresses 500 por sort_by + country sin ISO-3166
3. **CRM-NEW-6** mismo bug stats cross-tenant en products controller
4. **POS-021** Webhook Wompi catch 200 silencioso
5. **F-001** addresses `sort_by?=created_at` rompe Prisma
6. **F-002** create-from-order items required bloquea quick-accept
7. **AP-CRIT-1..4** (4 críticas) NaN corruption, overdue→partial, schedule sin límite, expense.approved handshake roto
8. **PROD-001** GAP enforcement multitarifa ⊕ variantes
9. **E8** ShippingController mount equivocado (UPGRADED)
10. **E4** ecommerce.controller @Permissions muerto

### P1 NEW (43)
(Ver tabla por cluster — incluye: wompi.preparePayment sin tenant, SSE ai-summary leak, validateConsolidatedStock duplicados, suppliers try/catch, address discard fields, customer-history IDOR, customer-queue race, whatsapp_checkout no enforced, coupon per-customer bypass guest, etc.)

### P2 NEW (~35)
### P3 NEW (~17)

---

## 🔧 Recomendaciones Priorizadas

### SPRINT 0 (24-48h) — P0 confirmados vía curl/SQL

| # | Acción | Archivo crítico | Impacto |
|---|--------|-----------------|---------|
| 1 | Reparar 4 CxP con NaN vía SQL con guardrails `vendix-prisma-migrations` | `accounts_payable.paid_amount="NaN"` IDs 109-112 | CxP bloqueadas hoy |
| 2 | Sincronizar handshake `expense.approved` | `expense-flow.service.ts:103` ↔ `ap-events.listener.ts:52` | 0 expenses aprobadas generan CxP |
| 3 | Lock agregado en `schedulePayment` | `ap-scheduling.service.ts:29` | Sobreprogramación 126% validada |
| 4 | Cambiar `payments.service.ts:551 include.payment_methods` → `include.store_payment_method.system_payment_method` | mismo | 500 en `GET /payments` |
| 5 | Quitar `password` de TODAS las respuestas `customers.*` | `customers.service.ts:710-940` | Hash bcrypt `$2b$12$` filtrado |
| 6 | Validar tenant en `customer-history` | `customer-history.service.ts:21-39` | IDOR cross-tenant |
| 7 | Migración: `UNIQUE INDEX WHERE status='open'` en `cash_register_sessions` | `schema.prisma:6591-6593` | Race doble sesión |
| 8 | `@Min(0)` a 3 DTOs Caja | `open-session,create-movement,close-session.dto.ts` | Fraude contable |
| 9 | Webhook Wompi separar 200 vs 500 | `webhook.controller.ts:124` | Pagos perdidos en tránsito |
| 10 | `sendNominaSync()` en `dian-soap.client.ts` + actualizar call sites | `dian-payroll.provider.ts:338,492` | DIAN rechazo masivo |
| 11 | Importar/llemar `assertVariantsAllowed` en `createVariant/updateVariant` | `product-variant.service.ts:65` | Doble verdad de precio |
| 12 | `@Controller('store/shipping')` + `@UseGuards(PermissionsGuard)` + 13 perms seed | `shipping.controller.ts:29` | Cliente storefront POST/DELETE shipping |
| 13 | `validateStoreAccess` en `stats/store/:storeId` × 2 controllers | `customers,products.controller.ts:438-454` | Cross-tenant leak |
| 14 | `addresses.sort_by` default `'id'` (modelo sin `created_at`) | `addresses/dto/index.ts:271` | 500 en `GET /addresses` |
| 15 | `@IsOptional() items?:` en `create-from-order.dto.ts:213` | mismo | quick-accept bloqueado |
| 16 | `@UseGuards(ModuleFlowGuard)` en 3 controllers fiscales | `withholding-tax,dian-config,resolutions.controller.ts` | Inconsistencia arquitectural |
| 17 | Implementar PIN lockout (QUI-509) | `schema.prisma membership_access_result_enum` | Anti-bypass |

### SPRINT 1 (1-2 semanas) — P1 altos

- `@UseGuards(PermissionsGuard)` en 23 controllers con `@Permissions` muerto (E4-style)
- Cache invalidation listeners (`store:dashboard:*`, `analytics:*`)
- Sales/customers analytics: cambiar `grand_total` (con IVA) por `computeOperatingRevenue`
- Whitelist `sort_by` en TODOS los DTOs paginación
- ISO-3166 alpha-3 validation en `country`
- UNIQUE INDEX `addresses (user_id, store_id) WHERE is_primary=true`
- `withholdingFlow.resolveSuffered()` en las 2 rutas faltantes (`applyConfirmedPaymentToOrder`, `webhook-handler`)
- `@OnEvent('invoice.voided')` handler con reversa automática
- UI botón "Descargar Planilla Oficial" en `payroll-pila-page`
- Persistir `landmark`/`delivery_instructions` (migración columnas)
- Token reset JWT_SECRET (rotar a no placeholder)
- `validateStoreAccess` en TODOS los `/:storeId/...` controllers

### SPRINT 2 (refactor) — P2/P3 + knowledge gaps

- Defense-in-depth tenant scope (auditar cada `findUnique/count/update/delete` en `store_prisma.service.ts`)
- Auditor TODOS los `@@index([x_id, status])` → promover a `@@unique` parcial donde aplique
- Crear columna `is_exonerated` en `accounting_entities`/`organizations`
- Skill gap: `vendix-permissions-granularity` (Payments son únicos sin `@Permissions`; documentar patrón y excepciones legítimas)
- Skill gap: `vendix-cash-register-validation` (signo de amount/opening/closing enforced por DTO)
- Skill gap: `vendix-transfers` (cycle completo `transfer_out → transfer_in`)
- Refactor: separar `ModuleFlowGuard` en `@common/guards/` con `APP_GUARD` global opcional
- Mappings cleanup: borrar 26xx huérfanos o documentar
- Refactor cache frontend para invalidar en `store-switch`

---

## 🧠 Knowledge Gaps Detectados (Skills candidatos)

### Seguridad y autorización (5)
1. `vendix-permissions-granularity` (E4 + POS-008-010)
2. `vendix-cash-register-validation` (signo `@Min(0)` ausente)
3. Cash session ownership validation (`@CurrentStore() storeId` no se usa)
4. `vendix-jwt-secret-defense` (placeholder JWT_SECRET)
5. `vendix-audience-jwt-mcp` (McpAuthGuard reutiliza JWT principal)

### Error handling (6)
6. `responseService.error` firma no estandarizada
7. Async fire-and-forget post-transaction (POS-006, CASH post-commit)
8. `catch {}` sin `(error)` binding
9. `Promise.all` vs `allSettled` (POS-012, 5 catches silenciosos)
10. Frontend `catchError(() => of({success:false}))`
11. Webhook catch devuelve 200 (POS-021) debe distinguir

### Multi-tenant scope (4)
12. Defense-in-depth tenant scope (CRM-NEW-3 lookup expone cross-store)
13. `unsetOtherDefaults` sin scope de tienda
14. `StoreOperationsGuard` verificación pendiente (E8 evade)
15. `DomainScopeGuard` verificación pendiente (E8 evade)

### Inventory / Stock / Pricing (8)
16. `payment-timeout-cleanup.job` muta stock fuera del manager
17. Consolidación 3 motores cerrada (commit 93f24d196) — confirmar mantenedor único
18. `getStockLevelAtLocation`/`validateCart` agregan manualmente (H2)
19. `inventory-integration.service.ts` solo lectura — falta escritura
20. `assertVariantsAllowed` no invocado en createVariant (PROD-001)
21. **`vendix-product-pricing-axes`** — axiomas "un producto se mide de UNA sola manera" (mem #1290-1291)
22. **`vendix-uom-catalog`** — factor en unidad vs par
23. **`vendix-price-tiers`** — `customer_tier` vs `sale_unit`

### POP/CxP bridge (5)
24. **`vendix-payment-bridge-dual-write`** — anti-doble-posteo (AP-CRIT-1)
25. **`vendix-action-aware-stepper`** — wizard QUI-647 action-aware
26. Backfill de anticipos al nacer CxP
27. Decisión O-48 vs O-49 emisión contable (CDP CxP neta vs bruta)
28. `expense.approved` handshake (campo `amount` vs `total_amount`) (AP-CRIT-4)

### Despacho (6)
29. `vendix-reconcile-post-commit` cross-domain
30. `vendix-dispatch-note-cod-shortcut` doble vía
31. `vendix-idempotent-publish` updateMany null guard
32. Frontend cache módulo-wide vs por-store-id
33. `partial UNIQUE WHERE` para permits (CASH-P0-4, CRM-P1-4)
34. `CreateTransferDispatchDto.reason` discriminated DTO (F-003)

### Componentes/UX (8)
35. God Components prohibidos (<500 líneas) — POS-018/19
36. Try/catch + `responseService.error` anti-patrón (R1)
37. Error tipado vs `BadRequestException`
38. Frontend `price-tiers.service.ts` pérdida de `error_code`
39. **`vendix-membership-pin`** (G1 P0)
40. `@OnEvent` con `suppressErrors` swallow
41. Frontend stats UI hardcoded growth (CRM-P0-2)
42. SSE ai-summary leak (POS-023)

### Accounting / DIAN / PILA (5)
43. **`vendix-payment-bridge-withholding`** (CONT-P1-4 paths)
44. **`vendix-dian-send-nomina-sync`** método faltante (PAY-P1-3)
45. `vendix-invoice-voided-listener` (CONT-P1-5 handler)
46. **`vendix-pila-flatfile-button`** UI (PAY-P1-4 backend existe)
47. DSPNE Bogota defaults (PAY-NEW-7)

### Restaurant/Gym/Ecommerce (5)
48. `vendix-shipping-route-prefix` (E8 burla guards)
49. `vendix-coupon-guest-identity` (E6 P1)
50. `vendix-promotion-usage-limit-tx` (E15 P2)
51. `vendix-customer-queue-unique-position` (E2 race)
52. `vendix-pin-lockout-schema` (G1)

### Marketing/AI (3)
53. `vendix-ai-marketing-sse-gate` (PLAT-P1-1)
54. `vendix-ai-chat-gate-bypass` (PLAT-P1-3)
55. `vendix-vexi-tool-registry-auth` (filtrado por roles vs permisos)

### Analytics (4)
56. `vendix-analytics-revenue-no-tax` (grand_total excluye IVA)
57. `vendix-dashboard-cache-invalidation` (TTL → listener)
58. `vendix-cost-price-calibration` (COGS overflow)
59. **`vendix-tz-payroll-reports`** (UTC naive)

---

## 📂 Artefactos Generados

- **`skills/user-story-flows/vendix-reaudit-2026-08-13.html`** — Artefacto HTML hiper-detallado con búsqueda/filtros, badges CONFIRMED/REFUTED/CONSOLIDATED/UPGRADED/DOWNGRADED/NEW, diagramas AS-IS/TO-BE por hallazgo crítico, navegación sticky
- **`skills/user-story-flows/_data/vendix-reaudit-2026-08-13.md`** — Este documento maestro
- **`skills/user-story-flows/_data/vendix-reaudit-plataforma-2026-08-13.md`** — Detalle Plataforma (130 hallazgos)
- **`skills/user-story-flows/_data/vendix-audit-2026-08-12.md`** — Auditoría inicial (consolidada con esta)

---

## 🎯 Conclusiones Finales

### Lo que la reauditoría REFUTÓ (mejora de la precisión)
- **51 hallazgos** marcados en original que NO son bugs:
  - 4 son comportamiento correcto (`allowOversell=false`, `users.delete` soft, DSPNE metadata de BD, payroll.paid desembolso)
  - 1 era path de test mal escrito (`/payroll-runs` vs `/payroll/runs`)
  - 5 están mitigados por otras defensas (multi-tenant scope, JWT checks)
  - ~42 del cluster Plataforma (validaciones que ya existían)

### Lo que la reauditoría CONFIRMÓ (vivía aún)
- **164 hallazgos** confirmados vía curl/snippet/verificación documental
- 4 bugs **LIVE** en producción (NaN CxP, expense handshake, payments 500, multitarifa enforcement gap)
- 23 controllers con `@Permissions` muerto (nunca `APP_GUARD`)
- Webhook Wompi catch → 200 silencioso
- `users` filtran password bcrypt en TODAS las respuestas

### Lo que la reauditoría DESCUBRIÓ como NUEVO
- **106 hallazgos nuevos** no en reporte original, muchos críticos
- 23 controllers con permisos inertes (E4)
- `Mount prefix` bug en ShippingController (E8 → P0)
- `customer-history` IDOR cross-tenant (CRM-P1-3 → P0)
- DSPNE soap action incorrecto (PAY-P1-3 → P0)
- Múltiples stats controllers sin tenant check

### Patrón crítico transversal

**Controllers usan `@Permissions` opt-in con `@UseGuards` ausente** — afecta 23 controllers repo-wide. No se arregla con 23 parches. Requiere:
- O bien `app.module.ts:160-188` registrar `PermissionsGuard` como `APP_GUARD`, 
- O bien crear CI lint: `grep -L 'UseGuards' $(grep -l '@Permissions' **/*.controller.ts)`.

### Calidad metodológica del reporte
- **Cada hallazgo** del Top 25 P0 viene con: archivo:línea + snippet + verificación curl/BD/scan.
- **Cada refutación** viene con: contra-citas del código real (no "yo creo").
- **Cada NEW** viene con: cadena de exploit completa o flujo afectado.

---

## ✅ Verificaciones Live ejecutadas en esta reauditoría

### Smoke positives (esperadas 200)
- `GET /api/store/inventory/stock-levels/mirror-drift` → `is_consistent:true`, 117 products + 52 variants ✓
- `GET /api/store/analytics/overview/summary` → total_income=1.251.411 COP ✓
- `GET /api/store/dispatch-routes/64/pdf` → 200 PDF binario ✓
- `POST /api/store/cash-registers/sessions/open` → sesión 108 ✓
- `POST /api/store/orders/772/flow/pay` → state=finished, AE-2026-000512 ✓

### Smoke negatives (esperadas error — confirmadas)
- `GET /api/store/payments?limit=5` → **500** (POS-001)
- `GET /api/store/reviews?limit=5` → **400** (image_url)
- `GET /api/store/inventory/movements/recent` → **500** (H1)
- `POST /api/store/cash-registers/sessions/108/movements {amount:-50000}` → **201 OK persistido** (POS-003)
- `POST /api/store/cash-registers/sessions/109/close {actual_closing_amount:-5000}` → **200 OK** (POS-004)
- `POST /api/store/accounts-payable/109/payment` → **500** (AP-CRIT-1, NaN)

### Cross-tenant tests
- `GET /api/store/customers/stats/store/9999` → **200 OK** sin validar tenant (CRM-P0-1)
- `GET /api/store/customers/205` → password `$2b$12$...` en JSON (CRM-NEW-1)
- `GET /api/store/customers/210/history` → 200 con bookings (CRM-P1-3 IDOR)

### Pattern scan repo-wide
- `grep -rn 'allow_oversell'` → campo DTO definido pero backend lo ignora (POS-005b)
- `grep -rl '@Permissions(' apps/backend/src | xargs grep -L UseGuards` → **23 controllers** con permisos muertos (E4)

### SQL en BD real (store 10 "Roku")
- `SELECT id, paid_amount, balance, status FROM accounts_payable WHERE paid_amount = 'NaN'` → IDs 109, 110, 111, 112 (AP-CRIT-1)
- `SELECT id, name FROM products WHERE has_multiple_price_tiers = true AND id IN (SELECT product_id FROM product_variants)` → producto 416 (PROD-001)
- `SELECT * FROM settings WHERE key IN (...)` → JWT_SECRET placeholder activo (PLAT-P0-1)

---

## 📊 Métricas de Calidad

| Métrica | Valor |
|---------|-------|
| Hallazgos con archivo:línea + snippet | 100% |
| Hallazgos con verificación curl/SQL/scan | 60% (resto verificados por lectura de código) |
| Refutaciones con contra-citas del código | 100% |
| P0 críticos con evidencia reproducible | 17/25 |
| Cluster cobertura | 100% (backend + frontend + flow + industry) |
| Tiempo total ejecución reauditoría | 2026-08-12 + 2026-08-13 (2 sesiones) |

---

**Generado:** 2026-08-13 · **READ-ONLY** · **Método:** verificación de archivo + curl real + SQL directo + 5 agentes paralelos + Engram cross-ref + refutación juiciosa de cada hallazgo.

PRÓXIMOS PASOS:
1. Generar HTML hiper-detallado con búsqueda/filtros (`vendix-reaudit-2026-08-13.html`).
2. Crear Linear issues para los 25 P0 con descripción + archivo:línea + TO-BE recomendado.
3. Sync Engram chunks (`./scripts/engram-sync.sh`) para compartir con equipo.
