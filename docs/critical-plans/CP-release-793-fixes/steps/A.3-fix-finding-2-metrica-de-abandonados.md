---
id: A.3
title: "Fix finding 2: metrica de abandonados"
phase: A
status: done
owner: none
updated: 2026-09-11
contracts: [FB-05, DB-01]
adrs: [ADR-01]
skills: [vendix-backend, vendix-analytics-metrics, how-to-dev]
---
# A.3 — Fix finding 2: metrica de abandonados (F-002)

- **Skills:** vendix-backend, vendix-analytics-metrics, how-to-dev
- **Resources:** F-002, ADR-01, `customers-analytics.service.ts` (5 queries), QUI-628 (Devuelto: comentar el hallazgo)
- **Business decision:** ADR-01: derivar en SQL en lugar de job de marcado. Cero migracion, cero job, solo lectura.
- **Why:** La metrica hoy mide ~0 por definicion inalcanzable. La query derivada (`active` + `last_activity_at` anterior a X + con items, X como constante nombrada) la vuelve real sin tocar escritores.
- **Output:** 5 queries con definicion derivada + ventana X documentada + comentario en QUI-628. Cierra F-002.
- **Contracts touched:** FB-05, DB-01 — misma forma de respuesta, nueva definicion de filas (ver registry).
- **Data impact:** none — sin migracion ni backfill; solo lectura.
- **Blast radius:** Dashboard de abandonados (summary/trends/by-reason/export). Los valores pasaran de ~0 a reales: comunicar el salto en QUI-628.
- **Rollback:** Revert del commit; sin datos que migrar.
- **Verification:**
  - SQL directo contra staging con carritos fixture: `abandonment_rate > 0` donde corresponde y 0 donde no
  - Frontend `abandoned-carts.component` renderiza growth `number|null` sin regresion
  - Specs de analytics en verde (mock $queryRaw actualizado a la nueva definicion)
- **Acceptance checklist:**
  - [x] Queries derivadas con ventana X nombrada y documentada
  - [x] Evidencia SQL before/after en evidence/ y QUI-628 comentado
  - [x] Specs en verde y finding de este step cerrado en su record
- **Status:** done — verificado y consolidado 2026-09-11
