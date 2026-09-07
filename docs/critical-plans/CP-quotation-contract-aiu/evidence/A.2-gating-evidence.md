# Evidencia A.2 — Gating por industria construction

- Step: A.2 (contracts FB-02, ERR-03; ADR-02)
- Rama: develop. Alcance respetado: constante de industrias, menu/filter (keymap + catalogo + APP_MODULES), `panel-ui.guard.ts` (rama industry), `error-messages.ts` (solo ERR-03), backend (`error-codes.ts` solo ERR-03, helper de capacidades, guard nuevo + spec, fallback panel_ui, seed de permisos). NO tocados: `quotations.service.ts`, DTOs de quotations, PLAN.md, ledger/registry/log (del orquestador), sidebar-layout (la entrada visual llega con C.2), steps ajenos.
- Relectura fresca de A.1: HEAD local `76ce3ab95` incluye destino inmutable; `origin/develop` va detras (A.1 sin push, prohibido pushear). Sin pull/merge/rebase por prohibicion del workflow.

## Cambios

Frontend (key `orders_contracts`, ruta canonica `/admin/orders/contracts`):
1. `shared/constants/industry-modules.constant.ts` — `orders_contracts` en las listas de ocultos de retail/restaurant/manufacturing/service/gym; ausente en `construction`; parrafo Contracts Suite en el doc-block.
2. `shared/constants/app-modules.constant.ts` — hijo `orders_contracts` ("Contratos") bajo Ordenes (sin esta key el drift-spec del backend fallaria al revés y el editor no la renderizaria).
3. `shared/constants/store-module-catalog.constant.ts` — `MODULE_ROUTES.orders_contracts` (el catalogo derivado y `resolveKeysForRoute` la cubren solos).
4. `core/services/menu-filter.service.ts` — `moduleKeyMap` `Contratos → orders_contracts` (el filtro y `diagnose()` la gobiernan sin mas codigo).
5. `core/guards/panel-ui.guard.ts` — rama `industry`: URL directa a modulo oculto por industria redirige al primer activo con toast ERR-03 (`No disponible en tu industria...`). Antes solo cerraba panel_ui; la URL directa de industria quedaba abierta. Owner conserva su bypass global (case 7); la frontera anti-manipulacion es el backend.
6. `core/utils/error-messages.ts` — `CONTRACT_INDUSTRY_001` → mensaje ERR-03.
7. Specs: `menu-filter.service.spec.ts` (+3 casos puros de `getModulesHiddenByIndustries`), `panel-ui.guard.spec.ts` (+1 caso industry con mensaje ERR-03).

Backend:
8. `common/errors/error-codes.ts` — `CONTRACT_INDUSTRY_001` 403 (ERR-03).
9. `common/helpers/industry-capabilities.helper.ts` — `INDUSTRIES_SUPPORTING_CONTRACTS=['construction']` + `storeSupportsContracts()` con semantica OR (espejo del frontend; null/vacio → false). Patron copiado de `storeIndustriesSupportIngredients`/`storeIsRestaurant`.
10. `common/guards/construction-industry.guard.ts` (NUEVO) — `CanActivate`: sin `store_id` → pasa (lo gobierna auth/contexto); store inexistente → pasa (el NOT_FOUND del dominio lo gobierna); sin `construction` → 403 `CONTRACT_INDUSTRY_001` con `{store_id, industries}`; con `construction` (sola o multi) → pasa. Sin tienda NO hay bypass por rol: la industria es estructural, no un toggle.
11. `common/guards/__tests__/construction-industry.guard.spec.ts` (NUEVO) — 7 casos (matriz del guard).
12. `common/services/default-panel-ui.service.ts` — `orders_contracts: true` con decisiones de plan (`default_visible_for_privileged_users=true`, `show_new_badge=yes`; la compuerta es industria, esto es solo default).
13. `prisma/seeds/permissions-roles.seed.ts` — `store:contracts:create/read/read:one/update` con paths de C.1 (`/api/store/contracts...`). Owner/admin/manager los heredan por los catch-all existentes (`store:` / no-superadmin): cero listas explicitas que mantener. El seed NO se ejecuto contra DB (cambio de codigo + spec; la corrida va con el deploy/C.1).

Decisiones que el step no traia y se fijan aqui (skill vendix-panel-ui las exige para toda key nueva en fallback): default visible para privilegiados = true (la constructora debe descubrir el flujo), badge = yes (dropdown + Settings, nunca sidebar).

## Verificacion (salidas reales)

- `npx jest src/common/guards/__tests__/construction-industry.guard.spec.ts src/common/services/default-panel-ui.service.spec.ts` (apps/backend): **2 suites, 9 tests PASS** — 7 del guard nuevo + 2 del drift-spec (el drift confirma que APP_MODULES↔fallback no derivaron con la key nueva).
- `npx tsc --noEmit -p apps/backend`: 0 errores en archivos tocados (grep sobre construction-industry|error-codes|industry-capabilities|default-panel-ui|permissions-roles → vacio). Restantes preexistentes y ajenos (`scripts/roku-demo`, specs de ecommerce/subscriptions/notifications/reservations) — no tocados.
- `npx tsc --noEmit -p apps/frontend/tsconfig.app.json` y `tsconfig.spec.json`: **0 errores** (incluye guard, specs karma y constantes).
- Probe `/tmp/a2-probe` (esbuild + node sobre la constante real): **17/17 PASS** — 5 industrias ocultan, construction visible, OR multi-industria, fuente unica, regresion restaurant_ops/memberships intacta.
- Probe cross-file (15/15 PASS): key presente en APP_MODULES↔MODULE_ROUTES↔keymap↔fallback↔seed(4 permisos)↔helper↔guard↔mensajes; `quotations.service.ts` sin `CONTRACT_INDUSTRY` (alcance prohibido intacto).

## Checklist del step

- [x] Sin industria no hay menu ni API de contratos (403 verificado: `getModulesHiddenByIndustries` oculta la key en 5/5 industrias; guard responde 403 `CONTRACT_INDUSTRY_001` — 7 tests; `panelUiGuard` cierra URL directa — 1 test karma agregado).
- [x] Con `construction` el flujo completo es visible (key ausente en su lista + helper/guard la dejan pasar — tests).
- [x] Multi-industria conserva el modulo por semantica OR (frontend y backend testeados con `['retail','construction']`).

## Gaps honestos / handoff

- Karma (`ng test`) NO corrido: sin Chrome en este entorno. Los 4 casos karma agregados estan typecheckeados (`tsconfig.spec.json` 0 errores) pero no ejecutados — C.2/E.1 deberian correrlos con navegador.
- E2E HTTP contra app viva (curl 403 con store sin industria + menu real) NO ejecutado: no hay controlador de contratos hasta C.1; el 403 esta cubierto a nivel guard (unit) no a nivel ruta. C.1 debe aplicar `ConstructionIndustryGuard` a su controlador y verificar el 403 por curl.
- Entrada del sidebar (`store-admin-layout`) y pagina NO creadas a proposito: una entrada sin ruta seria navegacion rota para constructoras. Llegan con C.2, que ya hereda key/ruta/guard cableados (solo agrega item + `loadComponent`).
- Seed de permisos solo editado en codigo, NO ejecutado contra DB (correcto por skill: la corrida va con deploy; C.1 lo necesitara antes de probar su POST).
- `registry/*.md` Status `[ ]`, `log/`, `PLAN.md` (ledger) NO tocados por prohibicion del workflow; quedan para el orquestador (cp-ledger/cp-lint + convergencia).
