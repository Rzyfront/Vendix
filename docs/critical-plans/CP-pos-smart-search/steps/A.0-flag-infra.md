---
id: A.0
title: "Flag infra two-tier + cutover"
phase: A
status: done
owner: none
updated: 2026-09-17
contracts: [ERR-19]
adrs: [ADR-01, ADR-07]
skills: [vendix-backend, vendix-settings-system]
---
# A.0 — Flag infra two-tier + cutover

- **Skills:** vendix-backend, vendix-settings-system
- **Resources:** none
- **Business decision:** Dos tiers: per-store `store_settings.pos_smart_search.{l1,l2,trigram}` (rollout gradual) + kill-switch global env (incidentes); lectura never-throw default-off; cutover es función pura flag×capability.
- **Why:** Va antes que todo lo demás porque B.1 consume flags que hoy no existen; la matriz y el orden de activación deben existir antes del primer toggle en prod.
- **Output:** Sección settings (4 archivos + KNOWN_SECTIONS + DTO), `resolveSearchFlags(storeId)` never-throw con caché TTL 30-60s + invalidación en PATCH, `resolveSearchPath()` (TRIGRAM∧capable>L2>L1>legacy), capability probe (pg_extension + indisvalid), audit de toggles.
- **Contracts touched:** ERR-19
- **Data impact:** R per-request (1 select settings batcheado o caché); W solo en toggles (settings + audit_logs).
- **Blast radius:** Sin flags no hay rollout gradual; kill-switch mal leído apaga el motor global (fail-closed a legacy = comportamiento actual, seguro).
- **Rollback:** Kill-switch env off = legacy global instantáneo (tras TTL); revert de sección settings.
- **Verification:**
  - `npm run buildcheck:test -- src/domains/store/settings/settings.service.spec.ts`
- **Acceptance checklist:**
  - [x] Matriz 8 estados × comportamiento (L2⇒L1, TRIGRAM⇒punto B.2)
  - [x] Flag down/unset → legacy + warn log, grid intacta (ERR-19)
  - [x] Kill-switch global fuerza legacy en ≤TTL sin deploy
  - [x] Toggle escribe audit_logs (actor, flag, old→new, scope, ts)
  - [x] F-006 — Flag POS_SMART_L1 consumido pero nunca definido (blocker)
  - [x] F-007 — Single-tier no sirve rollout gradual + kill-switch (blocker)
  - [x] F-021 — Matriz flags L1/L2/TRIGRAM indefinida (major)
  - [x] F-035 — Lectura de flag sin default-off ni never-throw (major)
  - [x] F-049 — Cutover A→B sin función de decisión ni capability guard (major)
  - [x] F-051 — Flags por keystroke: +1-2 lecturas DB sin caché (major)
  - [x] F-071 — Toggles de flag sin audit trail (major)
- **Status:** done
