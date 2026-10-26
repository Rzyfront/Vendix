# Review checklists and recurring issues

## Regression checklist (always)

- [ ] Is the change additive (new behavior without touching existing)?
- [ ] Are methods other modules call modified, or their signatures changed?
- [ ] Are endpoint responses / SQL feeding reports or other modules altered?
- [ ] Are props, outputs, events or keys of shared objects removed or renamed?
- [ ] Is the default behavior of something already in production changed?
- [ ] Is there protection (feature flag, fallback, backwards compat) when modifying existing behavior?

## Frontend (Angular)

- [ ] `[innerHTML]` sanitized (DomSanitizer)?
- [ ] HTTP through the project's services/interceptors, not raw `fetch`/`HttpClient` bypassing auth?
- [ ] Subscriptions cleaned (`takeUntilDestroyed` / `DestroyRef`) or `async` pipe?
- [ ] Async errors handled? No leftover `console.log`, hardcoded URLs/IDs/magic strings?
- [ ] Routing/store/package.json changes: impact on other modules? New deps reliable, bundle size?
- [ ] Signals pattern respected (`vendix-zoneless-signals`); methods called repeatedly in templates → `computed`.
- [ ] NgRx: no double fetch (effect already fetches and the component fetches again).

## Backend (NestJS)

- [ ] Raw SQL without Prisma → injection risk?
- [ ] Input validated by DTO + class-validator?
- [ ] Endpoints without guards (`@Public()` misuse, missing `@UseGuards`)?
- [ ] Hardcoded secrets? Errors exposing stack traces or paths?
- [ ] Missing error handling around DB/filesystem operations? File uploads without type/size limits?
- [ ] Prisma migrations safe and reversible (`vendix-prisma-migrations`)?
- [ ] N+1 queries in loops (use `include`/`select`)?
- [ ] Correct scoped Prisma service for the domain; `withoutScope()` truly needed (`vendix-prisma-scopes`)?

## General

- [ ] Title matches what changes; no mixed features; no "sneaky" config/default changes buried in the diff.
- [ ] `||` vs `??` for falsy values (`0`, `''`, `false`).
- [ ] `error.message` (not `.msg`) on native Errors.
- [ ] Logic copied in 3+ places → helper.

## Recurring issues

| Issue | Fix |
| --- | --- |
| Modifying an existing flow (signature, response shape, report SQL, default, shared keys) | Make it additive: optional params with defaults, feature flag, temporary backwards compat |
| `value \|\| 0` drops legit `0`/`''`/`false` | `value ?? 0` |
| Wrong Prisma scope (`GlobalPrismaService` in a store domain, needless `withoutScope()`) | Use the domain's scoped service |
| Undocumented sneaky change | Separate commit/PR or document it in the description |
| Hypothesis reported as finding ("could break", "verify with curl") | Run the check; if unverifiable, move it to Open questions (zero weight) and re-score |
