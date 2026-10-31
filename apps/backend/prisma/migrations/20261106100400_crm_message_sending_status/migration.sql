-- CRM · PR 6 (revisión #1032): estado `sending` de crm_messages.
--
-- El worker crm-outbound reclama la fila (queued -> sending) antes de llamar
-- al proveedor. Si el worker cae entre el envío y la actualización, el
-- reintento encuentra `sending` y la marca failed/UNKNOWN sin reenviar: un SMS
-- no se publica ni se cobra dos veces.
--
-- DATA IMPACT:
--   Tables affected: ninguna; tipo crm_message_status_enum (1 valor nuevo).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni CASCADE.
--   FK/cascade risk: ninguno.
--   Idempotency: ADD VALUE IF NOT EXISTS. El valor no se usa en esta migración.
--   Approval: RONDA 11 de Rafael (corrección de #1032).

ALTER TYPE "crm_message_status_enum" ADD VALUE IF NOT EXISTS 'sending' AFTER 'queued';
