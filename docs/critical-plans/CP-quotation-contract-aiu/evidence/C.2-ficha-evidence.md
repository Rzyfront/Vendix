# Evidencia C.2 — Ficha de contrato y estados

- Step: C.2 (contracts FB-07, ERR-06)
- Rama: develop. Alcance respetado: modulo frontend NUEVO `store/contracts/`
  (interfaces, servicio, listado, ficha), 2 rutas lazy en `store_admin.routes.ts`,
  1 item sidebar bajo Órdenes, mensaje `CONTRACT_STATUS_001` en `error-messages.ts`.
  NO tocados: backend, modulo quotations (solo lectura), PLAN.md, ledger/registry/log
  (del orquestador), steps ajenos.
- Backend de contratos (C.1) aun pendiente en este arbol: la ficha degrada con
  error accionable + codigo ante 404/red, igual que B.2 degrada sin catalogo.

## Cambios

1. `store/contracts/interfaces/contract.interface.ts` (NUEVO) — `ContractStatus`
   (`draft|active|invoiced|cancelled`), `Contract` (numero, objeto, snapshot A/I/U,
   totales, `quotation?`, `invoice?`), `CONTRACT_TRANSITIONS`
   (`draft->[active,cancelled]`, `active->[invoiced,cancelled]`, terminales vacios),
   `isValidContractTransition()`, `CONTRACT_STATUS_ERROR_CODE='CONTRACT_STATUS_001'`.
2. `store/contracts/services/contracts.service.ts` (NUEVO) — `getContractById`,
   `getContracts`, `transitionContractStatus` (PATCH `{status}`) contra
   `/store/contracts`; `ContractApiError` conserva `code` y pinta
   `mensaje (CODIGO)` para que el operador siempre vea el codigo.
3. `store/contracts/contracts.component.ts` (NUEVO) — listado con stats,
   buscador, estados carga/vacio/error-con-reintento; enlaza a la ficha.
4. `store/contracts/pages/contract-detail/contract-detail.component.ts` (NUEVO) —
   ficha: sticky-header con badge por estado; objeto; A/I/U con nota de snapshot
   congelado; documentos (link a cotizacion origen, estado de factura AIU);
   timeline; tarjeta de transiciones que SOLO habilita las validas del estado;
   tarjeta de resumen con totales y fechas. Error de transicion (422
   `CONTRACT_STATUS_001`) en banner + toast con codigo, sin pantalla en blanco;
   la ficha conserva el ultimo estado consistente.
5. `routes/private/store_admin.routes.ts` — `contracts` y `contracts/:id` con
   `loadComponent` (ruta canonica A.2 `/admin/orders/contracts` intacta).
6. `layouts/store-admin/store-admin-layout.component.ts` — item `Contratos` tras
   `Cotizaciones` (el filtro A.2 por `orders_contracts` lo gobierna por industria).
7. `core/utils/error-messages.ts` — `CONTRACT_STATUS_001` → mensaje ERR-06
   ("Transición no permitida...").

## Verificacion (salidas reales)

- `npx tsc --noEmit -p apps/frontend/tsconfig.app.json`: **0 errores**.
- Probe `/tmp/c2-probe.mjs` (esbuild + node sobre la interfaz real): **18/18 PASS** —
  4 transiciones validas, 8 invalidas (incl. salidas de terminales e inversas),
  codigo ERR-06, etiquetas ES.
- `zoneless-audit.sh`: falla igual con y sin mis cambios (preexistente); cero
  archivos `contracts/` entre los flagged; mis subscribes usan
  `takeUntilDestroyed`, plantillas con `@if/@for`, `inject()` + signals.
- Transiciones contra API viva NO ejecutadas: el controlador de contratos es de
  C.1 (verificado por grep: cero `contracts.controller` en backend). La rama de
  error 422 esta cableada en codigo (banner + toast con codigo) y lista para
  E.1; el guard de transicion cliente (`validTransitions`) se probo en el probe.
- Karma (`ng test`) NO corrido: sin Chrome en este entorno.

## Checklist del step

- [x] Ficha muestra objeto, A/I/U, totales y documentos origen (objeto, AIU con
      nota de snapshot, totales, link cotizacion + estado factura; typecheck 0 errores)
- [x] Solo transiciones validas habilitadas por estado (botones = `validTransitions()`;
      matriz 18/18 en probe; terminales muestran "sin transiciones disponibles")
- [x] Error de transicion es legible y accionable (banner + toast con mensaje y
      codigo `CONTRACT_STATUS_001`; jamas pantalla en blanco; verificado en codigo
      + `error-messages.ts`; contra API viva queda para C.1/E.1)

## Gaps honestos / handoff

