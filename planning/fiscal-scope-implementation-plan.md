# Plan de Implementación: Scope Fiscal Independiente del Scope Operativo

## Objective

Implementar un `fiscal_scope` independiente de `operating_scope` para que Vendix soporte tres modelos de negocio sin mezclar reglas operativas con reglas fiscales:

1. Tiendas independientes: operación por tienda y fiscal por tienda.
2. Organización consolidada: operación organizacional y fiscal organizacional.
3. Organización operativa con tiendas fiscalmente separadas: inventario y operación consolidados, pero facturación, DIAN y contabilidad fiscal por tienda/NIT.

El resultado debe permitir cambiar de modelo fiscal mediante un wizard seguro, auditable y reversible en términos de configuración futura, con blockers para procesos fiscales abiertos, auditoría de force-override, validaciones cruzadas con `operating_scope`, sincronización de entidades contables, coherencia DIAN y asientos intercompany automáticos cuando corresponda.

## Approach Chosen

Crear un dominio explícito de `fiscal_scope` que replique el patrón probado de `operating_scope`, pero con reglas fiscales propias.

La implementación se divide en:

- Modelo de datos: nuevo enum, columna en `organizations`, audit log fiscal, `accounting_entities.fiscal_scope`, ancla derivada en `dian_configurations` y ajustes a `intercompany_transactions`.
- Backend core: `FiscalScopeService`, `FiscalScopeMigrationService`, resolver fiscal de `accounting_entities`, validaciones cruzadas y endpoints tipo wizard.
- Contabilidad y DIAN: auto-entries fiscales correctas, mapping-keys intercompany, validaciones de facturación electrónica y reportes por entidad fiscal.
- Frontend: módulo `fiscal-scope` paralelo a `operating-scope`, wizard de cambio, audit log, matriz de combinaciones y onboarding con tercera opción.
- Verificación: tests unitarios, integración, Bruno, Docker logs y escenarios E2E de los tres casos.

Razón: el patrón de `operating_scope` ya existe y está integrado con cache, audit log, dry-run, apply transaccional, force-override, permisos y UI. Reutilizar su forma reduce riesgo, pero separar la semántica fiscal evita que flujos de inventario contaminen la facturación y la contabilidad fiscal.

## Alternatives Considered

- Reusar `operating_scope` como scope fiscal: rechazado porque impide el caso 3.
- Migrar `dian_configurations` para depender únicamente de `accounting_entity_id`: rechazado por alto riesgo sobre facturación existente; se mantiene `store_id` y se agrega FK derivada.
- Crear una tabla `fiscal_entities` separada: rechazado porque duplicaría `accounting_entities` y complicaría reportes.
- Permitir `operating_scope=STORE` + `fiscal_scope=ORGANIZATION`: rechazado por decisión de negocio; no tiene sentido compartir entidad fiscal cuando la operación está aislada.
- Crear asientos intercompany manuales: rechazado; en el caso 3 la transferencia inter-tienda con NIT distinto debe contabilizarse automáticamente.
- Usar `intercompany_transactions` sin tocar schema: rechazado parcialmente; hoy exige `session_id`, por lo que hay que extenderla o crear una sesión sistema. Se elige extenderla para soportar origen operacional sin forzar una sesión de consolidación.

## Scope Matrix

| Caso | operating_scope | fiscal_scope | Comportamiento operativo | Comportamiento fiscal |
| --- | --- | --- | --- | --- |
| 1. Tiendas independientes | STORE | STORE | Stock, compras, proveedores y reportes aislados por tienda | Una entidad fiscal y una configuración DIAN por tienda |
| 2. Organización consolidada | ORGANIZATION | ORGANIZATION | Inventario central, transferencias internas y reportes organizacionales | Una entidad fiscal consolidada, un NIT principal |
| 3. Operación org + fiscal separado | ORGANIZATION | STORE | Inventario y transferencias libres entre tiendas | DIAN, facturas y accounting_entries por tienda/NIT; cross-store genera intercompany |
| Inválido | STORE | ORGANIZATION | Operación aislada | Fiscal consolidado bloqueado por regla de negocio |

## Steps

### 1. Preparación y baseline técnico

Skills: `how-to-plan`, `vendix-core`, `vendix-operating-scope`, `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-inventory-stock`, `vendix-backend-api`, `vendix-frontend-module`, `vendix-zoneless-signals`, `vendix-panel-ui`, `vendix-validation`, `vendix-permissions`, `buildcheck-dev`

Business decision: antes de tocar datos fiscales, se debe congelar la regla central: `FiscalScopeService` será la única fuente de verdad fiscal y `OperatingScopeService` seguirá siendo la fuente de verdad operativa.

Why: evitar decisiones duplicadas en facturación, accounting, reportes, inventario y UI.

Output:

- Confirmar archivos actuales:
  - `apps/backend/prisma/schema.prisma`
  - `apps/backend/src/common/services/operating-scope.service.ts`
  - `apps/backend/src/common/services/operating-scope-migration.service.ts`
  - `apps/backend/src/domains/organization/settings/operating-scope.controller.ts`
  - `apps/frontend/src/app/private/modules/organization/settings/operating-scope/**`
  - `apps/backend/src/domains/store/accounting/auto-entries/**`
  - `apps/backend/src/domains/store/invoicing/dian-config/**`
  - `apps/backend/src/domains/organization/onboarding/**`
