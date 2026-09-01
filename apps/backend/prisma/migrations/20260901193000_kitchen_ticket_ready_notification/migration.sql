-- T9 — paso 1: nuevo tipo de notificación para el LISTO de cocina (KDS → mesero).
-- El puente de entrega (`kitchen.order_all_delivered`) sigue emitiendo
-- `order.status_changed` con source='kitchen_bridge'; el listener lo silencia
-- porque entregado no es alerta.
--
-- DATA IMPACT:
-- Tables affected: ninguna (sólo se añade un valor al enum).
-- Expected row changes: 0.
-- Destructive operations: ninguna.
-- FK/cascade risk: ninguna.
-- Idempotency: ADD VALUE IF NOT EXISTS.
-- Approval: nancy vía cross-session, plan T9 paso 1.

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'kitchen_ticket_ready';