---
name: vendix-agent-golden-conversations
description: >
  Live golden-conversation E2E suite for Vex/Vexi: real multi-topic chats, graders, SQL oracles, cost
  ceiling, baseline-vs-candidate token comparison. Trigger: running, extending or grading golden
  conversations, or comparing agent token cost.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Running or extending the Vex/Vexi golden-conversations E2E suite"
    - "Comparing agent prompt tokens or pass rate between a baseline and a candidate backend"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Golden Conversations (live E2E for Vex/Vexi)

## Purpose

Governs the live suite that decides whether an agent change (routing, prompt, loop,
contract) can ship: ≥30 real multi-turn conversations, graded per turn, with SQL
oracles for writes and per-call token accounting. It does NOT govern the replay/
mock evals (`vendix-agent-evals-observability`) nor production QA (`verify-ticket-prod`).

## Files

| File | Role |
| --- | --- |
| `apps/backend/test/agentic/golden-conversations.es.jsonl` | One case per line (`g01…`) |
| `apps/backend/test/agentic/graders.ts` → `gradeGoldenTurn` | Per-turn checks |
| `apps/backend/test/agentic/live-http.adapter.ts` | HTTP/SSE driver, oracles, tokens, report |
| `apps/backend/scripts/agentic-eval.ts --mode live --suite …` | CLI entry |

## Critical rules

- **Never against prod or the shared Docker `vendix_backend`.** Run a backend from
  the worktree on another port (default `:3100`) with a cloned local DB whose name
  contains `e2e` (the adapter refuses otherwise) and its own Redis. Stop both at the end.
- **Secrets by file, never printed.** `--db-url-file`, `--or-key-file` (chmod 600).
  The OpenRouter key is only used to read `/credits`; never log it or save it in memory.
- **Spend ceiling first.** Ask the owner for a USD ceiling before any live run, pass
  `--min-credit-usd` as the floor, and keep the running cost counter in the log
  (`cost=` per case, total in `<label>-summary.json`). Billable cost comes from
  `ai_engine_logs.cost_usd` by `conversation_id`, never estimated from prose.
- **Same model, DB and fixtures for baseline and candidate.** Baseline = the
  compiled `dist` of the base commit started on the same port, candidate = the
  worktree. Run them one at a time (never both up: memory) and compare with the
  same case set.
- Writes always go through proposal + confirmation: the adapter approves with
  `POST /store/{agent}/confirmations/apply` only when the turn says `approve`, and
  rejects by sending the user's refusal. An oracle must prove the effect (or its
  absence); a model sentence is not evidence.
- Voice (WebRTC) and dictation cannot be driven from a script. Run their text
  equivalent, mark the case `channel: realtime` or `channel: dictation` (text
  stands in for audio), and cover the realtime path with specs. Never report voice as certified by this suite.

## Case schema

```json
{"id":"g02-cliente-direccion","agent":"vexi","principal":"owner","topic_change":true,
 "seed_history":[...], "setup":"empty_index", "expect_retrieval":"full_catalog_fallback",
 "turns":[{"message":"…","expect_tools_any":["customer"],"expect_write":true,
   "approve":"approve|reject","allow_no_write":false,"permission_notice":false,
   "oracle":{"sql":"select …","after_approve":"1","unchanged":true}}]}
```

- `principal`: `owner` (owner@techsolutions.co, tech-bogota), `restaurant_owner`
  (owner@roku.vendix.com, roku), `cashier` (cashier@roku.com, roku). Password from
  env `E2E_SEED_PASSWORD` or the seed; never commit another.
- `expect_tools_any`: substrings; any tool called in the turn matching one passes.
- `setup: empty_index` deactivates global tool docs for the case and restores them
  after (exercises the full-catalog cascade). Only on the e2e clone.
- Mix in every suite: topic changes inside one chat, write+approve, write+reject,
  cashier denied (`permission_notice: true` only where the denial is real), Vex and
  Vexi, a case per discovery source (vector, lexical, fallback).

## Graders (`gradeGoldenTurn`)

`non_empty`, `no_exhausted` («No alcancé…»), `no_false_permission`, `no_jargon`
(`GOLDEN_JARGON`: internal tool/stage names), `no_stage_codes`, `forbidden_tools`,
`no_error_frame`, `expected_tools`, `confirm_before_write`. A case passes only if
every graded turn passes. Do not relax a grader to turn a run green; fix the cause
or document the case as a product defect with evidence.

## Headless browser

Vexi `ui_*` tools run in the tab and the loop waits up to 25 s on
`(stream_id, tool_call_id)`. The adapter answers each `tool_call` frame whose name
starts with `ui_` via `POST /store/vexi/ui-result` with shapes copied from
`vexi-ui-command.service.ts` over a small fixed module list. This grades routing,
not the UI: frontend behavior still needs Playwright (`how-to-test`).

## Workflow

1. Clone the DB (`…_e2e_…`), start Redis + backend on `:3100` from the worktree.
2. Ensure the agent app config points to a valid key/model; read credits.
3. `npm run -s eval:agentic -- --mode live --suite test/agentic/golden-conversations.es.jsonl --label <run> --out <dir> --db-url-file … --or-key-file … --psql <psql> --min-credit-usd <floor> [--cases g01,g07]`
4. Re-run only failing cases with `--cases` before blaming the product; a case that
   fails twice is a finding. Report `pass^k` when the budget allows k runs.
5. Start the baseline `dist`, run the same cases with another `--label`.
6. Report: per-case pass, p50/max prompt tokens per call, calls, cost; totals; and
   the router span metrics (`core_count`, `loaded_count`, `retrieval_source`,
   `unloaded_authorized_calls`, `free_discovery_rounds`).
7. Stop the backend and Redis; never leave background processes.

## Related skills

- `vendix-agent-evals-observability` — trace privacy, canonical attempt costs.
- `vendix-ai-tool-routing` — working set and metrics being measured.
- `vendix-agent-execution-contract` — exhausted/closing semantics graded here.
- `how-to-test` — Playwright for the UI half; `buildcheck-dev` — memory limits.