- Tomar nota de datos existentes: `intercompany_transactions` ya existe y requiere `session_id`; `accounting_entries.is_historical_consolidated` ya existe; `dian_configurations.store_id` ya existe.

Verification:

- `rg` de callsites de `resolveAccountingEntity`, `operating_scope`, `dian_configurations`, `stock_transfer.completed`.
- Confirmar que el plan no introduce rutas legacy ni patrones fuera de los servicios actuales.

### 2. Modelo de datos: `fiscal_scope_enum` y `organizations.fiscal_scope`

Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-operating-scope`, `vendix-naming-conventions`

Business decision: cada organización tendrá un único `fiscal_scope` global.

Why: el fiscal scope determina cuál entidad jurídica emite facturas, qué NIT usa DIAN y dónde caen los asientos fiscales.

Output:

- Agregar enum:

```prisma
enum fiscal_scope_enum {
  STORE
  ORGANIZATION
}
```

- Agregar a `organizations`:

```prisma
fiscal_scope fiscal_scope_enum @default(STORE)
@@index([fiscal_scope])
```

- Migración SQL idempotente con `DATA IMPACT`.
- Backfill:
  - `fiscal_scope = operating_scope::text::fiscal_scope_enum` para preservar comportamiento actual.
  - Si una organización opera consolidada hoy, debe quedar fiscalmente consolidada salvo decisión explícita posterior.

Verification:

- `npm run prisma:generate -w apps/backend`
- Query de conteo por combinación `operating_scope/fiscal_scope`.
- Validar que ninguna organización existente quede en combinación inválida.

### 3. Audit log fiscal

Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-backend-domain`, `vendix-permissions`

Business decision: los cambios fiscales son auditables de forma independiente a los cambios operativos.

Why: cambios de NIT, facturación y entidad jurídica tienen impacto legal; no deben mezclarse con cambios de inventario/operación.

Output:

- Crear `fiscal_scope_audit_log`:

```prisma
model fiscal_scope_audit_log {
  id                 Int               @id @default(autoincrement())
  organization_id    Int
  previous_value     fiscal_scope_enum
  new_value          fiscal_scope_enum
  changed_by_user_id Int
  changed_at         DateTime          @default(now()) @db.Timestamp(6)
  reason             String?           @db.Text
  blocker_snapshot   Json?

  organization organizations @relation(fields: [organization_id], references: [id], onDelete: Restrict, onUpdate: NoAction)
  changed_by   users         @relation("fiscal_scope_audit_changed_by", fields: [changed_by_user_id], references: [id], onDelete: Restrict, onUpdate: NoAction)

  @@index([organization_id, changed_at(sort: Desc)])
  @@map("fiscal_scope_audit_log")
}
```

- Agregar relaciones en `organizations` y `users`.

Verification:

- Migración aplica en DB local.
- Prisma client genera relación.
- Query de audit log vacío responde sin error.

### 4. `accounting_entities.fiscal_scope`

Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-accounting-rules`, `vendix-operating-scope`

Business decision: una `accounting_entity` debe expresar tanto su rol operativo (`scope`) como su rol fiscal (`fiscal_scope`).

Why: en el caso 3 se necesita una entidad operativa consolidada para reportes de organización y entidades fiscales por tienda para DIAN/contabilidad.

Output:

- Agregar:

```prisma
fiscal_scope fiscal_scope_enum @default(STORE)
```

- Reemplazar/acompañar unique actual con constraints compatibles:
  - Mantener compatibilidad de búsquedas existentes.
  - Agregar unique para distinguir entidades por `scope` + `fiscal_scope`.
  - Usar índices parciales SQL si Prisma no expresa bien `store_id IS NULL`.

- Backfill:
  - `fiscal_scope = scope::text::fiscal_scope_enum`.

Verification:

- Crear en una misma organización:
  - entidad `scope=ORGANIZATION, fiscal_scope=ORGANIZATION, store_id=NULL`
  - entidad `scope=ORGANIZATION, fiscal_scope=STORE, store_id=NULL` solo si se decide que reportes operativos y fiscales la requieren
  - entidades `scope=STORE, fiscal_scope=STORE, store_id=<store>`
- Verificar que no haya colisiones con `accounting_entities_organization_store_scope_key`.

### 5. `dian_configurations.accounting_entity_id`

Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-validation`, `vendix-s3-storage`

Business decision: `dian_configurations.store_id` se mantiene como ancla principal por compatibilidad, y `accounting_entity_id` se agrega como vínculo fiscal derivado.

Why: evita migrar facturas históricas y permite validar coherencia entre NIT, tienda y entidad fiscal.

Output:

- Agregar:

```prisma
accounting_entity_id Int?
accounting_entity    accounting_entities? @relation(fields: [accounting_entity_id], references: [id], onDelete: SetNull, onUpdate: NoAction)
@@index([accounting_entity_id])
```

- Backfill:
  - Para `fiscal_scope=STORE`, asociar DIAN config de cada tienda con su `accounting_entity` fiscal por tienda.
  - Para `fiscal_scope=ORGANIZATION`, asociar la configuración default/matriz con entidad fiscal consolidada.

Verification:

