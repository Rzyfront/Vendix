# VAT Default Flip — Migration Runbook

## Summary

Tres cambios acoplados en producción, en este orden:

1. **Migración `20260821000000_strip_iva_for_non_responsible_stores`** — desasigna IVA del catálogo de tiendas no responsables y compensa `base_price` para preservar `final_price` publicado.
2. **Commits `40df1ef` + `3f9ebe0` + `71acddb`** — invierten el default de `isVatResponsible` a `false` (fail-closed) en backend, frontend, mobile.
3. **Commits `35d18ae` + `e6f72c9` + `489bff1` + `60b8d22` + `a9b8a4e`** — refactor `VatResponsibilityService`, mocks de specs, specs Jasmine/Jest que congelan mirrors, validator `minLength(1)` en `tax_responsibilities` del wizard.

El plano cronológico es:
- **T0**: snapshot de prod (RDS).
- **T1**: deploy de la migración (sin código nuevo).
- **T2**: verificación post-migración (conteos, `final_price` invariante).
- **T3**: deploy de los commits de código (con la migración ya aplicada).
- **T4**: smoke E2E post-deploy.

---

## Prerequisites

- Permisos de `pg_dump` + `psql` en prod.
- Acceso `git pull` en el repo de prod.
- `DATABASE_URL` de prod en `.env`.
- `vendix_backend` y `vendix_frontend` corriendo en watch mode (no se reinicia salvo报错).
- Window de mantenimiento acordado: 30 minutos para T0-T2, 15 minutos para T3-T4.

---

## T0 — Snapshot de prod

```bash
# 1. RDS snapshot (via AWS CLI o consola; nombre: vat-flip-pre-<YYYYMMDD-HHMM>)
aws rds create-db-snapshot \
  --db-instance-identifier vendix-prod \
  --db-snapshot-identifier vat-flip-pre-$(date +%Y%m%d-%H%M)

# 2. Dump focal de las tablas afectadas
pg_dump "$DATABASE_URL" \
  --table=products \
  --table=product_tax_assignments \
  --table=tax_categories \
  --table=tax_rates \
  --table=store_settings \
  --table=organization_settings \
  --column-inserts \
  > /tmp/vat-flip-pre-$(date +%Y%m%d-%H%M).sql

# 3. Verificación de tamaño y completitud
wc -l /tmp/vat-flip-pre-*.sql
head -5 /tmp/vat-flip-pre-*.sql
```

**Espera confirmación del orquestador** ("snapshot OK, dump en `/tmp/vat-flip-pre-...sql`") antes de continuar.

---

## T1 — Apply migration en prod

```bash
cd /path/to/vendix
git pull origin dev

# Sanity: ¿la migración está en la carpeta esperada?
ls apps/backend/prisma/migrations/20260821000000_strip_iva_for_non_responsible_stores/

# Apply (Prisma ejecutará el SQL dentro de la transacción BEGIN/COMMIT)
cd apps/backend && npx prisma migrate deploy
```

**Salida esperada**:

```
1 migration found in prisma/migrations
Applying migration 20260821000000_strip_iva_for_non_responsible_stores
✓ migration applied
```

Si Prisma reporta error:
- `P3009` (migrations failed to apply): NO continuar. La transacción ya hizo rollback. Restaurar desde snapshot si quedan dudas.
- Cualquier otro error: pegar el log en el ticket y pausar.

---

## T2 — Verificación post-migración

Las queries asumidas están en el comentario al final del archivo `migration.sql`. Ejecutar y reportar:

