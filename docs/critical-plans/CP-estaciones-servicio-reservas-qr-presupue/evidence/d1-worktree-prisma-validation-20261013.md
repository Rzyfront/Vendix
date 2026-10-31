# D.1 â Worktree Prisma validation

- **Worktree:** `/tmp/Vendix-service-stations-qr` (`feature/service-stations-reservas-qr-budget`)
- **Command:** `npx prisma validate --schema apps/backend/prisma/schema.prisma`
- **Result:** PASS. Prisma loaded the worktree schema and reported it valid, including the `checkout_reconciliation_required` notification enum value.
- **Limit:** This validates schema syntax and Prisma relations only. It does not execute SQL migrations against PostgreSQL or verify exclusion constraints and tenant invariants at runtime.