- Ninguna configuración activa queda sin `accounting_entity_id` cuando existe entidad aplicable.
- Crear/editar DIAN config recalcula el vínculo.
- Certificados S3 no se mueven ni se reescriben.

### 6. Extender `intercompany_transactions` para origen operacional

Skills: `vendix-prisma-schema`, `vendix-prisma-migrations`, `vendix-auto-entries`, `vendix-accounting-rules`

Business decision: las transacciones intercompany generadas por transferencias de inventario son operaciones contables reales, no solo hallazgos de una sesión manual de consolidación.

Why: el modelo actual exige `session_id`; eso sirve para detección en consolidación, pero no para registrar automáticamente el origen de una transferencia inter-tienda.

Output:

- Hacer `session_id` opcional o agregar una tabla hija de vínculo. Opción preferida:
  - `session_id Int?`
  - `origin String @default("consolidation")`
  - `source_type String?`
  - `source_id Int?`
  - `status String @default("open")`
  - índices por `(organization_id, source_type, source_id)` y `(organization_id, status)`.
- Ajustar servicios de consolidación para filtrar `origin='consolidation'` cuando operen por sesión.
- Registrar transferencias automáticas con `origin='stock_transfer'`, `source_type='stock_transfer'`, `source_id=<transfer_id>`.

Verification:

- Consolidation UI sigue mostrando transacciones por sesión.
- Transferencia automática se puede listar/reconciliar sin crear sesión artificial.
- No se rompe FK de `session_id`.

### 7. `FiscalScopeService`

Skills: `vendix-backend-domain`, `vendix-prisma-scopes`, `vendix-multi-tenant-context`, `vendix-operating-scope`

Business decision: todo flujo fiscal debe resolver scope fiscal desde `FiscalScopeService`; ningún servicio debe leer `organizations.fiscal_scope` directamente salvo migraciones/controladores núcleo.

Why: cache, fallback, validaciones y resolución de entidades deben ser consistentes.

Output:

- Crear `apps/backend/src/common/services/fiscal-scope.service.ts`.
- Métodos:
  - `getFiscalScope(organization_id, tx?)`
  - `requireFiscalScope(organization_id, tx?)`
  - `invalidateFiscalScopeCache(organization_id)`
  - `assertValidScopeCombination(operating, fiscal)`
  - `resolveAccountingEntityForFiscal({ organization_id, store_id?, tx? })`
  - `resolveAccountingEntityForOperational({ organization_id, store_id?, tx? })`
  - `isIntercompanyTransfer({ organization_id, from_store_id, to_store_id, tx? })`
  - `ensureFiscalAccountingEntityForStore(...)`
  - `ensureFiscalAccountingEntityForOrganization(...)`

Verification:

- Unit tests:
  - cache hit/miss.
  - tx no usa cache.
  - `STORE + ORGANIZATION` lanza error.
  - fiscal `STORE` exige `store_id`.
  - caso 3 devuelve entidad fiscal por tienda.

### 8. Refactor de `resolveAccountingEntity`

Skills: `vendix-operating-scope`, `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-backend-domain`

Business decision: todo asiento fiscal/invoice debe resolver entidad por `fiscal_scope`, no por `operating_scope`.

Why: este es el punto donde hoy se rompe el caso 3.

Output:

- Introducir tipo:

```ts
type AccountingEntityPurpose = 'FISCAL' | 'OPERATIONAL';
```

- Cambiar callsites:
  - Auto-entries e invoices: `FISCAL`.
  - Reportes operativos, inventario, valuation: `OPERATIONAL`.
  - Reportes fiscales: `FISCAL`.
- Mantener compatibilidad temporal con wrapper/deprecated method si reduce el blast radius.

Verification:

- Test: org `operating=ORGANIZATION`, `fiscal=STORE`, venta en tienda 2 crea `accounting_entry.accounting_entity_id` de tienda 2.
- Test: org `operating=ORGANIZATION`, `fiscal=ORGANIZATION`, venta en tienda 2 crea entry en entidad consolidada.

### 9. `FiscalScopeMigrationService`

Skills: `vendix-backend-domain`, `vendix-prisma-scopes`, `vendix-validation`, `vendix-operating-scope`

Business decision: el cambio fiscal debe tener dry-run, apply transaccional, optimistic lock, blockers, warnings, audit log, force-override e invalidación de cache.

Why: cambiar modelo fiscal con facturas, DIAN o periodos abiertos puede dejar registros incoherentes si no se controla.

Output:

- Crear `apps/backend/src/common/services/fiscal-scope-migration.service.ts`.
- API:
  - `proposeChange(organization_id, target_scope, userId, reason?)`
  - `applyChange(organization_id, target_scope, userId, reason?, force?)`
  - `getRecentAuditLog(organization_id, take?)`
- Preview:
  - `current_fiscal_scope`
  - `target_fiscal_scope`
  - `current_operating_scope`
  - `direction: NOOP | UP | DOWN`
  - `can_apply`
  - `warnings`
  - `blockers`
- `SELECT ... FOR UPDATE` sobre `organizations`.
- Force solo permitido para `DOWN` cuando el usuario da razón de mínimo 10 caracteres; nunca debe saltarse combinaciones inválidas.

Verification:

