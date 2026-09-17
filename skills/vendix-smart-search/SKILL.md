---
name: vendix-smart-search
description: >
  Advanced product search engine (tokenized recall + relevance rank + pg_trgm unaccent) and how to replicate it for other entities.
  Trigger: Adding or changing product/storefront/picker search, ranking results by relevance, accent-insensitive matching (cafe→Café), or porting the smart-search pattern to another entity.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
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

## Purpose

This skill governs the advanced search engine built for products (CP-pos-smart-search, PR #817) and how to replicate it for other entities. It covers what the engine does, the strategy behind it, and the exact recipe to port it. It does not govern AI embeddings/RAG semantic search (see `vendix-ai-embeddings-rag`) or Autocomplete UI widgets in general.

## What It Does

Given a free-text query (`search=cafe sello`), the engine returns matching rows ordered by relevance instead of insertion order:

- **Tokenized recall**: every query token must appear in ≥1 searched field (AND×OR). Multi-token queries match in any order (`sello cafe` finds `Cafe sello rojo`).
- **Relevance rank**: exact > prefix > word-boundary > contains; name outranks SKU outranks description; featured and best-selling break ties; deterministic order (score, coverage, featured, date, id) so pagination never drifts.
- **Accent-insensitive** (trigram path): `cafe`, `café`, `CAFÉ` all find `Café`. `ñ/Ñ` are deliberately preserved (`nandu` does NOT match `Ñandú`, F-079 — `año`≠`ano`).
- **Fail-open everywhere**: any operational failure (DB down, timeout, over scan-cap, kill-switch) degrades to legacy listing. The grid never breaks because of search.
- **Honest pagination**: `total` always counts the ranked set, never the legacy set.

## Strategy (The Three Paths)

One endpoint, three recall+rank paths chosen per request by capability, never by per-store flags (flags were removed — cutover is global):

| Path | Recall | Rank | When |
| --- | --- | --- | --- |
| `legacy` | Prisma `contains` of the raw phrase per field (OR) | `created_at` desc (or caller order) | Kill-switch on, no search/barcode, no store, provider missing, or any throw |
| `l2` | Prisma AND×OR over normalized tokens | In-memory scorer over a light scan (scan-cap bounded, fail-open past cap) | No pg_trgm capability |
| `trigram` | Raw SQL with `immutable_unaccent(lower(col))` + GIN indexes | Same scoring, translated to SQL | pg_trgm + unaccent + wrapper + valid GIN present |

Cutover (`resolveSearchPath`): kill-switch ⇒ legacy, capable ⇒ trigram, else l2. The capability probe is cached (60s TTL), never throws, and treats a missing/invalid GIN as incapable. L2 without trigram is accent-blind by design (Prisma `contains` cannot unaccent) — parity with legacy, not a regression.

### Why raw SQL for trigram (and its guardrails)

Prisma cannot express `unaccent()` or trigram similarity, so recall+rank for the trigram path is hand-written parameterized SQL (`$n` params only, LIKE metachars escaped, `statement_timeout` 2000ms, slow-log 250ms). Non-negotiable guardrails:

- **Tenant scope twice**: AsyncLocalStorage store check (fail-closed, `Forbidden` propagates — never fail-open) AND `store_id = $1` as the first predicate; related tables only via FK joins.
- **Filter mirror**: the raw must mirror EVERY `buildWhere` input (including non-obvious ones like `pos_optimized`→`state=ACTIVE` with its exact precedence). A missing mirror inflates `total` and shortens pages. Always add a mirror spec per filter.
- **COUNT twin**: the `total` query reuses the same builder functions so its WHERE is byte-identical to the ranked query.
- **Hydrate second lock**: ranked ids are hydrated through Prisma with the scalar filters re-applied (minus text), so drift fails closed.
- **GIN parity**: the SQL canonical expression must be textually identical to the indexed expression, or Postgres silently skips the index. Pin with a spec.

## Core Rules

- Never rank without recall parity: the ranked set must be the same set the listing would show (`findAll`≡`findIds` on the same `where` + predicate).
- Never add a filter to the Prisma `where` without mirroring it in the trigram raw (and vice versa) plus a mirror spec.
- Never interpolate user input into raw SQL — `$n` params only. Never catch `ForbiddenException` into fail-open.
- Never let the tokenizer's accent folding reach an accent-sensitive `contains`: accented queries fall back to the legacy phrase branch (`isSearchAccentFolded`), while the rank still orders that set (the scorer folds both sides).
- Never run `CREATE INDEX CONCURRENTLY` inside a migration transaction: apply via runbook psql + `migrate resolve --applied` (see `vendix-prisma-migrations` Rule 6).
- Never change an `IMMUTABLE` function's body after a GIN depends on it without `REINDEX` — Postgres trusts you and the index silently goes stale.
- Keep `meta.search` (`rank_mode`, `layer`) traveling only with `search`, and keep the layer union stable — frontends allowlist it.
- Telemetry (CTR logging) is fire-and-forget and must never break the sale path.

## Workflow — Replicate For Another Entity

Follow the D.1/D.2 (pickers) shape for a light port, or the products shape for a full port with trigram. Concrete reference files under `apps/backend/src/`:

1. **Tokenizer + gate** (`common/utils/search-text.util.ts`): reuse `tokenizeInternal`/`tokenizePublic` (never reimplement normalization), `buildTokenAndFieldOr(tokens, fieldMap)` for the AND×OR, and `isSearchAccentFolded(raw)` to route accented queries to the legacy phrase branch. The gate is `tokens.length > 0 && !accentFolded && !killSwitch`.
2. **In-memory rank** (`common/utils/search-score.util.ts`): reuse `scoreTokens` + `rankedIdsPage` over a light scan (scalars only, capped — transfers use 200, products 20k). Past the cap, fail open to legacy.
3. **Where**: keep the legacy OR-phrase as the base (fail-open), derive the tokenized variant without mutating it, and preserve every pre-existing filter (location, scope, state) in both branches.
4. **Contract**: return `{ data, meta: { total, applied_tokens, tokens_truncated } }`; never leak the raw query (hash it if telemetry needs it).
5. **Trigram (full port only)**: add the entity's columns to the C.1-style wrapper reuse (same `immutable_unaccent` — do not create a second one), new GIN migration via runbook, raw builder mirroring the entity's `buildWhere` + COUNT twin + hydrate lock + mirror specs.
6. **Kill-switch**: gate on `PosSearchPathService.isKillSwitchOn()` (sync, never throws). No per-store flags — that mechanism was removed on purpose.
7. **Specs**: smart where shape, legacy fallback (kill/throw/accents/stopwords), scan-cap fail-open, rank order fixture, and (full port) SQL/JS parity fixture + filter mirror per filter.
8. **Frontend**: consume `meta.search` null-safely; never re-sort a ranked page client-side; strip query params the DTO does not declare (global pipe is `forbidNonWhitelisted`).

## Decision Rules

| Situation | Use |
| --- | --- |
| New picker/modal search over a small set | Light port (L1 where + L2 rank, transfers/adjustments shape) |
| High-traffic listing needing accent folding | Full port with trigram (products shape) |
| Query contains accented vowels/ç | Legacy phrase branch + rank (never tokenized `contains`) |
| Query with ñ/Ñ, symbols, or multi-token unaccented | Smart branch (tokenizer preserves ñ, symbols help the AND) |
| GIN missing/invalid or DB without pg_trgm | L2 automatically (capability probe decides, no code branch) |
| Incident / bad results in production | `POS_SMART_SEARCH_OFF=1` + restart (global legacy, no deploy) |

## Gotchas (Paid For In Production)

- The plan once claimed L2 had legacy parity for accented queries — it did not (`café`→`Café` returned 0 on L2 vs 1 on legacy). The accent fallback exists because of this. Retest it live whenever the tokenizer changes.
- `pos_optimized` secretly filters `state=ACTIVE` with precedence over `include_inactive`. Anything that builds a parallel recall (raw SQL, light scan) must replicate that precedence exactly.
- `migrate deploy` and `CONCURRENTLY` do not mix; the pipeline survived only because the GIN was pre-applied + resolved. Always pre-apply GIN migrations via runbook.
- Applying migration SQL by retyping instead of byte-verbatim once shipped a naive function body to prod; the smoke check caught it. Transport with sha256, execute verbatim, smoke before resolve.
- Mobile webviews and the global `forbidNonWhitelisted` pipe: sending an undeclared param is a 400, not a silent ignore. Strip client-side.

## Related Skills

- `vendix-prisma-migrations` - GIN/CONCURRENTLY runbook, resolve flow, checksum discipline
- `vendix-backend-domain` - Domain layout, module ownership for shared services
- `vendix-multi-tenant-context` - ALS store scoping rules the raw SQL must obey
- `vendix-ai-embeddings-rag` - Semantic/vector search (different engine, different use cases)
- `vendix-currency-formatting` - Unrelated to search; listed to avoid confusion with rank/score display
