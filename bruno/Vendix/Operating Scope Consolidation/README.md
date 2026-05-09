# Operating Scope Consolidation — Bruno smoke tests

Suite mínima viable creada en Fase 6 (hardening) del plan
`s-coincido-no-se-proud-pie.md`. Cubre:

| Folder | Qué prueba |
|--------|-----------|
| `00 Setup` | Login + capture de tokens (orgAdmin, storeAdmin, partner). |
| `01 Domain Scope Guard` | REGLA CERO: cross-domain isolation. 4 casos críticos. |
| `02 Organization Endpoints Smoke` | GET 200 por cada módulo nuevo bajo `/api/organization/*`. |
| `03 Operating Scope Wizard` | Endpoints Fase 4: GET / preview / apply / partner blocked / audit log. |
| `04 Store Id Context Derivation` | CreateOrderDto + CreatePosPaymentDto refactor (Fase 3). |

## Cómo correr

1. Abre la colección en Bruno: `bruno/Vendix/`.
2. Selecciona/configura un environment con las variables descritas abajo.
3. Corre TODAS las requests dentro de `00 Setup` (en orden). Esto guarda
   `orgAdminToken`, `storeAdminToken`, `storeAdminStoreId`, etc.
4. Ahora puedes correr cualquier folder. Los tokens persisten entre runs
   (Bruno los guarda como env vars).

> Tip: usa "Run Folder" para `01 Domain Scope Guard` y `02 Organization
> Endpoints Smoke` (rápido, sin efectos secundarios). El folder `04` SÍ
> crea órdenes/pagos en BD; úsalo en dev.

## Variables de entorno requeridas

Añadir al environment de Bruno (no hay un `environments/` folder en
`bruno/Vendix/`; la colección usa `vars:pre-request` en cada request o
env vars del runner. Crea un environment nuevo si lo prefieres).

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `url` | host backend con prefijo `/api`. | `localhost:3000/api` |
| `orgAdminEmail` | Owner ORG_ADMIN. | `owner@techsolutions.co` |
| `orgAdminPassword` | Password. | `1125634q` |
| `orgAdminOrgSlug` | Slug org no partner. | `tech-solutions` |
| `storeAdminStoreSlug` | Slug de un store hijo. | `tech-medellin` |
| `partnerAdminEmail` | (opcional) ORG_ADMIN de org partner. | — |
| `partnerAdminPassword` | (opcional). | — |
| `partnerAdminOrgSlug` | (opcional). | — |
| `testCustomerId` | `users.id` cliente del store. | `1` |
| `testProductId` | `products.id` del store. | `1` |
| `testStorePaymentMethodId` | `store_payment_methods.id` activo del store. | `1` |

Variables que las requests guardan automáticamente (no las pongas a mano):

- `orgAdminToken`, `orgAdminUserId`, `orgAdminOrganizationId`
- `storeAdminToken`, `storeAdminStoreId`
- `partnerOrgAdminToken`, `partnerOrganizationId`
- `scopeApplyOk` (flag interno del wizard)

## Pre-condiciones de data

- Seed estándar ejecutado:
  `pnpm --filter backend run db:seed` (o el comando equivalente).
- Existe org `tech-solutions` con `account_type=MULTI_STORE_ORG` y
  al menos un store hijo (`tech-medellin`).
- Para `04 Store Id Context Derivation`: ese store debe tener al menos
  un `users` (customer), un `products` y un `store_payment_methods`.
- Para `03 Operating Scope Wizard` (test de partner — request 02): debe
  existir una organización con `is_partner=true` y un usuario
  ORG_ADMIN. Si tu seed no la crea, márcalo así:

  ```sql
  -- ejemplo manual, dev only
  UPDATE organizations SET is_partner = true WHERE slug = 'mi-partner';
  ```

  Si no hay org partner disponible, deja sin correr la request
  `02 POST apply STORE on partner org - 403` y documenta el gap.

## Casos NO cubiertos (gaps de data o alcance)

1. **Token sin claim `app_type` → 403**: requiere generar un token legacy.
   Omitido (caso opcional). Si Auth añade un endpoint para emitir tokens
   sin claim, agregar al folder `01`.
2. **`/organization/subscriptions/current`**: el controller no expone
   `current`; se usa `/stats` como smoke. Revisar si el contrato del
   plan se refería a otro endpoint (e.g. `/stores`).
3. **Apply ORGANIZATION happy path** (`03/03`) acepta 200/400/409 porque
   el resultado depende de blockers en la BD. Cuando se confirme una
   org sin blockers en seed, restringir a 200 y validar `audit_log`.
4. **Auto-cleanup**: las requests del folder `04` crean órdenes/pagos
   reales. No se borran. Correr en dev con BD reseteada cada cierto tiempo.
5. **Reportes / accounting con data vacía**: los GETs devuelven 200 con
   payload vacío. Para reforzar contrato, añadir fixtures con journal
   entries y movements antes de correr la suite — fuera del alcance
   actual.
6. **`/api/organization/accounting/fiscal-periods` y `/account-mappings`**:
   no incluidos en el smoke por ser secundarios (Fase 2 menciona los 4
   subdominios accounting; aquí cubrimos los 2 principales). Agregar si
   se quiere completar.

## Fuentes

- Plan: `/Users/rzy/.claude/plans/s-coincido-no-se-proud-pie.md`
- Guard: `apps/backend/src/common/guards/domain-scope.guard.ts`
- Operating scope service:
  `apps/backend/src/common/services/operating-scope-migration.service.ts`
- DTOs: `apps/backend/src/domains/store/orders/dto/create-order.dto.ts`,
  `apps/backend/src/domains/store/payments/dto/create-pos-payment.dto.ts`