- Concurrencia: dos applies simultáneos dejan un solo audit log efectivo.
- Force guarda `blocker_snapshot` en `fiscal_scope_audit_log` y `audit_logs`.

### 10. Blockers fiscales

Skills: `vendix-validation`, `vendix-backend-api`, `vendix-date-timezone`, `vendix-accounting-rules`

Business decision: el sistema permite configurar cambios, pero bloquea o fuerza explícitamente cuando hay procesos fiscales abiertos.

Why: el usuario debe poder reorganizar su fiscalidad, pero no de forma silenciosa ni destructiva.

Output:

Blockers comunes:

- `FISCAL_SCOPE_INVALID_COMBINATION`: destino generaría `operating=STORE + fiscal=ORGANIZATION`.
- `FISCAL_SCOPE_PENDING_INVOICES`: invoices con `send_status in ('pending','sending','sent_error')`.
- `FISCAL_SCOPE_PENDING_DIAN_RESPONSE`: invoices enviadas sin `accepted_at` o sin respuesta definitiva.
- `FISCAL_SCOPE_OPEN_PERIODS`: fiscal_periods `open` o `closing` de entidad afectada.
- `FISCAL_SCOPE_DRAFT_OR_POSTED_REVIEW_REQUIRED`: entries recientes no cerradas si se requiere periodo cerrado.
- `FISCAL_SCOPE_MISSING_DIAN_CONFIG`: tienda activa sin config DIAN al bajar a STORE.
- `FISCAL_SCOPE_MISSING_TAX_ID`: entidad fiscal tienda sin `tax_id`.
- `FISCAL_SCOPE_OPEN_INTERCOMPANY`: transacciones intercompany `open` o sesiones de consolidación `draft/in_progress`.

UP fiscal `STORE -> ORGANIZATION`:

- Bloquear si operating es STORE.
- Advertir si hay múltiples DIAN configs activas.
- Advertir si periodos fiscales por tienda no coinciden en calendario.
- Crear entidad fiscal consolidada.
- Elegir DIAN config default/matriz o exigir selección en wizard si hay ambigüedad.

DOWN fiscal `ORGANIZATION -> STORE`:

- Exigir entidades fiscales por tienda.
- Exigir o advertir DIAN config por tienda.
- Marcar históricos consolidados.
- No reasignar facturas históricas aceptadas.

Verification:

- Un test por blocker.
- Preview devuelve mensajes y remediation links.
- Apply revalida dentro de transacción.

### 11. Mutaciones fiscales UP/DOWN

Skills: `vendix-prisma-scopes`, `vendix-accounting-rules`, `vendix-operating-scope`

Business decision: los cambios fiscales crean/aseguran nueva estructura, pero no reescriben historia aceptada; la historia se conserva y se marca como consolidada cuando aplique.

Why: preservar trazabilidad contable y DIAN.

Output:

UP `STORE -> ORGANIZATION`:

- Asegurar `accounting_entity` fiscal consolidada.
- Mantener entidades de tienda para historia.
- Asociar una DIAN config default a entidad consolidada.
- Marcar entries históricas de tienda según política si se vuelven solo histórico fiscal separado.
- Actualizar `organizations.fiscal_scope`.

DOWN `ORGANIZATION -> STORE`:

- Asegurar una entidad fiscal por tienda activa.
- Copiar `legal_name/tax_id` desde store o organization como fallback temporal, con warning si falta dato real.
- Asociar DIAN config por tienda.
- Marcar entries consolidadas `store_id IS NULL` como `is_historical_consolidated=true`.
- Actualizar `organizations.fiscal_scope`.

Verification:

- Antes/después de cada dirección con dos tiendas.
- No hay entries huérfanas.
- Cache fiscal invalidada.

### 12. API fiscal scope

Skills: `vendix-backend-api`, `vendix-backend-auth`, `vendix-permissions`, `vendix-validation`

Business decision: el wizard fiscal debe tener endpoints paralelos a operating scope con permisos propios.

Why: autorización de configuración fiscal debe poder delegarse o restringirse separadamente.

Output:

- Crear controller:
  - `apps/backend/src/domains/organization/settings/fiscal-scope.controller.ts`
- Endpoints:
  - `GET /organization/settings/fiscal-scope`
  - `POST /organization/settings/fiscal-scope/preview`
  - `POST /organization/settings/fiscal-scope/apply`
- DTO:
  - `ChangeFiscalScopeDto`
  - `target_scope`
  - `reason?`
  - `force?`
- Permisos:
  - `organization:settings:fiscal_scope:read`
  - `organization:settings:fiscal_scope:write`

Verification:

- ORG_ADMIN con permiso: 200.
- STORE_ADMIN: 403.
- Token sin permiso: 403.
- Payload inválido: 400.
- Blocker: 409 en apply sin force.

### 13. Integración con DIAN config

Skills: `vendix-validation`, `vendix-backend-api`, `vendix-s3-storage`, `vendix-error-handling`

Business decision: una configuración DIAN debe ser coherente con la entidad fiscal vigente.

Why: no puede haber facturas emitidas por una entidad fiscal y firmadas/configuradas por otra.

Output:

- En `dian-config.service.ts`:
  - Al crear config, resolver `accounting_entity_id`.
  - Si fiscal `ORGANIZATION`, permitir solo una config activa/default para la entidad consolidada.
  - Si fiscal `STORE`, permitir config por tienda y exigirla para facturar.
  - Al cambiar default, validar que no contradiga fiscal scope.
