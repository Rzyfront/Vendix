# D2 robust execution, verification and scheduling (detail)

Design notes: `docs/agentic-execution-D2.md`.



- Persist 3–7-step blocks with explicit input/output, candidate tools, individual
  approval, verifier and DAG edges. A single read keeps its fast path. Technical
  insertion remaps dependency identities, never silently rebinds numeric orders.
  Recovery cannot change the economic goal or invent missing business data.
- `AgentVerifierService.verifyMany` rereads allowlisted release workflows through
  the same registry/current principal/guard. Model `verified:true`, prose and
  artifact IDs alone are insufficient. Fixed contract hashes include economic
  inputs and step IDs. Only a short-lived, single-use process-local capability
  can call repository `commitVerified`; bind owner/objective/version/generation,
  reject pending/unknown effects and recheck owned receipts in the transaction.
- Applied != verified. C predicates are partial contracts: D2 explicitly reports
  gaps for inventory movement/location/variant causality, refund identity,
  sale payment/stock close-out and preparation-only workflows. Never publish a
  universal completion claim or repeat an uncertain write to produce evidence.
- Recovery checkpoints use existing D1 tool-result storage, server-owned name
  `agent_recovery_checkpoint`, CAS version ordering and hash-only bounded state.
  They are excluded from public result pages/context. Keep at most 64 failure
  fingerprints; corrupt state fails closed. `undefined` optional hashes must not
  become invalid `null` after artifact sanitization. Actual search dispatch is
  charged once, separately from a policy reservation.
- Defaults: 2 technical replans/2 catalog expansions per objective, configurable
  via `AI_AGENT_MAX_TECHNICAL_REPLANS`/`AI_AGENT_MAX_CATALOG_EXPANSIONS` (0–8).
  Schema correction is one per tool; transient read retries are bounded with
  jitter/deadline. Permission/plan has no retry; unknown effects require a real
  reconciliation contract. A generic failure is not an automatic ask_user.
- Propagate `AgentDeadline` signal/epoch deadline to SDK/HTTP/cooperative tools.
  Hard wall (also capped by lease/TTL) never pauses; active time excludes UI wait.
  Reserve checkpoint/closure time. Every inner async continuation must fence
  BEFORE checkpoint: an outer Promise race alone does not cancel late code.
  Approved apply uses a deadline inside its live lease and accounts active time.
- `ToolSchedulerService` accepts only explicitly audited
  `scheduling.parallelSafe` + `idempotent_read` tools, resource-key templates,
  dependency metadata and max-result bytes. Today only `get_product` opts in.
  Planning/UI/blocks/proposals/writes/dependent calls stay serial. Validate the
  ENTIRE batch before any dispatch; attribute rejection only to its culprit. An
  invalid-argument call is answered on its own (INVALID_ARGS, after its valid
  siblings); an authorized-but-unoffered call is staged for the next inference.
- Default concurrency: 3/objective, heavy1/store, global6/worker, further bounded
  by `DATABASE_POOL_MAX`; lower via `AI_PARALLEL_READS_OBJECTIVE_CAP` and
  `AI_PARALLEL_READS_GLOBAL_CAP`. Clone explicit ALS per call. Stable provider
  result order and completion-time serial checkpoints preserve siblings.
  Abort settles a hung read's wait but retains its permit until actual work ends;
  `onLateResult` is stale audit only, never an advanced session or successful quota.
- Run D2 specs individually with the same bounded D1 Jest config. Fixtures prove
  contracts/transport, not real DB locks, DI/bootstrap, model latency or canary.

