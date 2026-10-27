# Domain scope (guard + bridge) and native Anthropic tool search

## Domain scope shared by guard and bridge

- ONE pure rule, `common/guards/domain-scope.rule.ts` → `domainScopeDecision(principal,
  path)`, with no Nest or I/O. The global `DomainScopeGuard` (APP_GUARD after
  JwtAuthGuard) evaluates `@Public`, `@AllowCrossDomain`, OPTIONS and missing user,
  then delegates the matrix (super admin, VENDIX_ADMIN `/api/superadmin/`, store vs
  organization markers, missing `app_type`, STORE_DELIVERY only `/store/carrier/`,
  customer bell carve-out) to the rule. Never copy the matrix into another surface.
- The agent API bridge reads the SAME rule through `callerDomainScope(path)`
  (`ai-engine/tools/bridge/internal-http.ts`, prefixes `/api/`):
  `ApiCatalogService.listFor` does not OFFER out-of-domain routes in
  `list_endpoints`/`list_capabilities`, and `call_endpoint`/`write_endpoint` do not
  DISPATCH them (`API_BRIDGE_DOMAIN_SCOPE`, `recoverable_error` with a `next_step`
  toward the `store/…` equivalent — never `blocked`, never the permission notice).
  E2E g09: a STORE_ADMIN was offered `organization/payroll/settings`.
- The bridge prefilter is informative, not the security boundary: the internal hop
  forwards the user's JWT and the real guard re-evaluates the route. Without
  `app_type` in context (tests, internal processes) the bridge does not filter.
  `ignoreDomainScope` exists only for release-wide playbook validation.
- A carve-out or new `app_type` goes in the rule (+ `domain-scope.rule.spec.ts`), so
  guard and agent change together.

## Native Anthropic tool search (F7)

- Only `anthropic_compatible` configs. A background capability probe (positive
  `tool_reference` call AND negative check that a deferred tool is not callable
  without reference, fail-closed) enables native mode; the deferred queue is exactly
  `routingAuthority`, every `tool_use` re-passes the loop's authority, and
  `tool_reference` only names tools sent in that request. OpenAI-compatible
  providers ignore `deferredTools` (payload identical).
- **Fallback to our own loading:** a 4xx (400/404/413/422) on a native request
  disables native mode for that `baseUrl|model|credential fingerprint` (long TTL),
  logs bounded failure facts and retries ONCE without deferred tools. Native mode
  must never turn into a 400 on every turn. The probe runs detached from the turn
  (its usage never lands in the caller's meter). Paired benchmark still pending.