- No mover certificados S3; solo relacionar metadata.

Verification:

- fiscal ORG + segunda tienda con DIAN config activa: 400.
- fiscal STORE + tienda sin DIAN config intenta emitir factura: error de negocio claro.
- Certificado existente sigue accesible.

### 14. Invoices y auto-entries fiscales

Skills: `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-backend-domain`, `vendix-validation`

Business decision: facturación electrónica y asiento automático deben resolver la misma entidad fiscal.

Why: DIAN, invoice y accounting_entry deben contar la misma historia legal.

Output:

- Asegurar que el flujo de invoice:
  - consulta DIAN config compatible con fiscal scope.
  - crea/usa `accounting_entry_id` de la entidad fiscal correcta.
- En `AutoEntryService.createAutoEntry`, resolver entidad fiscal por defecto para fuentes contables.
- Agregar validación defensiva:
  - si `purpose='FISCAL'` y fiscal STORE, `store_id` es obligatorio.

Verification:

- Caso 3: invoice tienda A usa NIT A y entry entidad A.
- Caso 2: invoice tienda A usa NIT consolidado y entry entidad consolidada.

### 15. Transferencias inter-tienda e intercompany

Skills: `vendix-inventory-stock`, `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-operating-scope`

Business decision: en `operating=ORGANIZATION + fiscal=STORE`, una transferencia entre tiendas con entidades fiscales distintas genera asientos intercompany automáticos.

Why: operacionalmente el stock se mueve dentro de la organización, pero fiscalmente hay una cuenta por cobrar/pagar entre entidades vinculadas.

Output:

- En evento `stock_transfer.completed`, incluir o derivar:
  - `from_store_id`
  - `to_store_id`
  - `total_cost`
  - `fiscal_scope`
- Si `fiscal=ORGANIZATION`, conservar comportamiento consolidado actual.
- Si `fiscal=STORE` y tiendas distintas:
  - Entry origen: DR cuenta por cobrar intercompany, CR inventario.
  - Entry destino: DR inventario, CR cuenta por pagar intercompany.
  - Crear vínculo en `intercompany_transactions` con `origin='stock_transfer'`.
- Mapping keys:
  - `intercompany_transfer.shipped.receivable` -> PUC sugerido 1365
  - `intercompany_transfer.shipped.inventory` -> 1435
  - `intercompany_transfer.received.inventory` -> 1435
  - `intercompany_transfer.received.payable` -> PUC sugerido 2355

Verification:

- Transfer A -> B con fiscal STORE crea 2 entries balanceadas y un vínculo intercompany.
- Transfer A -> B con fiscal ORG no crea intercompany, solo asiento consolidado si aplica.
- Transfer dentro de la misma tienda no crea intercompany.

### 16. Mapping keys y PUC

Skills: `vendix-auto-entries`, `vendix-accounting-rules`, `vendix-prisma-seed`

Business decision: toda mapping key nueva debe existir en backend defaults, seed y frontend labels.

Why: hoy la skill advierte divergencia entre `DEFAULT_ACCOUNT_MAPPINGS`, seed y UI.

Output:

- Actualizar:
  - `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts`
  - `apps/backend/prisma/seeds/default-account-mappings.seed.ts`
  - `apps/frontend/src/app/private/modules/store/accounting/components/account-mappings/account-mappings.component.ts`
- Marcar cuentas 1365/2355 como intercompany si corresponde en PUC/default chart.

Verification:

- Seed idempotente.
- UI de mapeo muestra grupo intercompany.
- `getMapping` resuelve override store/org antes del default.

### 17. Reportes fiscales y operativos

Skills: `vendix-accounting-rules`, `vendix-backend-api`, `vendix-currency-formatting`, `vendix-date-timezone`

Business decision: reportes operativos pueden consolidar por organización; reportes fiscales deben filtrar por entidad fiscal.

Why: el caso 3 exige P&L por NIT y también vista operativa consolidada.

Output:

- Extender query DTOs con:
  - `accounting_entity_id?`
  - `report_scope?: 'OPERATIONAL' | 'FISCAL'`
- En `org-financial-reports.service.ts`, separar where builder:
  - operativo: usa `operating_scope`.
  - fiscal: usa `fiscal_scope/accounting_entity_id`.
- En store reports, asegurar que fiscal STORE no expone entries de otra tienda.

Verification:

- P&L fiscal tienda A no incluye entries de tienda B.
- P&L operativo org incluye todas las tiendas en operating ORGANIZATION.

### 18. Validaciones cruzadas de scope

Skills: `vendix-validation`, `vendix-permissions`, `vendix-operating-scope`, `vendix-backend-domain`

Business decision: cualquier mutación que cambie operating o fiscal debe validar la combinación final.

Why: no basta con bloquear en el wizard fiscal; también se debe bloquear desde onboarding y operating wizard.

Output:

- `FiscalScopeService.assertValidScopeCombination`.
- En `OperatingScopeMigrationService`:
  - Si se intenta bajar a `operating=STORE` y fiscal actual es `ORGANIZATION`, bloquear con `OPERATING_SCOPE_FISCAL_COMBINATION_INVALID`.
  - Ofrecer remediation: cambiar fiscal a STORE primero.