```sql
-- 1. Conteos (deben coincidir con el conteo previo al deploy)
SELECT COUNT(*) AS productos_afectados
FROM products
WHERE id IN (
  SELECT product_id FROM product_tax_assignments pta
  JOIN tax_categories tc ON tc.id = pta.tax_category_id
  WHERE tc.tax_type = 'iva'
);
-- Esperado: 0 (todas las asignaciones de IVA en no-responsables ya borradas)

-- 2. Asignaciones que quedan (deben ser SOLO de responsables)
SELECT COUNT(*) AS asignaciones_restantes_iva
FROM product_tax_assignments pta
JOIN tax_categories tc ON tc.id = pta.tax_category_id
WHERE tc.tax_type = 'iva';
-- Esperado: solo las de tiendas con O-48 declarado

-- 3. Verificar compensación en una muestra de 50 productos
SELECT 
  p.id, 
  p.base_price AS new_base,
  ROUND(p.base_price / 1.19, 2) AS old_base_implied_19pct
FROM products p
WHERE p.base_price > 10000
ORDER BY p.id DESC
LIMIT 50;
-- Sanity: old_base_implied debe ser ~84% del new_base para productos que eran
-- 19% IVA. Si hay outliers grandes, investigar antes de T3.

-- 4. Producto canario: comparar con el dump pre-migración
-- Buscar un product_id conocido (ej: el primero con IVA en el catálogo)
-- y comparar:
--   - En el dump pre: p.base_price = X, pta.tax_category_id ∈ [...]
--   - En prod post: p.base_price ≈ X * 1.19
```

**Criterios de GO a T3**:
- [ ] Conteo #1 = 0
- [ ] Conteo #2 = (asignaciones de responsables declarados)
- [ ] Muestra #3 sin outliers absurdos (variación > 5% vs. esperado)
- [ ] Producto canario cuadra

Si algún criterio falla: **NO avanzar a T3**. Restaurar desde snapshot (`vat-flip-pre-<ts>`) y coordinar con el autor.

---

## T3 — Deploy de código

Los commits a desplegar están todos en `dev` ya:

```
35d18ae0 refactor(vat): P0.1 — VatResponsibilityService consolida helper en backend
e6f72c98 test(vat): P0.1.1 — mockear VatResponsibilityService en specs de PO y scanner
40df1ef0 feat(vat): invertir default isVatResponsible a false (fail-closed)
3f9ebe06 feat(vat): flip default en mirror frontend auth.selectors
71acddb3 feat(vat): flip default en mirror mobile pos-ticket
489bff1b test(vat): spec jasmine para resolveIsVatResponsible (mirror frontend)
60b8d22f test(vat): spec para isVatResponsible (mirror mobile pos-ticket)
a9b8a4e0 feat(vat): Validators.minLength(1) en tax_responsibilities del legal-data-form
9c964f8b feat(vat): migración de desasignación de IVA + compensación base_price
```

```bash
# Pull en prod
git pull origin dev

# Rebuild + restart sólo lo necesario
docker compose build backend frontend
docker compose up -d backend frontend
docker compose restart nginx  # para que sirva los nuevos bundles del frontend
```

**NO** reiniciar `vendix_postgres` ni `vendix_redis` — la migración es idempotente y los datos ya están compensados.

---

## T4 — Smoke E2E post-deploy

Ejecutar con curl + sesión iniciada (cookie + CSRF). Reemplazar `<store_id>` y `<token>`:

### 4.1 — Tenant sin declarar (no responsable): forbidden + wizard modal

```bash
# Asume que la tienda #1 no tiene tax_responsibilities declarado
curl -s -X POST "$API/store/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"product_id": 1, "quantity": 1, "unit_price": 1000, "tax_rate": 0.19, "tax_amount_item": 190}],
    "customer_id": null,
    "state": "pending"
  }' | jq '.'
# Esperado: success=false, error_code=FISCAL_VAT_NOT_RESPONSIBLE_001,
#   details.cta="/admin/fiscal/wizard"
```

Si responde 201 con la orden creada, la condición "no responsable" no se está detectando. **Rollback inmediato** (ver T-rollback).

### 4.2 — Tenant con O-48 declarado: vende con IVA

```bash
# Login con la tienda #2 (responsable) o el mismo tenant tras pasar el wizard
curl -s -X POST "$API/store/orders" \
  -H "Authorization: Bearer $TOKEN_RESPONSABLE" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"product_id": 100, "quantity": 1, "unit_price": 1190, "tax_rate": 0.19, "tax_amount_item": 190}],
    "customer_id": null,
    "state": "pending"
  }' | jq '.success, .data.state'
# Esperado: success=true, state="pending"
```

