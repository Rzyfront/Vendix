-- DATA IMPACT:
-- - ENUM: notification_type_enum (idempotente ALTER TYPE ADD VALUE IF NOT EXISTS)
-- - Adds 'qr_table_scan' value required by Step 4b (require_staff end-to-end)
-- - Without this value, notificationsService.sendToUser({type:'qr_table_scan'})
--   throws Prisma constraint violation, caught silently → no SSE, no bell, no push.
-- - 0 filas afectadas en tablas existentes. Sin ops destructivas.

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'qr_table_scan';