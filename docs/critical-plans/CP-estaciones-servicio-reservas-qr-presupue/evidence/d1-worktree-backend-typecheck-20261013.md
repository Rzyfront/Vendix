# D.1 â Backend typecheck

- **Worktree:** `/tmp/Vendix-service-stations-qr` (`feature/service-stations-reservas-qr-budget`)
- **Command:** `npm run buildcheck:be`
- **Result:** failed with V8 heap OOM at the configured 3 GB cap after 112 s. No TypeScript diagnostics were emitted before exhaustion.
- **Cleanup:** guarded runner exited with code 1 and terminated its process group; no compiler process from this run remains.
- **Limit:** backend compilation is unverified; no runtime/API/database test was performed.