- En onboarding:
  - STORE_ADMIN siempre fiscal STORE.
  - ORG_ADMIN puede fiscal ORGANIZATION o STORE.

Verification:

- operating DOWN con fiscal ORG devuelve blocker.
- onboarding no puede enviar STORE + fiscal ORG.

### 19. Backend onboarding

Skills: `vendix-operating-scope`, `vendix-backend-api`, `vendix-validation`, `vendix-app-architecture`

Business decision: onboarding debe modelar los tres casos desde el inicio.

Why: los usuarios del caso 3 no deben crear una org consolidada y corregir fiscal después.

Output:

- Extender `SelectAppTypeDto`:

```ts
fiscal_scope?: 'STORE' | 'ORGANIZATION';
```

- `selectAppType()`:
  - `STORE_ADMIN` -> account `SINGLE_STORE`, operating `STORE`, fiscal `STORE`.
  - `ORG_ADMIN + fiscal ORGANIZATION` -> account `MULTI_STORE_ORG`, operating `ORGANIZATION`, fiscal `ORGANIZATION`.
  - `ORG_ADMIN + fiscal STORE` -> account `MULTI_STORE_ORG`, operating `ORGANIZATION`, fiscal `STORE`.
- Guardar en `user_settings.config`:
  - `selected_fiscal_scope`
  - `selected_business_model`.

Verification:

- Bruno cubre tres payloads.
- Re-seleccionar misma opción es idempotente.
- Cambiar de ORG a STORE sigue bloqueado si ya estaba consolidado.

### 20. Frontend onboarding

Skills: `vendix-frontend-component`, `vendix-angular-forms`, `vendix-zoneless-signals`, `vendix-ui-ux`

Business decision: la UI debe ser simple: primero "tienda única vs organización", luego si es organización preguntar "una sola razón social/NIT o cada tienda con NIT propio".

Why: evita presentar conceptos contables complejos antes de que el usuario elija multi-tienda.

Output:

- Actualizar:
  - `apps/frontend/src/app/core/services/onboarding-wizard.service.ts`
  - `apps/frontend/src/app/shared/components/onboarding-modal/**`
- Tipos:
  - `fiscal_scope?: 'STORE' | 'ORGANIZATION'`
  - `business_model?: 'SINGLE_STORE' | 'ORG_CONSOLIDATED' | 'ORG_FISCAL_SEPARATED'`
- UI:
  - Opción A: "Una sola empresa/NIT para todas las tiendas".
  - Opción B: "Cada tienda factura con su propio NIT".

Verification:

- `zoneless-audit.sh`.
- Flujo visual no muestra subpregunta fiscal si elige tienda única.

### 21. Módulo frontend `fiscal-scope`

Skills: `vendix-frontend-module`, `vendix-frontend-component`, `vendix-frontend-sticky-header`, `vendix-zoneless-signals`, `vendix-frontend-data-display`, `vendix-ui-ux`

Business decision: `fiscal-scope` será módulo hermano de `operating-scope`, no una pestaña dentro del mismo componente.

Why: mantener modelo mental claro: operación e impuestos son configuraciones relacionadas pero independientes.

Output:

- Crear:
  - `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/fiscal-scope.component.ts`
  - `.html`
  - `.scss`
  - `services/fiscal-scope.service.ts`
  - `components/change-fiscal-scope-wizard.component.ts/html/scss`
- UI:
  - sticky header.
  - estado actual.
  - dos cards: "Fiscal por tienda" y "Fiscal consolidado".
  - matriz de combinaciones con `operating_scope`.
  - audit log reciente.
  - warnings DIAN visibles.
  - botón de cambio abre wizard.

Verification:

- Carga estado actual.
- Combinación inválida aparece disabled con explicación.
- Applied refresca auth/user state si `fiscal_scope` se incluye en payload de usuario.

### 22. Wizard fiscal frontend

Skills: `vendix-frontend-modal`, `vendix-zoneless-signals`, `vendix-error-handling`, `vendix-ui-ux`

Business decision: copiar el flujo de 4 pasos de operating scope con textos fiscales y blockers específicos.

Why: el patrón de UX ya existe y minimiza curva de aprendizaje.

Output:

- Steps:
  1. Confirmar intención y razón opcional.
  2. Preview server-authoritative.
  3. Force-confirm si aplica y está permitido.
  4. Resultado.
- Mapear blocker titles:
  - invoices pendientes.
  - DIAN pendiente.
  - periodos abiertos.
  - NIT faltante.
  - DIAN config faltante.
  - intercompany abierto.
  - combinación inválida.

Verification:

- Force reason < 10 bloquea botón.
- Error 409 refresca blockers.
- 403 muestra mensaje de permisos.

### 23. Routing, menú, permisos UI

Skills: `vendix-frontend-routing`, `vendix-panel-ui`, `vendix-frontend-icons`, `vendix-permissions`

Business decision: "Modo fiscal" debe aparecer junto a "Modo operativo" en Configuración, pero visibilidad UI no reemplaza permisos backend.

Why: descubribilidad y separación correcta entre UI y autorización.

Output:

- Ruta:
  - `/admin/settings/fiscal-scope`
