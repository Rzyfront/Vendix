-- DATA IMPACT:
-- Tables affected: received_document_events
-- Expected row changes: none; adds a partial uniqueness constraint for active buyer DIAN events
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: CREATE UNIQUE INDEX IF NOT EXISTS
-- Approval: requested as part of received buyer-event activation hardening

CREATE UNIQUE INDEX IF NOT EXISTS "received_doc_events_active_buyer_event_uq"
ON "received_document_events" ("document_id", "event_code")
WHERE "event_type" = 'BUYER_DIAN_EVENT'
  AND "event_code" IN ('030', '031', '032', '033')
  AND "status" IN ('preparing', 'prepared', 'sending', 'unknown', 'accepted');
