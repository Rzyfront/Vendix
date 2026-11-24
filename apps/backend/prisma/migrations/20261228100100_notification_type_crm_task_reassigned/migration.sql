-- Recordatorios y notificaciones CRM (odd/tasks/recordatorios-notificaciones.md
-- §2.1, §4.2 punto 3) — tipo de notificación `crm_task_reassigned`: tarea CRM reasignada (aviso al responsable anterior: "ya no es tuya").
--
-- DATA IMPACT:
-- Tables affected: none (solo agrega un valor al enum).
-- Expected row changes: 0.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: ADD VALUE IF NOT EXISTS. Un valor por migración (patrón del repo);
-- ninguna migración usa el valor en la misma transacción.
-- Skill: vendix-prisma-migrations (Rule 1).

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'crm_task_reassigned';