- Layout:
  - label: `Modo fiscal`
  - icon sugerido: `receipt` o `landmark`
- `MenuFilterService.moduleKeyMap`:
  - agregar label y key, por ejemplo `settings_fiscal_scope`.
- Defaults:
  - `DefaultPanelUIService`
  - `default_templates.user_settings_default`
  - `APP_MODULES`

Verification:

- ORG_ADMIN ve menú si panel key está activo.
- STORE_ADMIN no accede por guard/backend.
- Icon registrado si el sistema usa whitelist de lucide.

### 24. Auth/session model

Skills: `vendix-frontend-state`, `vendix-backend-auth`, `vendix-zoneless-signals`

Business decision: el frontend debe conocer `fiscal_scope` cuando renderice navegación, settings y guards relacionados con fiscalidad.

Why: no se debe depender de fetches dispersos para cada pantalla.

Output:

- Agregar `fiscal_scope` a modelo frontend `Organization`.
- Agregar computed en `AuthFacade`, análogo a `operatingScope`.
- Backend user/session payload incluye `fiscal_scope`.

Verification:

- Después de aplicar fiscal scope, `authFacade.refreshUser()` actualiza UI.
- No hay signal sin invocar en templates.

### 25. Error codes

Skills: `vendix-error-handling`, `vendix-validation`, `vendix-backend-api`

Business decision: blockers fiscales deben tener códigos estables para UI, Bruno y soporte.

Why: textos pueden cambiar, códigos no.

Output:

- Agregar a error codes:
  - `FISCAL_SCOPE_INVALID_COMBINATION`
  - `FISCAL_SCOPE_PENDING_INVOICES`
  - `FISCAL_SCOPE_PENDING_DIAN_RESPONSE`
  - `FISCAL_SCOPE_OPEN_PERIODS`
  - `FISCAL_SCOPE_MISSING_DIAN_CONFIG`
  - `FISCAL_SCOPE_MISSING_TAX_ID`
  - `FISCAL_SCOPE_OPEN_INTERCOMPANY`
  - `FISCAL_SCOPE_CHANGE_BLOCKED`

Verification:

- API retorna códigos.
- Frontend wizard usa códigos, no parsea textos.

### 26. Permisos y seeds

Skills: `vendix-permissions`, `vendix-prisma-seed`, `vendix-panel-ui`

Business decision: configuración fiscal requiere permisos independientes.

Why: una organización puede permitir cambios operativos pero restringir cambios fiscales.

Output:

- Seed permissions:
  - `organization:settings:fiscal_scope:read`
  - `organization:settings:fiscal_scope:write`
- Roles:
  - ORG_ADMIN: read/write por defecto.
  - STORE_ADMIN: sin acceso.
  - SUPER_ADMIN: bypass según patrón existente.

Verification:

- Seed idempotente.
- Usuario antiguo requiere refresh/login para ver nuevos permisos.

### 27. Bruno/API tests

Skills: `vendix-bruno-test`, `vendix-backend-api`, `vendix-validation`

Business decision: el contrato fiscal scope debe quedar testeado como flujo de API, no solo unit tests.

Why: el riesgo está en permisos, payloads, blockers y transacciones.

Output:

- Colección Bruno:
  - GET current.
  - POST preview STORE.
  - POST preview ORGANIZATION.
  - POST apply sin blockers.
  - POST apply con blockers sin force -> 409.
  - POST apply con force + reason válido -> 200.
  - invalid combo -> blocker/error.
  - no permission -> 403.

Verification:

- Colección corre en entorno local con datos seed.

### 28. Migración y backfill productivo

Skills: `vendix-prisma-migrations`, `git-workflow`, `buildcheck-dev`

Business decision: toda migración con backfill debe ser idempotente, explícita y con `DATA IMPACT`.

Why: se modifican filas existentes de organizaciones, entidades contables y DIAN configs.

Output:

- Migración SQL con:
  - creación enum guardada.
  - columnas `IF NOT EXISTS`.
  - índices `IF NOT EXISTS`.
  - constraints guardadas.
  - backfills con `WHERE`.
  - preflight queries opcionales para duplicados.
- No usar `DROP` destructivo.
- No borrar datos históricos.

Verification:

- Dry-run local.
- Revisar `_prisma_migrations`.
- Revisar conteos antes/después.

### 29. Verificación E2E por casos

Skills: `buildcheck-dev`, `vendix-bruno-test`, `vendix-zoneless-signals`, `vendix-accounting-rules`, `vendix-inventory-stock`

Business decision: la implementación solo se considera completa si los tres modelos funcionan de punta a punta.

Why: el caso 3 toca onboarding, inventario, DIAN, contabilidad, reportes y UI.

Output:

- Caso 1:
  - onboarding STORE.
  - operating STORE, fiscal STORE.
  - invoice genera entry en entidad tienda.
  - cross-store transfer bloqueada.
- Caso 2:
  - onboarding ORG + una sola entidad jurídica.
  - operating ORG, fiscal ORG.
  - invoice genera entry consolidada.
  - transfer inter-tienda no genera intercompany fiscal.
- Caso 3:
  - onboarding ORG + tiendas con NIT propio.
  - operating ORG, fiscal STORE.
  - DIAN config por tienda.
  - invoice tienda A usa entidad A.
  - transfer A -> B genera dos entries y transacción intercompany.
  - reporte fiscal filtra por entidad.

