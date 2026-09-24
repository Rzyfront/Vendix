# D.3 — Probe privilegiado resend (boss, 2026-09-24)

Ejecución pedida por toss (D.3 ítem 3, FB-30/FB-40): ningún peer tiene `store:kitchen_fire:resend` en tienda 10.

- Token: `owner@roku.vendix.com` / org `roku` (user #162, permiso `store:kitchen_fire:resend` presente), `x-store-id: 10`.
- Fixture: orden cancelada #1188 (ajena, 09-23) con líneas 1912/1913 `after_fire_reused`. NO se tocaron #1202/#1205 (runner E2E).
- `POST /store/kitchen-fire/resend {"order_id":1188,"order_item_ids":[1912,1913],"reason":"remake_dish"}` → **500 `SYS_INTERNAL_001`** (`D.3-resend-500.json`).
- Replay idéntico → **500 idéntico** (`D.3-resend-replay-500.json`). No hubo mutación (crash antes de escribir).
- Causa: `kitchen-fire.service.ts:1263` selecciona `cancelled_at` sobre `orders`, campo que solo existe en `order_items` (schema:1413) → `PrismaClientValidationError`. Pre-existente de `75d639ba9` (QUI-762). Ver F-008.
- Vocabulario live confirmado: 5 valores (`after_fire_waste, before_fire, delivered_restock, delivered_waste, after_fire_reused`).

Veredicto: ítem 3 BLOQUEADO por bug real hasta fix F-008. Tras el fix, re-correr: remake → 201 + replay → `KITCHEN_FIRE_NOT_RESENDABLE`.
