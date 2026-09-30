# D.4 — propina live: porcentual re-deriva, fija intacta (2026-09-24)

Ejecutor: toss · Tienda #10 · mesero #241 · Fixture SQL UPDATE (aprobado boss,
órdenes propias #1230/#1231, producto #333 sin impuesto). Limpieza: ambas
`flow/cancel waste` → `cancelled` (200/200).

## Porcentual (ítem 5, F-001)

- Orden #1230: 2×15000, subtotal 30000. `UPDATE ... tip_type='percentage',
  tip_value=10, tip_amount=3000, grand_total=33000`.
- `PATCH /store/orders/1230/flow/items/1963/cancel {before_fire}` → 200.
- Post: subtotal 15000.00, tip 1500.00, grand 16500.00.
- Veredicto: 1500 = 10% × (15000+0) ✅; 16500 = 15000+0+0+1500−0 ✅.

## Fija (ítem 6, F-001)

- Orden #1231: 2×15000. `UPDATE ... tip_type='fixed', tip_value=2000,
  tip_amount=2000, grand_total=32000`.
- `PATCH .../1965/cancel {before_fire}` → 200.
- Post: subtotal 15000.00, tip 2000.00 (idéntica) ✅,
  grand 17000.00 = 15000+0+0+2000−0 ✅ (ítem 7).

## Post-cobro (ítem 8, ya live)

- `D.4-cobrada-409.json`: orden cobrada (#1208/#1936) → 409
  `TABLE_SESSION_ITEM_NOT_REMOVABLE` + total/pago intactos; FE mapeado a
  copy de reembolso (`error-messages.ts`, D.4/ERR-15).

Crudo: /tmp/tip-order-pct.json, /tmp/tip-pct-cancel.json,
/tmp/tip-order-fix.json, /tmp/tip-fix-cancel.json.
