-- QA local only. Replace the timestamp with the actual deployment cutover in production.
-- Legacy overpayments are a baseline, not a backfill request.
WITH paid AS (
  SELECT o.id, o.grand_total,
         COALESCE(SUM(p.amount) FILTER (WHERE p.state IN ('succeeded','captured')),0) AS settled
  FROM orders o LEFT JOIN payments p ON p.order_id=o.id
  GROUP BY o.id
), overpaid AS (
  SELECT * FROM paid WHERE settled > grand_total + 0.01
)
SELECT COUNT(*) AS historical_overpaid,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM payments p
         WHERE p.order_id=overpaid.id AND p.state IN ('succeeded','captured')
           AND p.created_at > TIMESTAMP '2026-09-23 06:09:25'
       )) AS overpaid_with_post_qa_cut_settlement
FROM overpaid;

SELECT p.order_id, COUNT(*) AS settled_count, SUM(p.amount) AS settled_amount
FROM payments p
WHERE p.order_id IN (1113,1144,1157,1158)
  AND p.state IN ('succeeded','captured')
GROUP BY p.order_id ORDER BY p.order_id;
