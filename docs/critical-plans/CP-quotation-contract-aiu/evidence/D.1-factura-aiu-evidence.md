# D.1 — Evidencia: factura AIU precargada desde contrato

## Alcance ejecutado
`InvoicingService.createInvoiceFromContract` (atomico: factura `draft` +
contrato a `invoiced` en una transaccion), `invoices.contract_id` nullable +
FK `Restrict` (DB-05), 409 `CONTRACT_INVOICE_001` (ERR-07), builder puro de
precarga + 14 tests. `createFromOrder` y venta actual intactos (solo
lectura). Sin endpoint (FB-08 es D.2), sin tocar `contracts/`,
`error-codes.ts`, PLAN.md, registries ni steps ajenos.

## Archivos (solo alcance propio)
- `apps/backend/prisma/schema.prisma` — `invoices.contract_id Int?` +
  relacion a `contracts` (reverso lista: la unicidad es PARCIAL, Prisma no
  la expresa — mismo precedente que el CHECK de perfil).
- `apps/backend/prisma/migrations/20260906040000_invoice_contract_id/migration.sql`
  — migracion propia: columna nullable + FK `Restrict` + UNIQUE parcial
  `WHERE contract_id IS NOT NULL AND status NOT IN ('voided','cancelled')`
  (re-facturar tras anular queda permitido; header DATA IMPACT incluido).
- `apps/backend/src/domains/store/invoicing/contract-invoice.ts` (NUEVO) —
  precarga pura: 3 lineas Modelo 2 (A/I/U = subtotal × %), tarifa = moda de
  `tax_rate` del snapshot, objeto desde notas. Falla 422 antes de numerar
  sin A/I/U o sin tarifa (no inventa dato fiscal).
- `apps/backend/src/domains/store/invoicing/contract-invoice.errors.ts`
  (NUEVO) — entradas `CONTRACT_INVOICE_001` 409 / `CONTRACT_STATUS_001` 422
  inline (mismo wire que el catalogo; el catalogo compartido no se toca por
  colision con pasos paralelos — consolidacion del orquestador).
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` —
  SOLO aditivo: `createInvoiceFromContract` + 3 privados
  (`assertNoContractInvoice`, `findActiveContractInvoice`,
  `isUniqueViolation`). Reusa `resolveAiuContext`/`recalculateDocument`/
  `generateNextNumber`/builders: regimen de la tienda congelado en `aiu_*`,
  piso 001 y 004 verificados antes del consecutivo.
- `apps/backend/src/domains/store/invoicing/invoicing.service.contract-invoice.spec.ts`
  (NUEVO) — 14 casos.

## Decisiones
- Solo lineas A/I/U (sin espejar items cotizados como costo): el snapshot no
  dice si el subtotal ya trae el margen; costo+AIU duplicaria margen
  bundleado y romperia el piso (AIU < 10 % del documento con costo). El
  borrador nace editable para agregar costo segun regimen.
- IVA heredado en las 3 lineas (moda, empate a la mayor): equivale al
  default del panel; el motor desgrava lo que el regimen no grava
  (divergencia no bloqueante). Sin senal de tarifa: 422, nunca 19 % u 0 %
  por defecto.
- Contrato sin perfil/porcentajes en cero: 422 `INVOICING_CALC_001` (nada
  que precargar; crear con piso desactivado seria el sistema optando por no
  aplicar el piso a escondidas — la emision lo salta con
  `minimum_percent === null`). Via manual intacta; FB-08 es DTO `none` por
  plan, extension a E.1/orquestador.
- Gate `active` con codigo ERR-06 (`active->invoiced` ES la transicion C.2);
  404 con `SYS_NOT_FOUND_001`; industry-guard en el endpoint D.2 (paridad
  con contratos: guard en controller, no en servicio); sin retencion propia
  (Non-Goals) ni periodo fiscal (paridad `createFromOrder`); evento
  `invoice.created` con `source: 'contract'` (listener tolerante,
  verificado por lectura).

## Verificaciones (salida real)
- `npx prisma validate` → `The schema ... is valid`
- `npm run prisma:generate -w apps/backend` → `Generated Prisma Client (v7.8.0)`
- `npx jest invoicing.service.contract-invoice.spec.ts` → `14 passed`
  (matriz campo a campo vs snapshot con calculador real: A 100000+IVA19000,
  I/U 50000+IVA9500, `taxable_without_rate: []`, cero divergencias;
  pipeline mockeado: `contract_id`+`aiu_*` persistidos, `updateMany` a
  `invoiced`, evento `source: 'contract'`; doble→409 sin numerar;
  draft→422; 404; sin-AIU→422 pre-numero; P2002→409 con ganadora)
- Vecinos sin regresion → `131 passed` (invoicing.service,
  aiu-matrix/document-overrides/contrato-exclusivity, calculator, contracts)
- `npx tsc -p tsconfig.build.json --noEmit` → exit 0

## Gaps honestos / handoff
- Sin DB viva: `migrate dev/deploy`, doble POST concurrente real y emision
  DIAN del borrador quedan para E.1 (igual que C.1).
- FB-08 `POST /contracts/:id/invoice` NO implementado por alcance
  explicito (vive en `contracts/`, fuera de D.1; D.2 asumio que era de D.1
  pero mi delegacion lo excluye — ver input del workflow). Receta para
  quien lo monte (D.2-follow-up / E.1 / orquestador), ~15 lineas en
  `contracts.controller.ts` + wiring de modulo:
  `POST(':id/invoice')` con `@Permissions('store:contracts:create')` bajo
  los guards ya montados (`PermissionsGuard`, `ConstructionIndustryGuard`
  ⇒ 403 ERR-03 gratis), llama a
  `InvoicingService.createInvoiceFromContract(id)` (importar
  `InvoicingModule` en `ContractsModule` o mover el provider segun la regla
  de ownership — NO duplicarlo) y responde `responseService.created(...)`.
  El metodo ya emite los codigos que la ficha D.2 pinta (409
  `CONTRACT_INVOICE_001` con `invoice_id`, 422 `CONTRACT_STATUS_001`).
- FB-09 `GET /store/invoicing?contract_id=` tampoco (pertenece a D.2,
  frontend-only por su alcance): anadir `contract_id?` a `QueryInvoiceDto`
  + filtro `where` en el `findMany` del listado. Sin esto la tarjeta D.2
  muestra su error con codigo hasta que exista.
- `registry/*.md`, `PLAN.md`, `log/`, ADR-03 (`proposed`): no tocados por
  prohibicion del workflow; el orquestador marca FB-08/DB-05/ERR-07.
- Entradas de error inline en `contract-invoice.errors.ts`: mover a
  `error-codes.ts` en consolidacion (wire identico, cambio invisible).
- Contratos sin A/I/U no precargan (decision, no bug): E.1/orquestador
  decide si FB-08 acepta A/I/U manual o si quedan a captura manual.
