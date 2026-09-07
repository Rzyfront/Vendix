# Evidencia A.1 — Destino inmutable en quotations

- Step: A.1 (contracts DB-01 parcial-destination, FB-01 parcial-destination, ERR-01, ERR-02; ADR-01)
- Rama: develop. Alcance respetado: solo dto/, quotations.service.ts, schema.prisma (bloque quotations) + migracion. Sin frontend, sin guards de industria, sin controller (no fue necesario: controller delgado, el DTO transporta el campo).
- Decision de alcance: DB-01 menciona `profile_id`/`contract_id`, pero pertenecen a B.1/C.1; A.1 añade SOLO `destination` para no invadir esos pasos. FB-01 idem (solo `destination`; `profile_id` lo conecta B.1).

## Cambios
1. `apps/backend/prisma/schema.prisma` — enum `quotation_destination_enum (sale|contract|other)` + `quotations.destination NOT NULL DEFAULT sale`.
2. `apps/backend/prisma/migrations/20260906010000_add_quotation_destination/migration.sql` — header DATA IMPACT, `CREATE TYPE` guardado por `pg_type`, `ADD COLUMN IF NOT EXISTS ... DEFAULT 'sale'`, sin backfill, sin FK.
3. `dto/create-quotation.dto.ts` — `destination?` opcional con `@IsEnum` (mensaje ES).
4. `dto/update-quotation.dto.ts` — hereda `destination` a proposito: con `forbidNonWhitelisted` un campo no declarado daria 400 sin codigo; asi llega al servicio y sale 422 con codigo.
5. `quotations.service.ts` — `create` persiste `destination ?? 'sale'`; `update` rechaza cualquier `destination` presente (incluso el mismo valor o null) con `QUOTE_DESTINATION_001` 422; spread sin-items excluye `destination` (defensa en profundidad); `duplicate` hereda destino.
6. `src/common/errors/error-codes.ts` — nuevo `QUOTE_DESTINATION_001` 422 (ERR-01); `QUOTE_CONVERT_STATUS_001` 400 -> 422 para alinear con registry ERR-02 (frontend matchea por `error_code`, no por HTTP: `error-messages.ts:285`, sin impacto UI).

## Verificacion (salidas reales)
- `npx prisma generate`: OK (5.37s).
- `npx tsc --noEmit -p apps/backend`: 0 errores en archivos de quotations/error-codes/DTOs (errores restantes preexistentes en `scripts/roku-demo`, specs ajenos).
- `npx jest src/domains/store/quotations`: 1 suite, 4 tests PASS (gross-line, sin regresion).
- Probe DTO/guard/migracion (`/tmp/a1-probe.ts`): 16/16 PASS — create sin destino valido; sale/contract/other validos; `rental` rechazado con mensaje; update deja pasar al servicio; ERR-01/ERR-02 en 422; guard rechaza contract/sale/null y permite `{}`; migracion con header DATA IMPACT, TYPE guardado, ADD COLUMN IF NOT EXISTS, DEFAULT sale sin UPDATE.
- Spec temporal contra servicio real: `update(1,{destination:'contract'})` -> HTTP 422 + `error_code QUOTE_DESTINATION_001` (2 tests PASS; spec eliminado tras correr).
- Migracion aplicada en DB local vendix_db: `MIGRATION_APPLIED_OK`, enum `[sale,contract,other]`, columna `NOT NULL DEFAULT 'sale'::quotation_destination_enum`, `select destination,count(*) -> [{sale,42}]` (42 filas existentes leen sale, cero cambios de comportamiento). `prisma migrate deploy` + `status`: "Database schema is up to date!" (441 migraciones).
- Probe transaccional con ROLLBACK: insert sin destination -> `sale`; insert `contract` -> `contract`; `PROBE_ROWS_LEFT:0` (cero filas de prueba persistidas).

## Checklist del step
- [x] Sin destino nace `sale` y fluye a orden como hoy (default DB + servicio + probe).
- [x] Cambio de destino responde 422 con codigo ERR-01 (spec real + probe).
- [x] Migracion lleva header DATA IMPACT y pasa en dataset representativo (42 filas dev).

## Gaps honestos / handoff
- E2E HTTP (POST /quotations + PATCH) contra app levantada no ejecutado: requiere servidor Nest + contexto auth/store; cubierto a nivel servicio/DTO/DB en su lugar.
- `convertToOrder` con destino `contract` aun no bloquea de forma explicita: lo exige C.1 (`convertToOrder` intacto por ahora, segun su step). ERR-02 sigue cubriendo estado no-aceptada.
- Registries (`registry/*.md` Status `[ ]`), `log/execution.md` y `PLAN.md` (ledger) NO tocados por prohibicion del workflow; quedan para el orquestador (cp-ledger/cp-lint + convergence).
- `cp-lint.sh` del bundle: pendiente de corrida del orquestador tras ledger.
