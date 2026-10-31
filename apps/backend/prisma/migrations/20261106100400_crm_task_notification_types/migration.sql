-- ============================================================================
-- CRM PR 9 — tipos de notificación de tareas: `crm_task_assigned`, `crm_task_due`
-- ============================================================================
-- DATA IMPACT:
-- Tables affected: none (solo catálogo de enums).
-- Expected row changes: +0.
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ALTER TYPE ... ADD VALUE IF NOT EXISTS.
-- Nota: Postgres 12+ permite ADD VALUE en transacción mientras el valor no se
-- USE dentro de la misma migración (patrón crm_contact_request 20260825).
-- Skill: vendix-prisma-migrations.
--
-- Avisan por el sistema de notificaciones existente (campana + SSE + push) a
-- quien le asignan una tarea del CRM y cuando una tarea pendiente vence.
-- ============================================================================

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'crm_task_assigned';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'crm_task_due';
