# D.2 — Veredicto contable (verificador)

Fecha: 2026-09-24 UTC · Rama: `develop` @ `4bebaacab` · Alcance: solo lectura + jest + SQL SELECT.

## Veredicto: APROBADO con riesgo residual BAJO (idempotencia concurrente)

- Mapeos: **OK, sin divergencias** en las 4 fuentes.
- Specs: **29/29** (17 auto-entry + 10 listener + 2 mapping D.2), sin ediciones.
- Idempotencia: **OK en secuencial/retry**; **riesgo bajo y acotado** ante doble-submit
  verdaderamente concurrente (pre-check sin unique constraint — patrón preexistente
  de todo el repo, no introducido por D.2).

## 1. `onPreparedDishDisposition` — contrato verificado

Archivo: `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts:4822-4859`.

| Cláusula | Código | Estado |
|---|---|---|
| waste → DR `order_item.prepared_waste.shrinkage` / CR `order_item.prepared_disposition.cogs` | L4834-4847, `amount, 0` vs `0, amount` | OK |
| reuse → DR `order_item.prepared_reuse.inventory` / CR mismo cogs | L4836-4838 ternario | OK |
| `source_type='order_item.prepared_disposition'`, `source_id=order_item_id` | L4850-4851 → `createAutoEntry` L4858 | OK |
| `amount <= 0` → `null` sin asiento | L4831-4832 (`Number(total_cost \|\| 0)`; negativo también retorna null) | OK |
| Asiento siempre cuadra (DR=CR=`amount`) | misma variable en ambas patas | OK |
| Línea con mapping ausente → skip instrumentado, nunca asiento parcial | `resolveAccountLine`→null (L137-159) + `SKIPPED_MISSING_MAPPING` (L1091) | OK |

Dirección contable (skill `vendix-accounting-rules` + `vendix-inventory-valuation`):
el COGS del plato ya se reconoció al fuego (`kitchen.fired`: DR 6135 / CR 1435);
la disposición lo **reclasifica**: waste → DR 5295 (merma) / CR 6135 (baja COGS);
reuse → DR 1435 (insumo de vuelta) / CR 6135. Correcto en naturaleza (5/6/1).

## 2. Mapeos en las 4 fuentes — alineados, sin divergencias

| Mapping key | `account-mapping.service.ts` L285-296 | `default-account-mappings.seed.ts` L98-100 | Catálogo backend (`buildMappingKeyCatalog`) | Frontend `account-mappings.component.ts` |
|---|---|---|---|---|
| `order_item.prepared_waste.shrinkage` | 5295 · Merma de plato preparado | 5295 | label `Merma de plato preparado · Merma de plato preparado`, default 5295 | grupo `restaurant_ops` (L173, match exacto L496-500) |
| `order_item.prepared_reuse.inventory` | 1435 · Reuso de insumos de plato preparado | 1435 | label análogo, default 1435 | grupo `restaurant_ops` (L174) |
| `order_item.prepared_disposition.cogs` | 6135 · Reclasificación costo de cocina | 6135 | label análogo, default 6135 | grupo `restaurant_ops` (L175) |

- Labels de fila: el frontend usa `getLabel()` → `description` del catálogo backend
  (L391-392); `MAPPING_EVENT_LABELS` cubre los 3 eventos (L1107-1109). Sin copia
  local que diverja (diseño actual: catálogo por HTTP).
- `getMapping` resuelve por cascada store→org→`DEFAULT_*` aun sin filas seed
  (probado por `account-mapping.d2.spec.ts`).
- **Divergencias: ninguna.**

Observación (no bloqueante): `entry_type_map` (L1224-1286) no lista
`order_item.prepared_disposition` → cae a `'manual'`. Es el fallback válido del
enum y el **mismo precedente que `kitchen.fired`** (tampoco listado). Si el plan
exige tipo `auto_inventory`, es un cambio de 1 línea en el mapa.

## 3. Specs — 29/29, corridos de a uno con `--runInBand`

Evidencia: `evidence/D.2-autoentries-jest.txt`.

