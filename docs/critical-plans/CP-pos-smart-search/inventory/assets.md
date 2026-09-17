# Reusable Assets

- `apps/backend/src/domains/help-center/articles/articles.service.ts` — tokenize() (lowercase, split unicode, stopwords ES, tope 8 tokens) + relevanceOf() (título/tags×3, summary×2, body×1) + byRelevance() (sort estable); patrón a imitar para ranking POS
- `apps/backend/src/domains/store/expenses/expense-scanner.service.ts` — normalizeText() (NFD + strip diacríticos + lower) + scoring por tiers (exacto → contains → word-overlap)
- `apps/backend/src/common/utils/geo-name.util.ts` — normalizeGeoName(), núcleo NFD copiable (:137-142); resto geo-específico
- `apps/frontend/src/app/core/utils/geo-name.util.ts` — espejo frontend del normalizador NFD
- `apps/frontend/src/app/shared/constants/store-module-catalog.constant.ts` — resolveStoreModule(): NFD + match exacto → substring único no-ambiguo
- `apps/backend/src/ai-engine/embeddings/embedding.service.ts` — searchSimilar()/searchByText() por coseno con filtro store_id obligatorio; fallback semántico (costo/latencia OpenAI por query)
- `apps/backend/src/domains/store/accounting/bank-reconciliation/reconciliation-matching.service.ts` — textSimilarity() + levenshtein() DP privado (:434); apto para re-rank de ~50 candidatos
- `apps/backend/src/ai-engine/ai-engine.service.ts` — runRerank() LLM (:1257); overkill para POS, listado por completitud
- `apps/backend/src/jobs/embedding-sync.job.ts` — backfill diario de embeddings (500/día); eventos product.created/updated → cola ai-embedding ya generan embeddings de productos
