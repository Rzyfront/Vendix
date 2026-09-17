---
id: ADR-06
title: "Sin capa semántica L3 (embeddings)"
status: proposed
reversibility: trivial
updated: 2026-09-17
---
# ADR-06 — Sin capa semántica L3 (embeddings)

- **Context:** El usuario pidió explorar búsqueda semántica pero eligió excluir L3 (pregunta Semantica, 2026-09-17) tras ver costo/latencia: 1 llamada OpenAI por query (~$0.00002 + 200-600ms), embeddings con backfill diario (staleness), min_similarity 0.3 con falsos positivos.
- **Decision:** Sin L3. Typos graves se rescatan a futuro con pasada relajada OR + fuzzy (Levenshtein/trigram) sobre candidatos, costo ~0. ai_embeddings queda como superficie documentada (DB-10) sin consumir en este plan.
- **Consequences:** Cero costo recurrente y cero dependencia de OpenAI en el path de caja. Queries raras ("regalo mamá") devuelven vacío limpio en vez de rescate semántico.
- **Reversibility:** trivial — añadir L3 después es una capa nueva con compuertas, sin rework (contrato L1 "0 resultados" ya documentado).
- **Revisit if:** tasa de L1-vacío alta con queries válidas tras Fase B; entonces proponer L3 con compuertas como CP separado.
