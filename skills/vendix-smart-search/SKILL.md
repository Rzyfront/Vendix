---
name: vendix-smart-search
description: >
  Product smart search (tokenized recall + relevance rank + pg_trgm unaccent) and how to port it. Trigger: product/storefront/picker search, relevance ranking, accent-insensitive matching (cafe→Café), porting to another entity.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
  scope: [root]
  auto_invoke:
    - "Adding tokenized multi-field search to a module"
    - "Ranking search results by relevance"
    - "Making search accent-insensitive (cafe finds Café)"
    - "Replicating the POS smart-search pattern to another entity"
    - "Editing search cutover, rank weights, or trigram SQL"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Vendix Smart Search

Product search engine (POS, storefront catalog, pickers) and how to port it. Not for embeddings/RAG (`vendix-ai-embeddings-rag`).

Detail: `references/engine.md` (three paths, trigram raw-SQL guardrails, step-by-step port recipe, decision table, production gotchas; read on demand).

## Behavior

- Tokenized recall: every token in ≥1 field (AND×OR), any order.
- Rank: exact > prefix > word-boundary > contains; name > SKU > description; featured/best-selling break ties; deterministic order (score, coverage, featured, date, id) so pages never drift.
- Accent-insensitive on the trigram path (`cafe` finds `Café`); `ñ/Ñ` preserved on purpose (`año` ≠ `ano`).
- Fail-open: any operational failure (DB, timeout, scan-cap, kill-switch) degrades to legacy listing. `total` always counts the ranked set.
- Paths: `legacy` / `l2` (Prisma AND×OR + in-memory scorer) / `trigram` (raw SQL `immutable_unaccent(lower(col))` + GIN). Chosen globally by capability via `resolveSearchPath` (kill-switch ⇒ legacy, capable ⇒ trigram, else l2); no per-store flags.
- Kill-switch: env `POS_SMART_SEARCH_OFF=1` + restart; check with `PosSearchPathService.isKillSwitchOn()` (`domains/store/settings/pos-smart-search/`).

## Core rules

- Recall parity: the ranked set equals what the listing shows (`findAll` ≡ `findIds` on the same `where`).
- Every filter in Prisma `buildWhere` is mirrored in the trigram raw SQL (and vice versa) with a mirror spec, including hidden ones (`pos_optimized` ⇒ `state=ACTIVE` with precedence over `include_inactive`). COUNT reuses the same builders; ranked ids are hydrated through Prisma with scalar filters re-applied.
- Raw SQL: `$n` params only, LIKE metachars escaped (`escapeLike`), `statement_timeout` 2000 ms. Tenant scope twice: ALS store check (fail-closed; never catch `ForbiddenException` into fail-open) and `store_id = $1` first predicate; related tables only via FK joins.
- SQL expression must be textually identical to the GIN index expression (pin with a spec). Reuse the existing `immutable_unaccent`; changing an `IMMUTABLE` body requires `REINDEX`.
- `CREATE INDEX CONCURRENTLY` never inside a migration transaction: pre-apply via runbook psql (byte-verbatim, sha256) then `migrate resolve --applied` (`vendix-prisma-migrations`).
- Reuse `common/utils/search-text.util.ts` (`tokenizeInternal`/`tokenizePublic`, `buildTokenAndFieldOr`, `isSearchAccentFolded`, `isSmartSearchActive`) and `common/utils/search-score.util.ts` (`scoreTokens`, `rankedIdsPage`, `compareSearchRank`); never reimplement normalization.
- Accented queries go to the legacy phrase branch (Prisma `contains` cannot unaccent); the scorer still orders that set.
- `meta.search` (`rank_mode`, `layer`) travels only with `search`; keep the layer union stable (frontends allowlist it). Never leak the raw query (hash for telemetry). CTR telemetry is fire-and-forget.
- Frontend: read `meta.search` null-safely, never re-sort a ranked page, strip query params the DTO does not declare (global `forbidNonWhitelisted` ⇒ 400).

## Related

`vendix-prisma-migrations`, `vendix-backend`, `vendix-multi-tenant-context`, `vendix-ai-embeddings-rag`.
