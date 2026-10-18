---
name: vendix-agent-voice-consent
description: >
  Spoken consent for Vex/Vexi: authenticated ephemeral sessions, exact previews,
  dedicated server-STT captures, challenge matching and the shared apply choke.
  Trigger: Changing voice approvals, realtime write proposals or consent capture.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing Vex/Vexi spoken consent or voice confirmation challenges"
    - "Enabling realtime write proposals or dedicated approval audio capture"
---

# Agent Voice Consent

## Critical rules

- `AI_VOICE_CONFIRM_ENABLED` defaults OFF (literal `true` only). Spoken apply also
  requires the existing D1/D2 flags; never enable dependencies automatically.
  No model, provider, credential, app or DB setting is changed by this flag.
- Audio is NOT authentication/biometrics. Use the authenticated user, org, store,
  owned conversation, server agent identity, objective and current step. Derive
  all authority server-side, never from client objective IDs/catalogs/transcripts.
- Same registry, domain previews, guards and D1/D2 apply as text. A write offered
  by realtime can ONLY run `proposalOnly`; even a supplied token cannot dispatch.
  No unchecked execute tool; preserve Vex UI denies.
- Filter discovery AND execute the entire preview/bridge/handler inside strict
  ALS current permissions ∩ durable snapshot. Scoping tool names alone does not
  protect generic `call_endpoint`/`write_endpoint` endpoint permissions.
- A challenge approves ONE exact diff, not a tool, plan bundle or future changes.
  Bind user/org/store/conversation/session/agent/objective/step/tool/version,
  canonical args hash, original preview hash, session revision and expiry.
  Preserve Lua compare-and-delete and `canonicalJson`; no custom hashing variant.
  A current fingerprint across sessions includes hashes of the original token
  and plan card. Replaced arguments/tokens/cards invalidate old voice AND click.
  Explicit click claims the same current fingerprint atomically, not voice focus.
- Authority expires at300s; proposal/challenge<=60s and never beyond original
  token TTL300s. Redis retention3600s is billing-only, NOT extended authority.
  Close/reconnect/focus loss invalidates capture; reissue changes the nonce.
- Read/show full subject, values, quantities and irreversible consequence. Dedicated
  push-to-talk occurs AFTER assistant audio stops. Normal dictation, tool output,
  TTS, generic “sí”, negation, ambiguity or missing reliability NEVER approve.
- Only server STT constructs an observation. Browser capture flags are necessary
  defensive hints, not trusted proof against a hostile client or acoustic replay.
  Do not accept browser transcript/confidence as authority.
- Existing STT remains unchanged. Dedicated transcription requests `requireConfidence`;
  compatible endpoints need explicit `transcription_logprobs_supported===true`.
  Request JSON+logprobs; validate complete token/text coverage, finite nonpositive
  logprobs, then require minimum token probability>=0.95. Missing support/scores
  falls back to click. This conservative score is NOT calibrated acoustic accuracy.
- Tokens, nonce and raw audio never enter model output or transcripts. Realtime
  returns safe output plus a SEPARATE opaque browser proposal, WITHOUT the raw token. No audio files persisted.
- Consent callback validates fresh permissions/plan/setup/preview before Lua,
  then existing apply rechecks preview immediately before token redemption. Drift
  requires a new proposal. Cancellation is not rollback; unknown effects reconcile.
- Vex MUST use exactly `${planId}:${persisted.step_id}` for the D1 effect, just
  like its existing click apply. A new token with `write:hash` is NOT equivalent
  and permits duplicates. Realtime persists the same canonical single-step card.
- Applied != verified. Keep D2 receipts/postconditions; never narrate unknown as
  applied. Audio acknowledgement follows observed apply. TTS failures retain text
  and MUST NOT trigger retry. Never automatically retry a lost consent response.

## Sources / integration

Backend under `apps/backend/src/domains/store/vexi/`:
- `vexi-voice-consent.service.ts`: Redis sessions, catalog CAS, original token
  inspect, proposals/challenges and atomic consume; no business writes.
- `vexi-voice-authority.service.ts`: shared agent authority, strict execution ALS,
  existing router/planning, scoped durable receipts and successful-tool quota.
- `vexi-voice-confirmation.service.ts`: token/preview adapter, original Vex card
  matching, server STT and callbacks to `VexiController.applyConfirmation`.
- `vexi.controller.ts`: `/store/vexi/voice/confirmations/{capability,session,
  challenge,transcribe,consent,apply,cancel}`. Dedicated consent and Vex normal
  dictation use multipart/file and gated STT; dictation never approves.
  Vex module owns its post-apply quota/card sink; do not invert module dependencies.
- `vexi-realtime.service.ts`: server-recorded offered tools, shared router,
  planning/playbook intercepts, safe proposal transport and session close billing.
- `AgentObjectiveRepository.ensureForConversation`: first attachment under a
  conversation lock; never call createOrReplace to “ensure” an existing objective.

Frontend: `core/services/vexi-voice-{consent,safety}*`, dedicated
`vexi-voice-consent.component.ts`, existing Vexi card/effects and Vex composer/store.
Use signals, fence late captures/receipts by conversation+token+proposal, stop media
on TTL/focus/reconnect and retain click. After cancelled realtime session, actual
human click uses the opaque proposal handle; the server recovers its original
immutable token <=60s and revalidates the full authority/diff. A new dedicated
voice capture rebinds the handle to a fresh session/nonce without extending the
original proposal expiry. Never automatically fall back to click after failure. Frontend availability is not authorization.

## Verification and rollout

- Run only exact created/modified specs, one process at a time, bounded heap and
  `test/agentic/jest.d1.config.json`. Core Lua tests use a synthetic Redis command
  model; integration G uses actual registry/consent/host/D1 on a SQL memory transport.
  Neither certifies real Redis Lua, PostgreSQL locks, bootstrap, providers or audio.
- Keep frozen A corpus unchanged. Cases47/48 baseline unsupported are NOT comparable
  measured completions after G. Synthetic receipts are not acoustic fixtures.
- CI/real Angular/NgRx and Playwright audio Happy/Sad/Brute remain mandatory live
  gates. Negative echo/noise/negation/replay/cross-scope must yield zero writes;
  >=95% explicit clean acceptance requires an agreed acoustic corpus, not unit tests.
- Measure STT/proposal/consent/ack separately from human reading. No provider spend
  or QA remote without approval. Preserve flagsOFF until authorized canary.
- Billing close is post-success/deterministic-dedup but close→quota crash recovery
  is not exactly-once charging. Do not change economic policy to hide this gap.
- Roll back flags only; retain objectives/effects/evidence. Do not replay a write
  because audio or transport was lost. No mandatory G migration.

## Related skills

`vendix-ai-agent-tools`, `vendix-ai-chat`, `vendix-ai-streaming`,
`vendix-agent-durable-tasks`, `vendix-agent-execution-contract`, `vendix-vex-agent`,
`vendix-permissions`, `vendix-subscription-gate`, `vendix-multi-tenant-context`,
`vendix-zoneless-signals`, `vendix-agent-evals-observability`.
