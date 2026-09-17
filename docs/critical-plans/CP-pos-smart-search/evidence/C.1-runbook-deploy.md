# C.1 — Runbook orden deploy Fase B (F-050)

Firmado 2026-09-17. Orden FIJO, no improvisable:

## Orden

1. **Migraciones PRIMERO** (`prisma migrate deploy`): C.1 (extensiones + wrapper),
   luego C.2 (GIN CONCURRENTLY). Código viejo + DB nueva = seguro (cambios
   aditivos; ningún query viejo referencia `immutable_unaccent` ni los GIN).
2. **Código DESPUÉS** (C.3 raw trigram): TRIGRAM default-off por tienda +
   capability guard (F-049) de backstop. Sin capability ⇒ fallback L2/L1/legacy
   con warn, jamás 500.
3. **Activación por tienda** al final (E.4 rollout): `trigram: true` solo tras
   verificar capability en prod (`to_regprocedure` + GIN válidos).

## Mid-migración

- Durante C.1/C.2 el tráfico sirve código viejo contra DB aditiva: cero
  queries rotas (nada viejo nombra lo nuevo).
- `CREATE INDEX CONCURRENTLY` (C.2) no bloquea escrituras; el build acapara I/O
  (ventana medida en staging, gate ≤30min).
- Si C.2 falla a la mitad con índice INVALID: NO retry `IF NOT EXISTS`
  (reusa el inválido); `REINDEX INDEX CONCURRENTLY` o drop+recreate (DB-16).

## Rollback

- Código: revert deploy → flags trigram off (kill-switch `POS_SMART_SEARCH_OFF`
  si es global). DB nueva + código viejo = seguro.
- DB (solo si nada referencia lo nuevo): `DROP INDEX CONCURRENTLY` (C.2),
  `DROP FUNCTION public.immutable_unaccent(text)`, `DROP EXTENSION IF EXISTS`.

## Permisos prod (RDS PostgreSQL 15.14; dev 15.17, mismo major)

- `pg_trgm` y `unaccent` están en el allowlist RDS (extensiones soportadas).
- Precedente: `vector` + `pgcrypto` ya instalados en prod vía `CREATE EXTENSION
  IF NOT EXISTS` en migración Prisma — mismo mecanismo, mismo usuario deploy.
- Verificación final: `SELECT * FROM pg_available_extensions WHERE name IN
  ('pg_trgm','unaccent')` en staging idéntico antes del deploy prod.

## Local-dev (precedente 20260914170851)

`migrate dev` está roto repo-wide (P3006 en `20260807220000_*`, ajeno a este
plan) → aplicar vía psql + `migrate resolve --applied`:

```bash
docker exec -i -e PGPASSWORD=password vendix_postgres psql -U username \
  -d vendix_db -v ON_ERROR_STOP=1 -f - < <migration.sql>
cd apps/backend && npx prisma migrate resolve --applied <nombre_migracion>
```
