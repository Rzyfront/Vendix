-- DATA IMPACT:
--   Tablas afectadas: audit_logs (solo índices)
--   Filas mutadas: 0
--   Operaciones destructivas: ninguna
--   Motivo: audit_logs no tenía ningún índice y el interceptor global escribe
--           una fila por request autenticado; la consola de tenants consulta
--           por (store_id, created_at).
--
-- NOTA DE PRODUCCIÓN (bloqueo de escritura):
--   Estos CREATE INDEX se ejecutan SIN CONCURRENTLY porque Prisma envuelve cada
--   migración en una transacción y CREATE INDEX CONCURRENTLY no puede correr
--   dentro de una. Cada CREATE INDEX toma un lock SHARE sobre audit_logs, que
--   bloquea los INSERT mientras dura la construcción. Como el AuditInterceptor
--   es global y escribe en cada request autenticado, en producción esto frena
--   TODAS las escrituras de auditoría durante la construcción de los 4 índices.
--   En dev la tabla mide 7944 kB / 20494 filas y construye en milisegundos.
--   Si en producción audit_logs es de orden GB, aplicar esta migración en
--   ventana de mantenimiento, o crear los índices manualmente con
--   CREATE INDEX CONCURRENTLY fuera de Prisma y luego marcar la migración con
--   `prisma migrate resolve --applied 20260805234617_add_audit_logs_activity_indexes`.
--   Los IF NOT EXISTS hacen que ambos caminos converjan sin conflicto.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_store_id_created_at_idx" ON "audit_logs"("store_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
