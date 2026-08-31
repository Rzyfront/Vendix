## CP-platform-invoicing-parity — Notas de release (PR formal)

Plan ejecutado en 12 commits sobre `dev` (`0c35d844b..17a33de74`). El plan
crítico `docs/plans/CP-platform-invoicing-parity.md` (~25% → ~50% de
paridad funcional del riel plataforma con el módulo de tiendas).

### Commits incluidos

| SHA       | Tipo | Pieza |
|-----------|------|-------|
| 0c35d844b | feat | A.1: migración dual-index store_id nullable |
| 584597dc3 | feat | A.2: schema sync + docblock |
| 976367e69 | feat | A.1b: índice profiles_unique_name_per_org |
| a7721d4e9 | feat | B.1+B.2: PlatformProfilesService + Controller 14 endpoints |
| 4385a1178 | feat | B.2: seed 4 permisos granulares |
| cfab790ec | feat | C.1: wizard +profile_id + assertPlatformProfileMatchesOperation |
| ea3ff5887 | feat | F.4: acquirer-standard enricher (DV M11, label, persona, municipio) |
| 5bf24e601 | feat | C.2: PlatformCreditNotesService (RequestContext sintetizado, ADR-7) |
| 507b29e41 | feat | C.3: PlatformDeliveryService (status='queued') |
| c07d03c3a | feat | C.4: PlatformDianEventsService (assertSupportedEventCode compartido) |
| c355cc6ca | feat | C.5: PlatformInvoicePdfService stub honesto 503 |
| 5583c6e60 | fix  | importar ProfilesModule en SubscriptionFiscalModule |
| 17a33de74 | fix  | preview perfil devuelve 501 con código correcto |

### Verificación previa al merge

- [x] `npx tsc --noEmit -p tsconfig.build.json` retorna 0 errores
- [x] `npx prisma migrate status` reporta "Database schema is up to date"
- [x] Índices duales verificados con `\\d invoice_profiles` en psql
- [x] Live curl 15/15 endpoints responde con códigos esperados (201/200/400/404/409/422/501/503)
- [x] Backend arranca sin UnknownDependenciesException

### Acción post-merge (en orden)

1. **Snapshot de prod** antes de aplicar A.1 + A.1b (migraciones DDL)
2. Aplicar migraciones via `npx prisma migrate deploy`
3. Aplicar el seed de 4 permisos `superadmin:fiscal:invoicing:profiles:*` (siguiente sesión: agregar al seed legacy `permissions-roles.seed.ts`)
4. Verificar que specs del riel tienda (`credit-notes.service.spec`, `invoice-delivery.service.spec`, `dian-events.service.spec`) sigan verdes sin modificación
5. Frontend: implementar D.1-D.2 + E.1-E.4 + F.1-F.3/F.5-F.6 (siguiente fase del plan)