- API viva pendiente de C.1: GET/PATCH `/store/contracts/:id` no existen aun;
  la ficha muestra su error con codigo hasta que existan. D.2 necesita el bloque
  "Factura AIU" de esta ficha (hoy informativo) para colgar su boton.
- `registry/*.md` Status `[ ]`, `log/`, `PLAN.md` (ledger) NO tocados por
  prohibicion del workflow; quedan para el orquestador.
- En el arbol hay cambios ajenos sin commitear (`schema.prisma`, `error-codes.ts`,
  de la rama C.1 en curso): NO tocados ni incluidos en mi commit.

## Anexo backend C.2 — lectura y transiciones (ejecutor backend, 2026-09-06)

- Alcance respetado: SOLO `contracts.controller.ts`, `contracts.service.ts`,
  NUEVO `contracts.service.spec.ts` + este anexo. NO tocados: `error-codes.ts`,
  `contracts.module.ts`, `invoicing/*`, PLAN.md, registries, steps.
- Skills leidas antes de codificar: `vendix-backend-api`, `vendix-validation`,
  `vendix-error-handling`, `vendix-multi-tenant-context`.

### Cambios

1. `contracts.service.ts` — `findAll({page,limit,search,status})` devuelve
   `{ data, pagination: { total, page, limit, totalPages } }` (mismo envoltorio
   que `PaginatedContractsResponse`; `success()` como `quotations.findAll`,
   NO `paginated()`); `search` cubre `contract_number` + `notes`
   (`insensitive`); `findOne` con `findFirst` scopeado y 404 accionable
   `SYS_NOT_FOUND_001` + `{ contract_id }`; `updateStatus` con la matriz del
   frontend (`draft->[active,cancelled]`, `active->[invoiced,cancelled]`,
   terminales sin salida) y 422 `CONTRACT_STATUS_001` + `{ contract_id,
   current_status, attempted_status, allowed_transitions }`. Cero `findUnique`,
   cero `throw new Error`.
2. `contracts.controller.ts` — DTOs inline (`ContractQueryDto`,
   `UpdateContractStatusDto`, sin nuevo `dto/` por alcance):
   `GET /store/contracts` (`store:contracts:read`),
   `GET /store/contracts/:id` (`store:contracts:read:one`),
   `PATCH /store/contracts/:id {status}` (`store:contracts:update`).
   Estaticas antes de `:id`; cero `try/catch` (el filtro emite el status real).
3. `contracts.service.spec.ts` (NUEVO) — 16 tests con delegate mockeado:
   envoltorio, filtros, 404 con codigo, 4 transiciones validas, 8 rechazos 422,
   404-antes-que-422 en PATCH ajeno.

### Verificacion (salidas reales)

- `npx jest src/domains/store/contracts/contracts.service.spec.ts
  src/domains/store/contracts/contracts-snapshot.spec.ts`:
  **2 suites, 19/19 PASS** (16 nuevos + 3 snapshot C.1 intactos).
- `npx tsc --noEmit -p apps/backend/tsconfig.json`: **cero errores en mis
  3 archivos**. El proyecto arrastra errores preexistentes ajenos
  (`scripts/roku-demo/*`, otros specs) + `contracts-invoice.spec.ts` del
  ejecutor D.2 en curso (espera `createInvoiceFromContract`, fuera de mi
  alcance): NO tocados.
- `grep`: `throw new Error` = 0 en el servicio; `try/catch` /
  `responseService.error` = 0 en el controlador; `findUnique` solo en
  comentarios.

### Gaps honestos / handoff

- `CONTRACT_STATUS_001` NO existe en `error-codes.ts` (fuera de alcance):
  el servicio usa el literal `CONTRACT_STATUS_ENTRY` con la misma forma
  (`code` + 422). El contrato HTTP es identico; cuando el registry la incluya
  se reemplaza por `ErrorCodes.CONTRACT_STATUS_001` en 1 linea. El ejecutor
  D.2 ya asume este codigo para `contractNotReadyForInvoice` (mismo 422).
- `*->cancelled` del step se implemento como `draft|active -> cancelled`
  (matriz exacta del frontend `CONTRACT_TRANSITIONS`): `invoiced -> cancelled`
  responde 422 porque facturado es terminal y cancelar sin tocar la factura
  corromperia el flujo D. Si el negocio exige anular facturados, es decision
  de producto + D.2, no de este step.
- Colision de arbol: el ejecutor D.2 trabaja en paralelo en este mismo
  checkout (`contracts.module.ts` + `invoicing/*` + `contracts-invoice.spec.ts`
  sin commitear; su spec construye el controlador con 3 args). Mi commit
  incluye SOLO mis 4 rutas; el merge/orden lo resuelve el orquestador.
  `registry/*.md`, `log/`, `PLAN.md` NO tocados (del orquestador).
