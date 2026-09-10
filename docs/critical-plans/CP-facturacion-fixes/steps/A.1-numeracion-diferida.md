---
id: A.1
title: "numeracion-diferida"
phase: A
status: done
owner: none
updated: 2026-09-10
contracts: [DB-01, DB-02, ERR-01]
adrs: [ADR-01]
skills: [vendix-prisma-migrations, vendix-error-handling, vendix-prisma-scopes, how-to-test]
---
# A.1 — numeracion-diferida

- **Skills:** vendix-prisma-migrations, vendix-error-handling, vendix-prisma-scopes, how-to-test
- **Resources:** `invoice-number-generator.ts`, `invoicing.service.ts:createFromOrder`, `pos-fiscal-emission.service.ts:emitForOrder`, `invoice-flow.service.ts:send`
- **Business decision:** ADR-01: consecutive assigned at validate/send, never at creation; numbered drafts grandfathered.
- **Why:** Unpaid/abandoned web orders burn finite DIAN range numbers today (F-001); numbering at emit removes the leak at the root.
- **Output:** Drafts created numberless; `send` assigns via generator under lock; re-emit keeps its number; pre-existing numbered drafts untouched.
- **Contracts touched:** DB-01 (invoices row without number), DB-02 (resolution sequence), ERR-01 (numbering failure code).
- **Data impact:** existing numbered drafts unchanged; new drafts carry null number until send; no backfill, no destructive SQL.
- **Blast radius:** every FE sender (web, POS auto-emit, manual send, data-requests sendBestEffort); a bug here mis-numbers legal documents.
- **Rollback:** feature-flag the numbering point (create vs send); forward-fix only after first emit — see ADR-01.
- **Verification:**
  - `rg -n "generateNextNumber" apps/backend/src/domains/store/invoicing/invoicing.service.ts` shows calls only on send path
  - backend jest: `npx jest invoice-flow --silent` green; abandoned checkout leaves no consumed number (probe script in evidence/)
- **Acceptance checklist:**
  - [x] F-001 — quema-consecutivos-en-ordenes-impagas (major)
  - [ ] draft without number creatable; send assigns exactly one consecutive
  - [ ] re-emit of rejected keeps the same number
- **Status:** done
