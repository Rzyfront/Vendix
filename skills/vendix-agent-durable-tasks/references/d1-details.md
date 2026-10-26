# D1 durable objectives — facts, evidence, budgets and surfaces (detail)

Design notes: `docs/agentic-durable-objectives-D1.md`.

## Facts and evidence

Persist full validated results BEFORE model/trace/transcript compaction. Store
call/tool/version/args hash, receipt, resource IDs, provenance, paging, freshness
and data together. Never extract IDs from prose. Small facts enter a bounded
JSON context; omitted whole records and cursors are explicit. Artifacts cap at
2 MB UTF-8; oversize requires a bounded upstream query, not string slicing.
Credentials, signed URLs, audio and private reasoning are scrubbed; S3 keys stay.

Artifact GET is a historical snapshot, NOT a live read of stock, price, balance
or fiscal state. `artifact:true`/`reusable_for_write:false` cannot verify a write.
Unversioned/expired/volatile facts require fresh reads before proposing/applying.
`ok`, `applied` and model deliverable text never imply `completed_verified`.
D1 supplies persistence and narrow receipt recovery, not D2's domain verifier or
scheduler. Unknown effects without a domain reconciliation contract must stop.

## Budgets and surfaces

The loop's existing turn limits stay unchanged. Session counters survive
`plan_continue`: provider/SDK attempts (including vision sub-agents through
Engine), tokens/cost, tools, active runtime, routing expansions and corrections.
Human approval wait is not active runtime. Missing provider usage/pricing means
unknown cost, never zero measured cost. Do not change retries while metering.

Sync and SSE share the durable builder/hook/context; workers share the session
without Vex-only hooks. Vexi must not receive Vex block sinks/approval hooks.
Progress/result/resume/reject endpoints exist under BOTH `/store/vexi` and
`/store/vex`, each with its OWN switch/guards. GET and resume do not infer or
spend. Awaiting approval cannot resume: explicitly approve or reject first.
Rejection is server-side CAS before hiding the card; a failed request keeps it.

