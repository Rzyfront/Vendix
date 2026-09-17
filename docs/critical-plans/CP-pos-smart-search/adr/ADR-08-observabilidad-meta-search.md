---
id: ADR-08
title: "Contrato observabilidad: meta.search + logs + CTR"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-08 — Contrato observabilidad: meta.search + logs + CTR

- **Context:** El plan medía calidad una vez (staging) y volaba ciego en prod: degrade silencioso, slowness sin atribución, pesos sin CTR, flags sin trail, GIN INVALID sin re-check.
- **Decision:** Toda respuesta search lleva `meta.search:{rank_mode:ranked|unranked_scan_cap|unranked_error|legacy, layer:L1|L2|trigram, degraded:bool}` (FB-01/04/05/12/14). Línea estructurada por request (request_id, store, query-hash, tokens, ms por etapa, rank_mode; warn si degradado/sobre presupuesto; request_id como comment SQL). Counter `search_degraded_total{reason,store}` + alerta por ratio. Evento selección (query-hash, posición, id, rank_mode) → CTR top-1/top-3. `statement_timeout` en searchIdsRanked. Probe startup GIN missing/INVALID → warn + page tras gracia.
- **Consequences:** Degradación visible para UI (hint chip), oncall (alerta) y calibración (CTR); costo 1 línea log/request + evento selección.
- **Reversibility:** trivial — campos meta aditivos; logs bajables a debug.
- **Revisit if:** Volumen de logs excesivo; entonces muestreo (siempre 100% en degradados).