| Spec | Resultado |
|---|---|
| `auto-entries/auto-entry.service.spec.ts` (incluye 4 tests D.2: waste/reuse/cero-coste/fallo-activo) | 17/17 PASS |
| `auto-entries/accounting-events.listener.spec.ts` | 10/10 PASS |
| `account-mappings/account-mapping.d2.spec.ts` (catálogo + resolución sin seed) | 2/2 PASS |

Nota: el spec del listener no tiene test D.2 porque D.2 **no usa `@OnEvent`**
(verificado: sin `prepared` en `accounting-events.listener.ts`); `order-flow`
llama directo a `onPreparedDishDisposition` post-commit
(`order-flow.service.ts:266-297`). Por diseño, no un hueco.

## 4. Idempotencia — OK secuencial / RIESGO BAJO concurrente

Cadena de protección:

1. **Negocio (in-tx):** `cancelDeliveredOrderItem` (L3047-3056) y `cancelOrderItem`
   rama prepared (L2715-2724) re-chequean `cancelled_at` dentro del tx y abortan
   (`alreadyCancelledInTx`) si ya hay cancelación. El `UPDATE cancelled_at`
   comitea **antes** del post contable.
2. **Contable (post-commit):** `postPreparedDispositionAfterCommit` llama con
   `source_id=order_item_id`; `postAutoEntry` deduplica por
   `(organization_id, source_type, source_id, accounting_entity_id)` (L1310-1324):
   si el asiento existe, retorna el existente.
3. **Confirmado:** `schema.prisma` L6496 solo tiene `@@index` en esa tupla —
   **no hay unique constraint** (igual que todos los flujos del repo).

Análisis del doble-submit concurrente del mismo ítem:

- Caso común (requests separados por ms): el 2.º tx ve `cancelled_at` seteado →
  aborta in-tx → **un solo asiento**. OK.
- Caso retry secuencial post-fallo: el pre-check encuentra el asiento del
  1.er intento → **sin duplicado**. OK (y el spec de failure registra retry
  item-scoped para reparación).
- Ventana residual: dos tx **superpuestos en la misma ventana de ms** — el
  re-chequeo es `SELECT` plano (sin `SELECT FOR UPDATE`), y el `UPDATE` es
  incondicional `where: {id}`, así que ambos pueden comitear; luego ambos
  `postAutoEntry` pueden pasar el pre-check antes de que cualquiera inserte →
  **dos asientos** (incluso con igual `entry_number`, que también es
  read-then-write sin unique). Ventana estrechísima pero real.

**Riesgo: BAJO, preexistente a D.2, no bloqueante.** Endurecimientos posibles
(fuera de alcance del step; requieren decisión del orquestador):

- (a) `UPDATE ... WHERE id AND cancelled_at IS NULL` + verificar filas afectadas,
- (b) unique index en `(organization_id, source_type, source_id, accounting_entity_id)`
  (cambio DDL con backfill/dedup — vía migración, nunca manual).

## 5. Baseline DB — OK

Evidencia: `evidence/D.2-acct-baseline.txt`. Tienda 10 (Roku) → org 6 →
entidad 25 (STORE). PUC 1435/5295/6135 existen y activas (global + entidades
25/26; `accepts_entries=f` esperado en defaults nivel-3). Periodo `2026-09`
(id 164, entidad 25, `open`) cubre hoy (2026-09-24). `postAutoEntry` encontrará
periodo fiscal válido para asientos de tienda 10.

## Archivos escritos (nuevos, exclusivos de este verificador)

- `docs/critical-plans/CP-pos-order-flows-remediation/evidence/D.2-autoentries-jest.txt`
- `docs/critical-plans/CP-pos-order-flows-remediation/evidence/D.2-acct-baseline.txt`
- `docs/critical-plans/CP-pos-order-flows-remediation/evidence/D.2-acct-verdict.md` (este archivo)

No se modificó ningún otro archivo; no se tocó `order-flow.service.ts`, specs,
PLAN.md, steps, registry ni log; sin git write; sin E2E/navegador.
