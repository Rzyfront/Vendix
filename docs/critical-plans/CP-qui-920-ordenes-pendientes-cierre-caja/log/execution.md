# Execution Log

| Date | Who | Step | Event | Evidence |
|------|-----|------|-------|----------|
| 2026-10-06 | Codex | A.1 | Applied plan recommendations: eligible-only atomic finish, COD balance separate, reasoned override, no inferred legacy origin | `evidence/business-analysis.md` |
| 2026-10-06 | Codex | A.2 | Started additive attribution/tracking work; legacy rows remain null and old sessions retain explicit untracked mode | `adr/ADR-01-atribucion-inmutable-de-orden-a-sesion-o.md`; `registry/db.md` |
| 2026-10-06 | Codex | A.2 | Closed false legacy attribution assumption; opened blocker F-007 because sale movements may belong to collection session B | `findings/F-007.md`; `registry/db.md` |
| 2026-10-06 | Codex | A.2/B.4 | Found post-commit cash movement writers; filed blocker F-006 and expanded inventory before implementation | `findings/F-006.md`; `inventory/files.md` |
| 2026-10-08 | Codex | B.1/B.2/B.3/B.4 | Implemented pending-order listing, eligible preview, atomic finish, audited close snapshot, and payment/movement close locks; ran focused backend suites | `evidence/local-verification-2026-10-08.md` |
| 2026-10-08 | Codex | C.1/C.2 | Implemented web/mobile close review flows; mobile TypeScript passed; full browser/device verification remains open | `evidence/local-verification-2026-10-08.md` |
| 2026-10-08 | Codex | D.1 | Local unit verification recorded; controller socket test, isolated migration/concurrency matrix, browser/device checks remain unverified in this environment | `evidence/local-verification-2026-10-08.md` |
| 2026-10-08 | Codex | B.4/D.1 | Closed F-007 by keeping legacy origins unassigned; added durable deferred-sale guard/recovery for F-006 and localized close-flow error toasts in Spanish; PostgreSQL race and UI runtime checks remain open | `evidence/local-verification-2026-10-08.md` |