Verification:

- Docker logs:
  - `docker logs --tail 40 vendix_backend`
  - `docker logs --tail 40 vendix_frontend`
  - `docker logs --tail 40 vendix_postgres`
  - `docker ps`
- `apps/frontend/scripts/zoneless-audit.sh`
- Bruno fiscal scope verde.

### 30. Release, rollback y operación

Skills: `git-workflow`, `vendix-prisma-migrations`, `buildcheck-dev`, `vendix-business-analysis`

Business decision: este cambio debe desplegarse como release controlado por fases, no como una sola PR gigante si el equipo quiere reducir riesgo.

Why: toca schema, permisos, onboarding, DIAN, accounting e inventario.

Output:

- PR 1: schema + services core + tests.
- PR 2: API + permissions + Bruno.
- PR 3: DIAN/accounting/reportes.
- PR 4: frontend settings wizard.
- PR 5: onboarding.
- PR 6: intercompany transfer automation.
- Release notes:
  - incluye bloque de migración DB.
  - explica backfill.
  - explica cambios de permisos.
- Rollback:
  - no borrar columnas.
  - desactivar rutas/UI si hay incidente.
  - mantener `fiscal_scope` leído pero no editable si se requiere freeze temporal.

Verification:

- Cada PR con Docker logs sanos.
- Migraciones aplicadas una vez.
- No push directo a main/master.

## Files Expected

Backend nuevos:

- `apps/backend/src/common/services/fiscal-scope.service.ts`
- `apps/backend/src/common/services/fiscal-scope-migration.service.ts`
- `apps/backend/src/domains/organization/settings/fiscal-scope.controller.ts`
- `apps/backend/src/domains/organization/settings/dto/fiscal-scope.dto.ts`

Backend modificados:

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/<timestamp>_add_fiscal_scope/migration.sql`
- `apps/backend/src/common/services/operating-scope.service.ts`
- `apps/backend/src/common/services/operating-scope-migration.service.ts`
- `apps/backend/src/domains/organization/settings/settings.module.ts`
- `apps/backend/src/domains/organization/onboarding/onboarding-wizard.service.ts`
- `apps/backend/src/domains/organization/onboarding/dto/select-app-type.dto.ts`
- `apps/backend/src/domains/store/invoicing/dian-config/dian-config.service.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts`
- `apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts`
- `apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts`
- `apps/backend/prisma/seeds/default-account-mappings.seed.ts`
- `apps/backend/prisma/seeds/permissions-roles.seed.ts`
- `apps/backend/src/domains/organization/reports/financial/org-financial-reports.service.ts`
- `apps/backend/src/common/errors/error-codes.ts`

Frontend nuevos:

- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/fiscal-scope.component.ts`
- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/fiscal-scope.component.html`
- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/fiscal-scope.component.scss`
- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/services/fiscal-scope.service.ts`
- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/components/change-fiscal-scope-wizard.component.ts`
- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/components/change-fiscal-scope-wizard.component.html`
- `apps/frontend/src/app/private/modules/organization/settings/fiscal-scope/components/change-fiscal-scope-wizard.component.scss`

Frontend modificados:

- `apps/frontend/src/app/routes/private/org_admin.routes.ts`
- `apps/frontend/src/app/private/layouts/organization-admin/organization-admin-layout.component.ts`
- `apps/frontend/src/app/core/services/menu-filter.service.ts`
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts`
- `apps/frontend/src/app/core/models/organization.model.ts`
- `apps/frontend/src/app/core/store/auth/auth.facade.ts`
- `apps/frontend/src/app/core/services/onboarding-wizard.service.ts`
- `apps/frontend/src/app/shared/components/onboarding-modal/**`
- `apps/frontend/src/app/private/modules/store/accounting/components/account-mappings/account-mappings.component.ts`

## Knowledge Gaps

- Intercompany automatic entries: existe infraestructura de consolidación, pero falta una skill específica para asientos intercompany operacionales creados por transferencias de inventario. Propuesta: actualizar `vendix-auto-entries` con sección "Operational Intercompany Transfers" y actualizar `vendix-accounting-rules` con PUC 1365/2355.
- Fiscal scope as a first-class domain: no existe skill dedicada a `fiscal_scope`. Propuesta: crear `vendix-fiscal-scope` después de implementar la primera fase estable, con reglas de combinación, blockers, DIAN, reportes y onboarding.
- DIAN fiscal entity coherence: `dian_configurations` existe, pero no hay skill que documente cómo se vincula un NIT/configuración con `accounting_entities`. Propuesta: crear o extender una skill de facturación DIAN cuando se cierre esta implementación.

## Approval Gate

Antes de ejecutar código, confirmar:

1. El backfill inicial debe dejar `fiscal_scope = operating_scope` para preservar el comportamiento actual.
2. `operating_scope=STORE + fiscal_scope=ORGANIZATION` queda bloqueado en todas las rutas.
3. `intercompany_transactions` se extenderá para soportar origen operacional sin sesión obligatoria, o se elegirá una tabla nueva si se prefiere aislarlo.
4. El primer corte de implementación puede dividirse en PRs por fase para reducir riesgo.
