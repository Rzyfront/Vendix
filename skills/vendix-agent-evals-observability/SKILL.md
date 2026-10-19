---
name: vendix-agent-evals-observability
description: >
  Govern agent traces and reproducible Vex/Vexi evaluations with independent
  postconditions, privacy and canonical attempt costs.
  Trigger: Instrumenting agent spans, changing outcome metrics or running agentic evals.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Instrumenting Vex/Vexi traces or provider attempts"
    - "Running or changing agentic evaluation datasets and graders"
---

# Agent Evals and Observability

## Safety contract

- Autonomy capabilities are standard, without environment switches.

- Use explicit authenticated ALS scope, never the legacy static request-context
  fallback. System traces require a separate declared system purpose. No tenant
  API may expose system traces or another user's/store's evidence.
- Persist only bounded allowlisted attributes, hashes, counts and IDs. Never log
  bearer/confirmation tokens, audio, raw documents, tool bodies, personal data or
  private reasoning. A hash is a fingerprint, not permission to retain raw data.
- Telemetry is best effort with bounded buffers and loss alarms; a failed sink
  cannot interrupt business work. Lost traces invalidate promotion evidence.
- UUID correlation IDs are server-created/validated. External non-UUID request
  IDs are hashed separately. Trace roots never replace metering request IDs.

## Outcomes and cost

A model response, HTTP 200, tool Promise resolution, plan completion or proposal
is not a business verifier. `awaiting_approval`/`awaiting_input` are not completed.
Use `completed_verified` only with independent authorized postcondition evidence;
phase A conservatively labels unverified legacy terminal responses `partial`.
Do not rewrite product responses or quota semantics to improve eval numbers.

Count logical provider calls, SDK HTTP attempts and agent iterations separately,
including empty retries and closing inference. Aggregate cost from the unique
canonical billable attempt entries only, never add logical logs to their children.
Missing usage/pricing is `null`/unknown, not free work. Preserve cache dimensions.

## Reproducible evaluation

1. Use `apps/backend/test/agentic/requests.es.jsonl` and deterministic fixtures:
   synthetic data only, two stores in one organization and a third unrelated.
2. Freeze dataset/fixture/config/model/prompt/catalog/cache fingerprints and the
   development/holdout split before measuring. Never silently exclude hard cases.
3. Run exact specs sequentially, no whole suites, builds, duplicate tools or live
   provider calls without an explicit authorized QA adapter and cost ceiling.
4. Missing adapters/receipts are `not_run`, never pass. Replay does not mutate
   business data. Shadow must not duplicate real writes. Voice without an audio
   adapter does not certify speech recognition, consent or UI behavior.
5. Grade structured domain/UI/guard evidence with scope and effect ledger, not
   generated prose. Require approval for every write and reconcile unknown effects
   before retrying. Negative tests contribute outcome accuracy, not completion.
6. Compare like-for-like cohorts with missing usage and failures visible. Publish
   discordant cases and uncertainty. Fixture contract tests cannot establish live
   canary completeness, provider cost accuracy or overhead.

## Operations

Spans: proposed retention 14 days; aggregates 90 days. Cleanup requires a later
bounded authorized job, never destructive SQL in a schema migration. Rollback:
Use the existing general Vex/Vexi control to stop operation; preserve evidence.

## Related Skills

- `vendix-ai-platform-core` — model routing, logging and provider usage.
- `vendix-ai-agent-tools` — execution and confirmation invariants.
- `vendix-prisma-scopes` — tenant isolation and singleton registration.
- `how-to-test`, `buildcheck-dev` — authorized verification and machine limits.

## Standard autonomy operation

Autonomy is always active in code; stop Vex/Vexi through its existing general
control, not environment switches. Sandbox availability requires the actual isolated
runtime/supervisor/configuration and source encryption key. Missing dependencies
yield an unavailable recoverable result; other tools remain usable. Recipe mining
is active independently of the signing key; publication without
`AI_RECIPE_REVIEW_KEY` is a safe no-op. Bootstrap automatically synchronizes
the tool/process catalog; missing embeddings degrade to authorized lexical search.
