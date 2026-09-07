# C.1 — Evidencia: crear contrato desde cotizacion

## Alcance ejecutado
Nuevo dominio `contracts`: `ContractsService.createFromQuotation`
idempotente + `POST /store/contracts/from-quotation/:id` (FB-06),
tabla `contracts` + valor `contracted` en `quotation_status_enum` (DB-04,
ADR-04), 409 `QUOTE_CONTRACT_001` (ERR-05). `convertToOrder` y frontend
intactos por alcance del paso.

## Archivos (solo alcance propio)
- `apps/backend/prisma/schema.prisma` — enum `contracted` + modelo
  `contracts` (+ reversos en quotations/stores/organizations/users).
- `apps/backend/prisma/migrations/20260906030000_contracts_from_quotation/migration.sql`
  — migracion propia con header DATA IMPACT.
- `apps/backend/src/common/errors/error-codes.ts` — `QUOTE_CONTRACT_001` 409.
- `apps/backend/src/prisma/services/store-prisma.service.ts` — `contracts`
  en `store_scoped_models` + getter.
- `apps/backend/src/domains/store/contracts/` — `contracts.service.ts`,
  `contracts.controller.ts`, `contracts.module.ts`,
  `contracts-snapshot.ts`, `contracts-snapshot.spec.ts`.
- `apps/backend/src/domains/store/store.module.ts` — registro de
  `ContractsModule`.

## Decisiones
- `contracts.quotation_id` UNIQUE = llave de idempotencia (una cotizacion,
  un contrato). Triple capa: chequeo previo 409 con ficha existente,
  re-chequeo dentro de la transaccion, traduccion de `P2002` al mismo 409.
- Snapshot congelado (ADR-03) en `snapshot` JSONB: items, totales, A/I/U y
  version de perfil vigentes al crear. `profile_id`/`profile_version` son
  procedencia sin FK: borrar o editar el perfil no reescribe historia.
- `status` VarChar (`draft` al crear; `active`/`invoiced`/`cancelled` los
  mueve C.2), igual que `invoice_profiles.state`. Sin enum nuevo.
- Bloqueo mutuo lado contrato (ADR-01): destino distinto de `contract`
  responde `QUOTE_DESTINATION_001` (422); no aceptada responde
  `QUOTE_CONVERT_STATUS_001`; sin cliente, `QUOTE_CONVERT_CUSTOMER_001`.
- Guard `ConstructionIndustryGuard` en el controller (403 ERR-03 sin
  `construction`); permisos `store:contracts:*` ya sembrados en A.2.
- La cotizacion solo marca `status=contracted` via `updateMany` con filtro
  de tenant + conteo verificado. Sin columna `contract_id`: el vinculo vive
  en `contracts.quotation_id` (unique) y su reverso Prisma.

## Verificaciones (salida real)
- `npx prisma validate` → `The schema ... is valid`
- `npm run prisma:generate -w apps/backend` → `Generated Prisma Client (v7.8.0)`
- `npx jest src/domains/store/contracts/contracts-snapshot.spec.ts` →
  `3 passed` (snapshot sin/con perfil, numeracion CT-YYYYMMDD-####)
- `npm run build -w apps/backend` → exit 0 (`nest build` sin errores)
- Vecinos sin regresion: `construction-industry.guard.spec` +
  `quotation-profile-config.spec` + `quotations.gross-line.spec` →
  `19 passed`

## Gaps honestos
- Sin prueba contra DB viva: el doble POST concurrente real (segundo 409
  via UNIQUE) y `prisma migrate dev/deploy` no se ejecutaron aqui (sin DB
  en este entorno); quedan para E.1 con servidor vivo.
- `convertToOrder` sobre destino `contract` aun no rechaza explicito
  (fuera de alcance C.1 por instruccion del paso); el bloqueo vive solo del
  lado contrato. Corresponde a E.1 (FB-10) o decision del orquestador.
- `VALID_TRANSITIONS` de `QuotationsService` no incluye `contracted`
  (no se toco por alcance): `cancel()` sobre cotizacion contratada responde
  transicion invalida generica; C.2/E.1 debera definirlo.
- Sin `contracted_at` en quotations (alcance schema limitado a tabla
  contracts + enum); la fecha de contratacion vive en
  `contracts.created_at`.
