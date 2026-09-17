---
id: ADR-07
title: "Flags two-tier + cutover flag×capability"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-07 — Flags two-tier + cutover flag×capability

- **Context:** B.1/E.2 consumían flags inexistentes en el repo (cero hits FeatureFlag); un solo tier no sirve rollout gradual (por tienda) y kill-switch (global instantáneo); TRIGRAM on sin wrapper/GIN = 500 masivo.
- **Decision:** Tier-1 per-store `store_settings.pos_smart_search.{l1,l2,trigram}` (default off, registro 4 archivos) + Tier-0 kill-switch env global. Lector `resolveSearchFlags` never-throw, caché TTL 30-60s con invalidación en PATCH (rollback ≤TTL, no instantáneo). Cutover `resolveSearchPath()` puro: TRIGRAM∧capable>L2>L1>legacy; L2⇒L1; capability probe (pg_extension + indisvalid) cacheada; sin capability → fallback Fase A con warn + métrica.
- **Consequences:** Rollout gradual + MTTR global en un toggle; costo +1 select/cache por request (presupuestado en p95) y audit por toggle.
- **Reversibility:** trivial — kill-switch off restaura legacy global; sección settings revertible.
- **Revisit if:** TTL 60s resulta largo en incidentes; entonces push de invalidación o tier-0 por store crítica.
