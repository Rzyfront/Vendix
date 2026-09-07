# Evidencia B.1 — Backend de perfiles de cotización

- Step: B.1 (contracts DB-02, DB-03, FB-03, FB-04, ERR-04; ADR-03)
- Rama: develop. Alcance respetado: nuevo dominio `backend-quotations-profiles`
  (service/controller/dto/module + spec), `schema.prisma` (tablas nuevas +
  `quotations.profile_id` nullable + back-refs), migración propia,
  registros aditivos (error-codes, scoping, store.module). Sin frontend, sin
  `quotations.service.ts`, sin steps ajenos, sin PLAN.md, sin logs ni registries.
- Decisión de alcance: A.1 difirió `quotations.profile_id` a B.1
  («`profile_id` lo conecta B.1»); se añade acá como columna nullable sin
  backfill (cero efecto en filas existentes). `contract_id` pertenece a C.1.

## Cambios
1. `apps/backend/prisma/schema.prisma` — modelos nuevos `quotation_profiles`
   (store NOT NULL, nombre único por store, un default por store, versiones
   desde 0, procedencia de clon) + `quotation_profile_versions` (append-only,
   `@@unique([profile_id, version])`); `quotations.profile_id Int?` + FK
   Restrict (puntero vivo opcional; C.1 congela la versión en el contrato);
   back-refs en users/organizations/stores/quotations (solo relaciones, sin
   columnas nuevas en tablas existentes).
2. `apps/backend/prisma/migrations/20260906020000_quotation_profiles/migration.sql` —
   header DATA IMPACT, `CREATE TABLE IF NOT EXISTS` (SERIAL/TIMESTAMP/JSONB,
   igual que el precedente `20260822200000_invoice_profiles`), ADD COLUMN IF
   EXISTS, índices `IF NOT EXISTS` (único nombre por store sobre
   `(store_id, lower(name))`, parcial de default, unicidad de versión), FKs
   guardadas por `pg_constraint` (todas Restrict salvo clon SetNull).
3. `apps/backend/src/domains/store/backend-quotations-profiles/` — dominio nuevo:
   - `quotation-profiles.service.ts`: CRUD + clon + set-default + activate/
     deactivate + catálogo sin paginar + historial de versiones + remove con
     bloqueo por referencia + `resolveForQuotation` (ERR-04). Espejo de
     `ProfilesService`: scope una vez, ancla `store_id` explícita dentro de
     la transacción (cliente `$transaction` sin scope), `findFirst` (no
     `findUnique`), 409 de nombre por índice sobre expresión con
     `uniqueConflict` que pregunta a la base, comparación en memoria (ILIKE
     haría comodines de `%`/`_`), carrera de default con comprobación
     optimista + parcial, clon inactivo no-default, FK como garantía y conteo
     como mensaje.
   - `quotation-profiles.controller.ts`: `store/quotation-profiles`, CRUD +
     `:id/clone`, `:id/set-default`, `:id/activate|deactivate`, `catalog`
     (FB-03), `:id/versions[/:version]` (FB-04); rutas estáticas antes de
     `:id`; `ParseIntPipe` en todo `:id`; permisos por NOMBRE reusando
     `store:quotations:*` ya sembrados (sin tocar seeds: alcance ajeno).
   - `quotation-profiles.module.ts` + registro en `StoreDomainModule`;
     controller en el propio módulo (sin colisión `:id`: `QuotationsController`
     monta en `store/quotations`); servicio exportado para C.1.
   - DTOs + `quotation-profile-config.ts` (única puerta a `config`: objeto,
     porcentajes 0..100, `validity_days` entero ≥ 0, textos acotados, claves
     desconocidas reportadas con ruta `config.*` → 422 QPROFILE_CONFIG_001).
4. `src/common/errors/error-codes.ts` — 7 códigos aditivos QPROFILE_*
   (NOT_FOUND 404, STORE_001 400 = ERR-04, NAME_001 409, DEFAULT_001 409,
   DELETE_001 409, VERSION_001 404, CONFIG_001 422).
5. `src/prisma/services/store-prisma.service.ts` — `quotation_profiles` en
   scope directo + `quotation_profile_versions` relacional vía
   `profile.store_id` + 2 getters sobre `scoped_client` (aditivo).
6. `quotation-profile-config.spec.ts` — 8 tests unitarios sin DB (committed).

## Verificación (salidas reales)
- `npx prisma validate`: «The schema at prisma/schema.prisma is valid».
- `npm run prisma:generate -w apps/backend`: OK (Prisma Client v7.8.0, 6.27s).
- `npx tsc --noEmit -p apps/backend`: 0 errores en archivos B.1 (43 errores
  restantes preexistentes en specs ajenos: subscriptions/notifications/
  reservations; ninguno en `backend-quotations-profiles|error-codes|
  store-prisma|store.module`).
- `npx jest src/domains/store/backend-quotations-profiles`: 1 suite, 8/8 PASS.
- `npx jest src/domains/store/quotations`: 1 suite, 4/4 PASS (sin regresión).
- `npx jest src/prisma/services`: 4 suites, 25/25 PASS (scoping intacto).
- Probe temporal contra servicio real con mocks (7/7 PASS, spec eliminado
  tras correr): duplicado → 409 QPROFILE_NAME_001; create escribe
  `store_id`/`organization_id` del contexto y crea perfil + versión 1
  atómicos (`current_version` 1); update crea versión 2 sin UPDATE sobre
  versiones (append-only); `resolveForQuotation` ajeno → 400
  QPROFILE_STORE_001 (ERR-04) e inexistente → 404; set-default inactivo →
  409 QPROFILE_DEFAULT_001; remove referenciado (2 cotizaciones) → 409
  QPROFILE_DELETE_001. Incidencia del probe: el primer intento falló por
  dato irreal del propio probe (fila semilla con doble espacio, que el DTO
  jamás persiste); se corrigió el probe, no el servicio (paridad con mirror).

## Checklist del step
- [x] Perfil se crea, clona, activa y desactiva por store (servicio + rutas + probe).
- [x] Nombre duplicado por store responde 409 (índice + `uniqueConflict` + probe).
- [x] Editar no reescribe versiones viejas (commitVersion append-only + probe).

## Gaps honestos / handoff
- Migración NO aplicada en DB local: sin credenciales utilizables
  (`pg_isready`/`psql` ausentes, `DATABASE_URL` del `.env` es placeholder y
  `postgres/postgres` da 28P01); no se cazaron secretos. Validez sostenida
  por `prisma validate` + `generate` + paridad SQL con la migración aplicada
  `20260822200000_invoice_profiles`. C.1/D.1 deben correr
  `prisma migrate deploy` y re-verificar.
- E2E HTTP contra app levantada no ejecutado (requiere Nest + auth/store);
  cubierto a nivel servicio/DTO/scoping en su lugar.
- Sin auditoría ni caché Redis en B.1 (el step no los exige; ADR-03 pide
  «auditoría simple» vía snapshots, que el versionado ya da). Si el
  orquestador los quiere, son follow-up explícito.
- Sin permisos nuevos en seeds (alcance ajeno): el controller reusa nombres
  `store:quotations:*`; quien opera cotizaciones opera perfiles (rama de
  nombre del guard). Si se quieren permisos propios
  (`store:quotation-profiles:*`), van en seeds + controller en paso aparte.
- Registries (`registry/*.md` Status `[ ]`), `log/` y `PLAN.md` NO tocados
  por prohibición del workflow; quedan para el orquestador.
