# Backfill Cost-Per-Unit / Cost-Price Runbook (F2 — fix colapso CPP)

Sanea el historico del costo tras el colapso del CPP. Son **dos pasos, en
orden**:

1. **Migracion SQL** `20260706130000_backfill_stock_cost_per_unit` — rellena
   `stock_levels.cost_per_unit` (NULL/0) desde `inventory_cost_layers`
   (primaria) y, si no hay capas, desde `cost_price` (fallback).
2. **Script** `migrate:cost-price` — recomputa `products.cost_price` /
   `product_variants.cost_price` como promedio ponderado **scoped** del
   `cost_per_unit` ya saneado, reusando `CostingService.getScopedStockAggregate`.

> Contexto de riesgo: el modulo de compra casi no se uso en prod. El volumen
> corrupto real es bajo (basicamente datos demo). Aun asi, el procedimiento es
> anti-destructivo e idempotente.

## Preflight

1. **Snapshot RDS** de prod ANTES de cualquier escritura (gate obligatorio).
2. Backup enfocado opcional:
   `pg_dump --table=stock_levels --table=products --table=product_variants --column-inserts`.
3. Confirmar que el Prisma client esta regenerado dentro del contenedor tras
   aplicar la migracion (ver skill `vendix-prisma-migrations`).

## Paso 1 — Migracion SQL (cost_per_unit)

La migracion es forward-only e idempotente (`WHERE cost_per_unit IS NULL OR = 0`).
Se aplica con el flujo normal de despliegue (`prisma migrate deploy`), NO con
`migrate dev`. Validacion no destructiva previa (dentro de una transaccion con
ROLLBACK) para ver cuantas filas quedarian saneadas:

```bash
docker exec -i vendix_postgres psql -U username -d vendix_db -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT count(*) AS still_null_before FROM stock_levels WHERE cost_per_unit IS NULL OR cost_per_unit = 0;
\i /ruta/a/migration.sql
SELECT count(*) AS still_null_after FROM stock_levels WHERE cost_per_unit IS NULL OR cost_per_unit = 0;
ROLLBACK;
SQL
```

`still_null_after` debe ser <= `still_null_before`. El ROLLBACK garantiza que
nada persiste durante la validacion.

## Paso 2 — Script (cost_price)

### Dry run (DEFAULT — no escribe)

```bash
npm run migrate:cost-price -- --dry-run
# o acotado a una org:
npm run migrate:cost-price -- --dry-run --organization-id=6
```

### Interpretar el reporte JSON

```jsonc
{
  "dryRun": true,
  "organizationId": 6,        // undefined si corre para todas
  "scanned": 42,              // (producto, variante) con stock on-hand evaluados
  "updated": 5,               // cost_price recomputado (o que se recomputaria en dry-run)
  "skipped": 37,              // ya coincide, o costo sano preservado, o pendiente de paso 1
  "unrecoverable": [          // requieren captura MANUAL del costo
    {
      "organization_id": 6,
      "product_id": 645,
      "product_variant_id": null,
      "current_cost_price": 0,
      "reason": "no_cost_layers_and_collapsed_cost_price"
    }
  ]
}
```

- `unrecoverable` = producto/variante con stock pero sin costo recuperable
  (0 capas con costo real + `cost_price` colapsado). No hay fuente automatica:
  capturar el costo a mano desde el panel.
- `updated` en dry-run = lo que se escribiria; en `--run` = lo que se escribio.

### Gate de aprobacion

Antes de `--run`:
- [ ] Snapshot RDS tomado.
- [ ] Paso 1 (migracion) aplicado y verificado (`still_null` estable).
- [ ] Dry-run revisado: `updated` esperado, `unrecoverable` revisado y aceptado.
- [ ] Aprobacion **explicita** del owner documentada en chat/PR.

### Ejecutar

```bash
npm run migrate:cost-price -- --run
# o acotado:
npm run migrate:cost-price -- --run --organization-id=6
```

Idempotente: re-ejecutar tras un `--run` exitoso reporta `updated: 0`
(los valores ya coinciden a 2 decimales).

## Rollback

- Restaurar el snapshot RDS, o
- Reaplicar el `pg_dump` enfocado en `stock_levels`, `products`,
  `product_variants`.

El script nunca borra filas ni sobreescribe un `cost_price` sano con 0, por lo
que el peor caso de una corrida indebida es un `cost_price` recomputado que se
revierte con el snapshot.
