-- ============================================================================
-- QUI-719 — CRM Landing: nuevo tipo de notificación `crm_contact_request`
-- ============================================================================
-- DATA IMPACT:
-- Tables affected: none (solo catálogo de enums).
-- Expected row changes: +0.
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ALTER TYPE ... ADD VALUE IF NOT EXISTS.
-- Nota: Postgres 12+ permite ADD VALUE en transacción mientras el valor no se
-- USE dentro de la misma migración (patrón qr_table_scan 20260717).
-- Skill: vendix-prisma-migrations.
--
-- El formulario de contacto de la landing pública crea/alimenta un cliente y
-- notifica al dueño con este tipo (campana + SSE + push).
-- ============================================================================

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'crm_contact_request';
