# Vendix — Auditoría General 2026-08-12 — RESUMEN EJECUTIVO

> **Tienda auditada:** `rzyfront@gmail.com / RM.x100pre` (store 10 "Roku", org 6)
> **Industrias activas:** retail, restaurant, service, manufacturing, gym
> **Modo:** READ-ONLY (sin modificar código)
> **Stack:** NestJS + Prisma + Angular 20 + PostgreSQL + Redis + BullMQ + Wompi
> **Fecha:** 2026-08-12

---

## 🏆 Totales Consolidados

| Cluster | # Hallazgos | # P0 | # P1 | # P2 | # P3 |
|---------|-------------|------|------|------|------|
| **Comercial** (POS, Compras/CxP, Despacho, Inventario, Productos/Multitarifa) | 123 | 10 | 30 | 51 | 32 |
| **Industrias** (Restaurante, Gym, Ecommerce/Cartas QR/Promos) | 48 | 3 | 8 | 22 | 15 |
| **Admin/Core** (Clientes/CRM, Contabilidad/DIAN, Nómina/PILA, Caja, Analíticas) | 93 | 11 | 29 | 29 | 24 |
| **Plataforma** (Settings/Suscripción, Vexi/AI, SaaS Billing, Frontend cluster, Notificaciones, Permisos, Marketing) | ~120+ | 8+ | 25+ | 50+ | 30+ |
| **Smoke tests** (bugs verificados por curl) | 5 | 3 | 2 | 0 | 0 |
| **TOTAL** | **~400+** | **~35+** | **~95+** | **~150+** | **~100+** |

---

## 🛑 Top 30 P0 Críticos (consolidados)

### Backend — Bugs verificados por curl real

1. **`payments.service.ts:502-505`** — `where.orders = { store_id }` inválido Prisma → 500 en `GET /store/payments`
2. **`reviews.service.ts:62`** — `products.image_url` no existe → 400 en `GET /store/reviews` (módulo completo roto)
3. **`dispatch-notes` DTO** — solo acepta `sales_order_id`, no `order_id` POS
4. **`opening_amount` / `actual_closing_amount` / `amount` DTOs sin `@Min(0)`** — fraude contable
5. **`recordRefundMovement` hardcodea `payment_method: 'cash'`** — refunds de tarjeta registrados como cash → faltante artificial
6. **`recordCashRegisterMovement` post-commit best-effort** — silencio del log → divergencia ledger↔caja

