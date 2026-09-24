-- The current KDS projection is the highest kitchen_ticket_items.id per order item.
-- Older tickets may remain pending/cancelled after a legitimate re-fire.
WITH latest AS (
  SELECT DISTINCT ON (order_item_id)
    order_item_id, id, kitchen_ticket_id, status
  FROM kitchen_ticket_items
  ORDER BY order_item_id, id DESC
)
SELECT o.store_id, i.id AS item_id, i.order_id,
       l.id AS ticket_item_id, l.kitchen_ticket_id,
       l.status AS latest_status, i.delivered_at
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN latest l ON l.order_item_id = i.id
WHERE i.delivered_at IS NOT NULL AND l.status <> 'delivered'
ORDER BY i.id;

-- Deployment cut for this QA; historical rows are inventory, not an automatic backfill.
WITH latest AS (
  SELECT DISTINCT ON (order_item_id) order_item_id, status
  FROM kitchen_ticket_items
  ORDER BY order_item_id, id DESC
)
SELECT count(*) AS postcut_mismatch
FROM order_items i
JOIN latest l ON l.order_item_id = i.id
WHERE i.delivered_at >= TIMESTAMP '2026-09-23'
  AND l.status <> 'delivered';
