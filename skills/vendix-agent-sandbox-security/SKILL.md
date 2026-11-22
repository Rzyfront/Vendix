---
name: vendix-agent-sandbox-security
description: >
  Optional read-only sandboxes for Vex/Vexi: Deno run_readonly_script and the
  Code Mode Lambda (run_code), immutable host authority, encrypted audit and
  isolation release gates. Trigger: Changing run_readonly_script, run_code,
  their broker/bridge, policy, allowlist or runner.
license: MIT
metadata:
  author: rzyfront
  version: "1.2"
  scope: [root]
  auto_invoke:
    - "Changing run_readonly_script or the sandbox RPC broker"
    - "Changing agent sandbox isolation, limits or deployment adapter"
    - "Changing run_code, the Code Mode bridge, its allowlist or infra/agent-sandbox/js"
---

# Agent sandbox security

## Non-negotiable boundary

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

## Code Mode (F10, `run_code`, channel A)

- Executor: Lambda `vendix-agent-codemode` (`infra/agent-sandbox/js/`): QuickJS
  WASM in a fresh child process per round (`env: {}`, /tmp wiped), `TenancyConfig`
  `PER_TENANT`, VPC without egress, role ENI-only. Globals: `tools`, `console`,
  `vex.block`; `Date` frozen, `Math.random` seeded; no require/process/fetch/timers.
- The Lambda NEVER executes a tool. It returns `pending` calls; the host runs them
  with the session's authority and keeps the journal ONLY server-side. The
  response has no journal; unknown keys, wrong nonce/execution_id/round or a
  non-contiguous `seq` are `CODEMODE_PROTOCOL`. Contract and hash vectors:
  `sandbox/interfaces/codemode-protocol.interface.ts`, mirrored in the Lambda
  (`template.test.cjs` guards drift). `TenantId` = HMAC of the store, never its id.
- Per call: manifest ∩ generated allowlist ∩ the turn's authorized names ∩ live
  authority re-derived by `SandboxPolicyService.authorize` (Code Mode scope);
  plain-JSON args ≤ 16 KiB; `store_id`/`organization_id`/tenant keys rejected at
  any depth; schema validation; rows ≤ 5000; result to the model ≤ 8 KiB. A store
  change between rounds aborts with `CODEMODE_TENANT_CHANGED`.
- Allowlist lives in code: `sandbox/codemode-allowlist.generated.ts`, built by
  `scripts/generate-codemode-allowlist.ts` from `codemode-allowlist.derive.ts`
  (readOnly, not clientSide, no confirmation, not irreversible, a declared
  permission, not public, no `ui_*`, minus third parties: DIAN, payment gateways,
  AI models, shipping, geocoding and routing providers (`quote_shipping`, `list_shipping_config`, `get_route_map`), loopback HTTP reports, file artifacts). The
  snapshot spec fails on any drift; regenerate and review, never edit by hand.
- Limits `CODEMODE_LIMITS`: 6 rounds, 20 calls, 8 pending/round, 20 tools,
  2 s CPU/round, 30 s wall, 256 MB; ≤ 3 scripts per turn. Stage 1 is read-only:
  any write, irreversible or client tool in the manifest is rejected before invoking.
- Switches, all off by default: capability `vex.code_mode` (missing plan row = off)
  and `AI_CODEMODE_SANDBOX_ENABLED` + ARN + region + runtime digest equal to the
  certified digest. Without the T69 certification `available()` stays false and
  `run_code` is not even registered (catalog hash and knowledge index unchanged);
  when available it is offered only to the `vex` agent with the capability.
- Public args: `publicSandboxArgs('run_code')` keeps only `source_hash`, `tools`,
  `purpose` and `source_omitted`; the source never reaches the SSE `tool_call`
  frame, the transcript or generic tool logs (`sandbox-logging.spec.ts`).
- Audit: `ai_agent_script_runs` (`executor` lambda-js, rounds, Lambda request ids,
  tenant hash, cut reason, returned bytes; per-call rows/duration), one child span
  per call (`call_seq`, hashed tool). Source decrypts only for the owner within
  7 days; superadmin sees metadata only.

## Verification / rollout

Run exact modified specs one process at a time, bounded heap; see
`buildcheck-dev`. Python supervisor tests mock subprocesses only. Do not execute
guest adversarial programs on the dev Mac. Linux QA must independently test
egress/imports/fs/env/FFI/workers, memory/CPU/stdout/PIDs, cancellation/late RPC,
100 alternating three-tenant executions, dead capsules and supervisor failures.
Review report must match final runtime/policy/seccomp/runsc/supervisor digests.
An env boolean or synthetic negative test is not security certification.

Rollback: stop Vex/Vexi through its general control and preserve evidence. Canary,
rounds/cost/latency benefits require authorized real measurements. No
infrastructure provisioning or paid service choice is implicit in this skill.

## Source of truth

- `apps/backend/src/ai-engine/sandbox/` — broker, policy, client, host capability, audit.
- `apps/backend/src/ai-engine/tools/domains/code-execution.tools.ts` — optional tool.
- `infra/agent-sandbox/README.md` — deployment contract and unexecuted Linux gates.
- `infra/agent-sandbox/js/README.md` — Code Mode Lambda, IaC and the pending T69 certification.
- `apps/backend/src/ai-engine/sandbox/codemode-*.ts` — bridge, policy, allowlist, response validator.
- `docs/agentic-sandbox-E.md` — phase boundaries and verification status.
- Related: `vendix-agent-durable-tasks`, `vendix-ai-agent-tools`,
  `vendix-multi-tenant-context`, `vendix-prisma-migrations`, `buildcheck-dev`.