### 4.3 — Frontend: el modal del wizard abre

- Login en `vendix.com` con credenciales del tenant no responsable.
- Intentar abrir POS y cobrar una venta con IVA.
- Verificar que el modal `app-fiscal-gate-outlet` aparece con la variante `VAT_RESPONSIBLE_VARIANT` y el CTA hacia `/admin/fiscal/wizard`.

### 4.4 — Mobile: ticket sin línea de IVA donde corresponde

- En la build mobile, login con tenant no responsable.
- Cobrar una venta de contado.
- Verificar el ticket: NO debe mostrar la línea de IVA.

---

## T-rollback — Si algo sale mal

### Vía código (rápido, ~5 min)

```bash
# Revertir el merge de los commits de código (mantiene la migración)
git revert --no-commit 35d18ae0..HEAD
git commit -m "revert(vat): rollback flip + migración compensada"
docker compose build backend frontend
docker compose up -d backend frontend
```

**Esto restaura el comportamiento pre-deploy**: cobrar con IVA funciona para todos los tenants (default `true`). Pero los datos ya están compensados (base_price subida, asignaciones borradas). Los precios subidos pero las ventas vuelven a funcionar — equivale a una subida de precio silenciosa. **No es el rollback ideal**; usar sólo si P0 falla y no hay tiempo.

### Vía datos (largo, ~30 min)

```bash
# 1. Restaurar el snapshot RDS
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier vendix-prod \
  --db-snapshot-identifier vat-flip-pre-<ts>

# 2. O cargar el dump focal
psql "$DATABASE_URL" < /tmp/vat-flip-pre-<ts>.sql

# 3. Re-correr los UPDATEs en sentido inverso vía script de rollback
# (NO incluido en la migración; escribirlo requiere haber tomado un
# dump con más snapshot pre-migración)
```

### Vía wizard (operator-driven, ~10 min)

Para tenants problemáticos individualmente:

1. Identificar la tienda en `SELECT * FROM stores WHERE id = ?`.
2. Loguear como admin de esa tienda.
3. Pasar por el wizard fiscal: `Configuración fiscal → Identidad → marcar O-48`.
4. Verificar que la tienda ahora puede vender con IVA (sus productos vuelven a tener IVA si fueron re-asignados manualmente).

**Limitación**: los productos de esa tienda ya no tienen asignaciones de IVA. Para reactivarlas, hay que re-asignar IVA producto por producto (no hay bulk-restore desde la migración).

---

## Post-mortem checklist

Tras T4 exitoso:

- [ ] Cerrar el ticket de plan con status `done`.
- [ ] Eliminar el snapshot RDS (`vat-flip-pre-<ts>`) tras 14 días de monitoreo.
- [ ] Eliminar el dump `/tmp/vat-flip-pre-<ts>.sql`.
- [ ] Memory: agregar entrada en `MEMORY.md` bajo "Project / Fiscal y DIAN" con la fecha de deploy y el conteo de productos afectados.
- [ ] Linear: taggear el ticket como `Aprobado` y referenciar este RUNBOOK en la descripción del PR.

---

## References

- Plan: `docs/plans/purrfect-chasing-gizmo.md` (Fase 3.1-3.6)
- Migration file: `apps/backend/prisma/migrations/20260821000000_strip_iva_for_non_responsible_stores/migration.sql`
- Helper canónico: `apps/backend/src/common/helpers/vat-responsibility.helper.ts`
- Interceptor del gate: `apps/frontend/src/app/core/interceptors/fiscal-gate.interceptor.ts`
- Modal del wizard: `apps/frontend/src/app/shared/components/fiscal-activation-wizard/`
- Patrón de RUNBOOK base: `apps/backend/scripts/RUNBOOK-fiscal-status.md`