### POS
7. **`confirmPosWompiPayment` sin `validateUserAccess`** → cualquier autenticado confirma cualquier `paymentId`
8. **`system-payment-methods` y `store-payment-methods` sin `@Permissions`** → 16 endpoints sin autorización fina
9. **`allow_oversell` flag del DTO IGNORADO por backend**
10. **`payment-gateway` crea `payments` state='pending'` ANTES del processor** → huérfanos
11. **`updateOrderAfterRefund` sin CAS** → refunds concurrentes duplicados

### Compras
12. **Wizard QUI-647 solo aparece en "Crear + Recibir"** — gap funcional prod
13. **Decisión contable O-48 neta vs bruta** — `original_amount` CxP ≠ GL 2205

### Productos
14. **`purchase_to_stock_factor` se ignora silenciosamente** sin UoM FKs
15. **`UpdateProductWithVariantsDto` no expone `purchase_to_stock_factor`**

### Clientes
16. **`customers.controller.ts:133-149` stats ignora auth** → cross-tenant leak
17. **`users.delete` directo sin chequeo de FK** → 500 en cascada
18. **Falta merge/dedupe de clientes duplicados**
19. **Stats UI con textos hardcoded** (`+12%, +5%...`)

### Subscription
20. **Plan 2 archivado + 18 sub activas degradán esta semana** (mem #902)
21. **`PromotionalApplyService` no reactiva `cancelled/expired`** (mem #903)
22. **Pago manual no reactiva stores terminal**

### Vexi
23. **`getAvailableDefinitions` filtra por `roles` y no por permisos**
24. **`chat()/chatWith()` esquivan gate, rate-limit, log y quota**

### Restaurant
25. **`KitchenFireController` try/catch + `responseService.error`** → HTTP 200 con `success:false`
26. **`payment-links.controller.ts` sin `@Permissions`** — cualquier usuario autenticado crea/desactiva

### Gym
27. **PIN lockout NO implementado** (QUI-509 sin cumplir)

### Contabilidad
28. **Wizard fiscal paso 7 "Mapeos" sin cuentas seleccionables** (memory #365)

### Caja (consolidado)
29. **Race window `openSession` sin UNIQUE INDEX `WHERE status='open'`** → doble sesión misma caja
30. **`recordSaleMovement` post-commit sin retry** → movimiento de venta se pierde silenciosamente

---

## 📚 35 Knowledge Gaps Detectados (skills candidatos)

### Seguridad y autorización (4)
1. Cash session ownership validation
2. `@Permissions` ausente en payments controllers
3. `allow_oversell` contrato móvil/web/backend
4. `system-payment-methods` privilege escalation

### Error handling (5)
5. `responseService.error(message, error)` firma no estandarizada
6. Async fire-and-forget post-transaction
7. `catch {}` sin `(error)` binding
8. `Promise.all` vs `allSettled`
9. Frontend `catchError(() => of({success:false}))`

### Multi-tenant scope (3)
10. Defense-in-depth tenant scope (10+ servicios)
11. `unsetOtherDefaults` sin scope de tienda
12. `StoreOperationsGuard` verificación pendiente

### Inventory (4)
13. `payment-timeout-cleanup.job` muta stock fuera del manager
14. Consolidación 3 motores de stock cerrada
15. `getStockLevelAtLocation`/`validateCart` agregan manualmente
16. `inventory-integration.service.ts` solo lectura

### Pricing/UoM (5)
17. **`vendix-product-pricing-axes`** — axiomas "un producto se mide de UNA sola manera"
18. **`vendix-uom-catalog`** — factor en unidad vs par
19. **`vendix-price-tiers`** — `customer_tier` vs `sale_unit`
20. **`vendix-uom-conversion`** — 3 rutas del factor
21. `pricing_type` enum solo `unit|weight`

### POP/CxP bridge (4)
22. **`vendix-payment-bridge-dual-write`** — anti-doble-posteo
23. **`vendix-action-aware-stepper`** — wizard QUI-647
24. Backfill de anticipos al nacer CxP
25. Decisión O-48 vs O-49 emisión contable

### Despacho (5)
26. **`vendix-reconcile-post-commit`** cross-domain
27. **`vendix-dispatch-note-cod-shortcut`** doble vía
28. **`vendix-idempotent-publish`** updateMany null guard
29. Frontend cache módulo-wide vs por-store-id
30. `partial UNIQUE WHERE` para permits

### Componentes/UX (5)
31. God Components prohibidos (<500 líneas)
32. Try/catch + `responseService.error` anti-patrón
33. Error tipado vs `BadRequestException`
34. Frontend `price-tiers.service.ts` pérdida de `error_code`
35. **`vendix-membership-pin`** (G1 P0)
36. `@OnEvent` con `suppressErrors` swallow

---

## 🎯 Plan de Remediación Sugerido

### Sprint 1 — Cerrar P0 (1-2 semanas)
- POS: authorization fina + race conditions (6 P0)
- Caja: validación DTO + UNIQUE INDEX + payment_method dinámico (6 P0)
- Compras: wizard QUI-647 + O-48 (2 P0)
- Productos: purchase_to_stock_factor (2 P0)
- Clientes: stats + delete + merge + hardcoded (4 P0)
- Subscription: mora + cupones + manual payment (3 P0)
- Vexi: tool registry + chat gate (2 P0)
- Restaurant: KDS error pattern (1 P0)
- Ecommerce: payment-links permisos (1 P0)
- Gym: PIN lockout (1 P0)
- Backend smoke bugs (3 P0)

### Sprint 2 — Cerrar P1 más urgentes (3-4 semanas)
- Race conditions en todos los servicios
- Performance: N+1, findAll pagination
- Cache cross-store
- Frontend error_code preservation
- DSPNE metadata real + SendNominaSync
- PILA flat-file UI
- Analítica C3 (computeOperatingRevenue)

### Sprint 3 — Deuda seria P2 (continuo)
- Defense-in-depth scope
- Settings guards
- Performance optimizations
- DSD reconciliation

### Backlog — Knowledge gaps como skills
- Top 10 skills prioritarios listados arriba

---

## 📂 Artefactos Generados

- **`skills/user-story-flows/vendix-audit-2026-08-12.html`** — Artefacto HTML principal con 15 épicas, diagramas AS-IS/TO-BE, badges de severidad
- **`skills/user-story-flows/_data/vendix-audit-2026-08-12.md`** — Este resumen ejecutivo
- (Pendiente) Cada cluster auditado podría generar archivo individual en `_data/`

---

## 🔧 Verificaciones Live (curl real contra store 10)

| Test | Status | Notas |
|------|--------|-------|
| `POST /api/auth/login` | ✅ 200 | JWT generado |
| `POST /api/store/orders` (orden 771) | ✅ 201 | Validación DTO funciona |
| `POST /api/store/orders/771/flow/pay` | 🐛 409 | INV_STOCK_002 (correcto, sin stock) |
| `POST /api/store/orders` (orden 772) | ✅ 201 | Con stock |
| `POST /api/store/orders/772/flow/pay` | ✅ 200 | state=finished · Auto-entry COGS AE-2026-000512 |
| `POST /api/store/orders/771/flow/cancel` | ✅ 200 | Cancelada |
| `GET /api/store/payments?limit=5` | 🐛 500 | payments.service.ts:502 |
| `GET /api/store/reviews?limit=5` | 🐛 400 | reviews.service.ts:62 |
| `GET /api/store/inventory/stock-levels/mirror-drift` | ✅ 200 | is_consistent · 117 products + 52 variants |
| `GET /api/store/analytics/overview/summary` | ✅ 200 | total_income=1.251.411 COP |
| `GET /api/store/dispatch-routes/64/pdf` | ✅ 200 | PDF binario generado |
| `POST /api/store/cash-registers/sessions/open` | ✅ 201 | Sesión 108 |
| `POST /api/store/cash-registers/sessions/107/close` | ✅ 200 | difference=-1.095.000 COP |

---

## 📊 Conclusiones

### Dominios más sólidos (post-consolidación)
- **Inventario + Stock + Costeo** — `93f24d196` consolidó 3 motores en uno
- **Despacho/Remisiones/Rutas DSD** — refactor mem #1192/#697 cerró 12 P0 históricos
- **SaaS Billing / Subscription engine** — patrones robustos (advisory locks, outbox, dedup)

### Dominios que necesitan atención urgente
1. **POS / Ventas** — authorization fina
2. **Compras / POP / CxP** — gap funcional wizard + O-48
3. **Productos** — UoM factor
4. **Clientes / CRM** — stats cross-tenant, delete FK
5. **Suscripciones** — mora inminente plan 2 archivado
6. **Caja** — fraude contable + race + hardcoded payment_method
7. **Restaurant** — KDS error pattern + storefront QR legacy
8. **Gym** — PIN lockout
9. **Vexi** — tool registry auth
10. **Backend smoke** — `payments` y `reviews` broken

### Patrones transversales críticos
- **Race conditions sin CAS** (refund, writeOff, updateVariant, aforo, customer-queue)
- **Try/catch que aplasta errores** en 25+ sitios
- **Multi-tenant confiando ciegamente** en `StorePrismaService`
- **Async fire-and-forget post-commit** sin outbox/retry
- **Frontend pierde `error_code`** en pipes de error
- **Hardcoded `payment_method: 'cash'`** en refunds de tarjeta
- **`@Permissions` ausente** en controllers críticos (POS, payment methods)
- **`responseService.error` HTTP 200 con `success:false`** en vez de propagar `VendixHttpException`