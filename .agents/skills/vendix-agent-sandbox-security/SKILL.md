---
name: vendix-agent-sandbox-security
description: >
  Optional read-only Deno sandbox for Vex/Vexi, immutable host authority,
  stdio RPC, gVisor lifecycle, encrypted audit and isolation release gates.
  Trigger: Changing run_readonly_script, its broker, policy or Linux runner.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Changing run_readonly_script or the sandbox RPC broker"
    - "Changing agent sandbox isolation, limits or deployment adapter"
---

# Agent sandbox security

## Non-negotiable boundary

- Autonomy capabilities are standard, without environment switches.

- Availability is detected from real isolated-runtime dependencies, never a store canary allowlist.
- NEVER run generated code in Nest, Node `vm`, local Deno, or on the dev Mac.
  Runtime is one ephemeral Linux gVisor capsule per execution. No network,
  host/tenant mounts, Docker socket, secrets, FS, env, subprocesses, FFI, imports
  or packages in the guest. The trusted host supervisor is outside the capsule.
- Deno permissions do not bound CPU/RAM and initial module graphs have loading
  exceptions. Only the trusted import-free wrapper is an initial module;
  generated source is data. Lexical import checks are UX, NOT containment.
- JavaScript async bodies; TypeScript is deliberately JS-valid syntax/JSDoc,
  not a full compiler and never regex type erasure. Syntax failure stops safely.

## Host authority and data

- The agent loop supplies `sandboxInvocation` with its SAME D1 session. Guest
  frames have no authority. Strict ALS only; `currentContext` fallback prohibited.
- Manifest ∩ initial working set ∩ current catalog ∩ original/durable/current
  permissions, subtract current agent denies and plan restrictions. Revalidate
  every call and before publishing final output; no roles fallback or stored JWT.
- Initial semantic allowlist is ONLY `list_products` v1 with pinned schema and
  permission contract. `readOnly` alone is insufficient. No generic endpoints,
  discovery/admin, UI, plan/scratch/block tools, recursion or writes. Extending
  this list requires domain-effect and scope review, projection and negative tests.
- Current and original `kitchen` principals are denied: clearing roles would
  bypass the product service's money-hiding projection. Inventory org-wide tools
  are not automatically store-safe. Product variants are omitted, but the domain
  service still hydrates them internally; output row caps are NOT host DB/RAM caps.
- Persist allowed read results through D1 before guest delivery. Audit intent
  before registry dispatch. Exact source LF/NFC hash and AES-GCM ciphertext are
  owner/org/store scoped; no raw source/args/results/errors in global logs. Public
  SSE/transcript args carry source hash, never source. Retention7d is logical ACL;
  physical disposal/key rotation requires an approved operator process.
- Every underlying observed successful read consumes the existing tool unit;
  wrapper does not double-charge. Exit0/returned JSON is NOT business verification.
  No fabricated completeness, measured cost, receipt, or recipe promotion.

## Limits and lifecycle

- Hard maxima:256MiB,1CPU,2sCPU,30s total wall,20calls,3concurrent,
  10pages/5000rows,2MiB replies,64KiB output,32KiB source. Smaller objective and
  turn budgets always win. Initial catalog runs SERIAL (no parallelSafe metadata).
- At most2runs per durable objective+owner across source changes, turns and
  cooldowns; at most one repair. No automatic OOM relaunch or budget reset.
- Reserve12s inside the30s admission lease for verified teardown: initial guest
  wall is at most about18s including setup/RPC. No retries or automatic repairs.
- Postgres advisory-lock admission: one slot/store and bounded global runners,
  all workers share a30s cooldown even after finish. No renewal/resurrection.
- Nonce/execution/strict frame keys/monotonic sequence/size/pending-call fences
  are checked outside guest. Any denial revokes the lease and stops the run.
- Supervisor checks actual image/runsc/seccomp/cgroups before `ready`, then
  watchdog kills whole cgroup. Host must NEVER SIGKILL that supervisor during
  cleanup. Successful delivery awaits supervisor exit0; timeout/late RPC cannot
  publish a result. Orphan/daemon failure monitoring is a mandatory Linux gate.

## Verification / rollout

Run exact modified specs one process at a time, bounded heap; see
`buildcheck-dev`. Python supervisor tests mock subprocesses only. Do not execute
guest adversarial programs on the dev Mac. Linux QA must independently test
egress/imports/fs/env/FFI/workers, memory/CPU/stdout/PIDs, cancellation/late RPC,
100 alternating three-tenant executions, dead capsules and supervisor failures.
Review report must match final runtime/policy/seccomp/runsc/supervisor digests.
An env boolean or synthetic negative test is not security certification.

Use the existing general Vex/Vexi control to stop operation; preserve evidence.
canary, rounds/cost/latency benefits require authorized real measurements. No
infrastructure provisioning or paid service choice is implicit in this skill.

## Source of truth

- `apps/backend/src/ai-engine/sandbox/` — broker, policy, client, host capability, audit.
- `apps/backend/src/ai-engine/tools/domains/code-execution.tools.ts` — optional tool.
- `infra/agent-sandbox/README.md` — deployment contract and unexecuted Linux gates.
- `docs/agentic-sandbox-E.md` — phase boundaries and verification status.
- Related: `vendix-agent-durable-tasks`, `vendix-ai-agent-tools`,
  `vendix-multi-tenant-context`, `vendix-prisma-migrations`, `buildcheck-dev`.

## Standard autonomy operation

Autonomy is always active in code; stop Vex/Vexi through its existing general
control, not environment switches. Sandbox availability requires the actual isolated
runtime/supervisor/configuration and source encryption key. Missing dependencies
yield an unavailable recoverable result; other tools remain usable. Recipe mining
is active independently of the signing key; publication without
`AI_RECIPE_REVIEW_KEY` is a safe no-op. Bootstrap automatically synchronizes
the tool/process catalog; missing embeddings degrade to authorized lexical search.
