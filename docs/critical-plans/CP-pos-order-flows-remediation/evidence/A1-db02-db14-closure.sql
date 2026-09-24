-- A.1 DB-02/DB-14 cierre: sobrepagos históricos (baseline) + prueba post-corte.
-- Corte = commit be9015d3d (guard A.1), 2026-09-22 22:01:56-05.
-- Criterio de aceptación (precedente I.1): 0 desbordes causados por pagos
-- posteriores al corte; el histórico preexistente NO bloquea el cierre.

-- Q1: baseline global (todas las órdenes con Σ succeeded|captured > grand_total)
SELECT p.order_id, o.order_number, o.grand_total, SUM(p.amount) AS paid, COUNT(*) AS n_pay
FROM payments p JOIN orders o ON o.id = p.order_id
WHERE p.state IN ('succeeded','captured')
GROUP BY p.order_id, o.order_number, o.grand_total
HAVING SUM(p.amount) > o.grand_total + 0.01
ORDER BY p.order_id;

-- Q2: DB-02 post-corte (debe ser 0)
SELECT count(*) FROM (
  SELECT p.order_id FROM payments p JOIN orders o ON o.id = p.order_id
  WHERE p.state IN ('succeeded','captured') AND p.created_at >= '2026-09-22 22:01:56-05'
  GROUP BY p.order_id, o.grand_total HAVING SUM(p.amount) > o.grand_total + 0.01
) t;

-- Q3: DB-14 post-corte, multi-pago que desborda (debe ser 0)
SELECT count(*) FROM (
  SELECT p.order_id FROM payments p JOIN orders o ON o.id = p.order_id
  WHERE p.state IN ('succeeded','captured') AND p.created_at >= '2026-09-22 22:01:56-05'
  GROUP BY p.order_id, o.grand_total HAVING COUNT(*) > 1 AND SUM(p.amount) > o.grand_total + 0.01
) t;

-- Q4: timestamps de los pagos ofensores del baseline (todos deben ser < corte)
SELECT p.id, p.order_id, p.amount, p.state, p.created_at
FROM payments p
WHERE p.order_id IN (394,817,818,819,821,852,902,903,917,1028)
  AND p.state IN ('succeeded','captured')
ORDER BY p.created_at DESC;
