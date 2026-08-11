-- DATA IMPACT:
-- Tables affected: ninguna. Solo se extiende el enum notification_type_enum.
-- Expected row changes: NINGUNA fila se muta. ADD VALUE es puramente aditivo;
--   ninguna notificacion existente cambia de tipo.
-- Destructive operations: none. Sin DROP, sin RENAME, sin remover valores.
-- FK/cascade risk: none.
-- Idempotency: ADD VALUE IF NOT EXISTS en ambas sentencias.
-- Approval: QUI-647 Fase 3.
--
-- ============================================================================
-- POR QUE
-- ============================================================================
-- `notifications.type` es un ENUM de Postgres, no texto libre. El barrido de
-- vencimientos de CxP emitia `ap_installment.due_soon` / `.overdue` y los
-- listeners intentaban crear la notificacion con esos tipos, que el enum no
-- conocia.
--
-- El fallo era SILENCIOSO y ese es el punto: `@OnEvent` de @nestjs/event-emitter
-- trae `suppressErrors: true` por defecto, asi que el throw del listener se
-- descarta y el `emit` resuelve igual. El job registraba en el log "1 por
-- vencer, 1 vencidas" mientras la tabla `notifications` quedaba en cero. Sin
-- consultar la base, el barrido parecia funcionar.
--
-- ADD VALUE va FUERA de transaccion explicita porque Postgres no permite usar
-- un valor de enum recien agregado dentro de la misma transaccion que lo creo;
-- aqui solo se agrega, y el primer uso ocurre en un request posterior.
-- ============================================================================

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'ap_installment_due_soon';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'ap_installment_overdue';
