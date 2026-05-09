# scripts/

Repository-level utility scripts (CI defenses, audits, codegen helpers).

## check-domain-isolation.sh

CI defense for the operating_scope contract (Rule Zero).

**Fails** if it finds cross-domain URL literals in the frontend:

- `/store/*` URLs inside `apps/frontend/src/app/private/modules/organization/`
- `/organization/*` URLs inside `apps/frontend/src/app/private/modules/store/`

Rationale:

- ORG_ADMIN tokens must never call `/store/*` endpoints.
- STORE_ADMIN tokens must never call `/organization/*` endpoints.
- The backend `DomainScopeGuard` returns 403 on cross-domain calls, so violations
  surface as production bugs after deploy.

### Run locally

```bash
bash scripts/check-domain-isolation.sh
```

### Allow-listing exceptions

Append `// domain-isolation-ok: <reason>` to the offending line.

### Wire into CI

```yaml
- name: Domain isolation check
  run: bash scripts/check-domain-isolation.sh
```

## zoneless-audit.sh / zoneless-audit-signal-usage.sh / audit-zoneless.sh

Zoneless + Signals compliance audits for the Angular frontend. See the
`vendix-zoneless-signals` skill for usage.
