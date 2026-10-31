# D.1 — Spec de reconciliación de correo

- **Worktree:** `/tmp/Vendix-service-stations-qr` (`feature/service-stations-reservas-qr-budget`)
- **Command:** `NODE_OPTIONS="--max-old-space-size=4096" npm run test -w apps/backend -- src/jobs/service-session-email-reconciliation.job.spec.ts`
- **Result:** PASS (41.434 s). 3 passed, 3 total.
- **Coverage:**
  - `marks a stale sending delivery failed with CAS and alerts the store without recipient or token`: PASS
  - `does not alert when another worker has already changed the delivery`: PASS
  - `handles an empty scan without writes`: PASS
- **Cleanup:** Exit code 0, no leaked handles, clean memory release.