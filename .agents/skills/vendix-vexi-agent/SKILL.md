---
name: vendix-vexi-agent
description: >
  The four patterns that make Vexi an integral agent: capabilities derived from the
  permission catalog, AI applications invoked as vision sub-agents with a feedback
  loop, a closed loop over the UI (the turn blocks on the browser's real result), and
  attachments persisted with the rigor of the module that consumes them. Trigger: When
  widening Vexi's operational reach, adding a UI host, wiring a document flow through
  the chat, or debugging a Vexi turn that narrates something it never verified.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Widening Vexi's reach to a new module or domain"
    - "Registering a component as a VexiUiHost"
    - "Adding a document or photo flow that Vexi processes from the chat"
    - "Invoking an ai_engine_applications vision app as a sub-agent from the agent loop"
    - "Debugging a Vexi answer that claims a UI change it never confirmed"
    - "Writing through write_endpoint to a multipart route (FileInterceptor)"
    - "Linking a Vexi attachment to the record it originated"
    - "Adding a background task on the ai-agent queue"
    - "Auditing what Vexi changed in a store"
---

# Vendix Vexi Agent

## Source of Truth

- `apps/backend/src/ai-engine/ai-agent.service.ts` — the loop; where a clientSide tool blocks on the browser.
- `apps/backend/src/ai-engine/tools/ai-tool-registry.ts` — the single execution choke point.
- `apps/backend/src/ai-engine/tools/bridge/api-catalog.service.ts` — boot-time route discovery (~2003 routes), multipart detection, field types.
- `apps/backend/src/ai-engine/tools/bridge/api-bridge.tools.ts` — `call_endpoint` / `write_endpoint`; real `from → to` diff.
- `apps/backend/src/ai-engine/tools/bridge/internal-http.ts` — the shared internal transport (`internalAuthHeaders`, `buildMultipartBody`).
- `apps/backend/src/domains/store/vexi/vexi-confirmation.service.ts` — single-use propose→confirm→apply token.
- `apps/backend/src/domains/store/vexi/vexi-ui-channel.service.ts` — the UI return path (Redis GETDEL).
- `apps/backend/src/domains/store/vexi/vexi-attachments.service.ts` — S3 + `ai_attachments` + `linkTo`.
- `apps/backend/src/domains/store/vexi/vexi-activity.service.ts` — the audit trail, reconstructed from the trace.
- `apps/frontend/src/app/core/services/vexi-ui-host.registry.ts` — the module-side contract.
- `apps/frontend/src/app/core/services/vexi-ui-command.service.ts` — the `ui_*` commands, resolved against the registered host.

## Pattern 1 — Capabilities are derived, never curated

Vexi's reach is the **caller's permission set**, resolved at request time. There is no
hand-written list of what it may do.

- `ApiCatalogService` discovers every route at boot with `DiscoveryService` + `Reflector`,
  reading `@Permissions`, `@ApiOperation.summary`, the DTO's class-validator metadata and
  whether the handler carries a `FileInterceptor`.
- `list_endpoints` / `list_capabilities` filter that catalog by the caller's real permissions.
- A permission with no catalogued route is reported as a **gap**, not silenced.

**Anti-pattern:** a per-domain family of hand-written write tools. It was measured at
~400 tools, does not fit a turn's context window, and every new endpoint in the product
would need a new tool. The seven legacy write tools survive because they encode business
rules the catalog cannot see — they are not a whitelist, and the docblock in
`writes.tools.ts` says so explicitly.

**Anti-pattern:** publishing field names without types. The global `ValidationPipe` runs
with `forbidNonWhitelisted: true`, so a guessed field costs a rejection *after* the person
already approved. Publish `{ name, type, required, enum_values }`.

## Pattern 2 — Vision runs in its own model, and the loop feeds back

The orchestrating LLM **never receives the binary**. It receives an `attachment_id`.

```
user adjunta factura
  → ai_extract_document(attachment_id, document_kind)   ← corre en la app de visión
  → validate_extraction(json, domain)                  ← cruza contra datos reales
  → si no cuadra: ai_extract_document(..., retry_hint)  ← máx. 2 reintentos
  → propose → confirmation card → apply
```

Why the split, concretely: the 8 vision applications in `ai_engine_applications` carry
tuned `system_prompt`s and their own MiniMax-VL config; dragging the document through the
conversation would re-send it on every later turn; and the product must not be tied to
providers that happen to have vision.

- Every sub-agent invocation goes through `AIEngineService.run()`. That is the **only**
  metered path — subscription gate, rate limit, and a row in `ai_engine_logs`. Never
  `runByApplicationType`.
- An extraction is never proposed to a person before being crossed against real records.
  Not-found stays not-found: creating the missing supplier silently is the decision the
  business reserves for a human.

## Pattern 3 — The UI loop is closed, or Vexi says it doesn't know

A `clientSide` tool suspends the turn on `(stream_id, tool_call_id)` and the browser POSTs
the real result back to `/store/vexi/ui-result`.

```ts
const uiResult = params.stream_id
  ? await this.uiChannel.awaitResult(params.stream_id, toolCall.id)
  : null;
const resultPayload = uiResult ?? JSON.stringify({
  dispatched: true, command: toolName, result_unknown: true,
});
```

The fallback says `result_unknown: true`. It does **not** say `ok`. The defect this
replaced (`dispatched_to_client` + carry on) made the model narrate in past tense actions
whose outcome it had never seen.

- Redis **GETDEL polling**, not pub/sub: `SUBSCRIBE` needs a `duplicate()` connection per
  waiting turn, and a turn is 25 s.
- `needs_user_input` is a first-class result, not a failure. A variant choice, a weight, a
  confirmation dialog — the product leaves those to a person, and the loop reports them.

### Registering a host

A module enters Vexi's reach by **registering itself**:

```ts
private readonly vexiHostAdapter: VexiUiHost = {
  vexiModuleKey: 'products',
  readScreen: () => ({ module_key: 'products', title: 'Productos', visible_count: … }),
  listActions: () => [{ id: 'nuevo_producto', label: '…' }],
  runAction: async (id) => { … },
  setFilter: async (values) => { this.onSearch(values['search'] as string); … },
  refresh: () => { this.loadProducts(); return { status: 'ok', message: '…' }; },
};

constructor() {
  this.vexiHosts.register(this.vexiHostAdapter);
  this.destroyRef.onDestroy(() => this.vexiHosts.unregister(this.vexiHostAdapter));
}
```

Rules that are not stylistic:

1. **Register an adapter object, not `implements VexiUiHost` on the class**, whenever the
   component already owns a method named `refresh` or `openModal` — `CustomersComponent`
   has `openModal(customer?)`, which is a different contract. Keep the object's identity
   stable: `unregister` compares by identity so an A→A navigation cannot drop the handle
   to the screen actually on display.
2. **Delegate to the component's own handlers**, never to its services. `onSearch` resets
   the page; writing `searchTerm` and refetching leaves the person on page 4 of a
   one-page result. The POS taught this concretely: writing the cart service directly
   produced carts the checkout rejected.
3. **Do not declare what you do not implement.** Every method is optional. `OrdersComponent`
   omits `setFilter` because its filters live in the child list; declaring it would make
   Vexi say "ya filtré" over an untouched table.
4. `ui_refresh` cascades: the domain's NgRx action **gated on the route matching** → the
   host's `refresh()` → an honest "no puedo refrescar". The gate matters because feature
   stores are lazily loaded and dispatching from elsewhere is a silent no-op.

## Pattern 4 — The document is owned by the record, not by the agent

An attachment is staged in `ai_attachments` (S3 key, never a signed URL) and then handed
to **the domain's own endpoint with the domain's own contract**.

- The catalog flags multipart routes; `write_endpoint` reads the buffer from S3 and builds
  the `FormData` with `buildMultipartBody` (no explicit `Content-Type` — undici sets the
  boundary).
- After `applied: true`, `attachments.linkTo(id, domain, extractCreatedId(body))` stamps
  the row. That is what makes the invoice visible **from the purchase order**, exactly as
  the expense module shows the receipt it was registered with.

**Anti-pattern:** a parallel attachment mechanism inside the agent. A domain with no file
contract (promociones, mesas, recetas) is a pending design decision **for that domain** —
Vexi does not improvise one.

## Approval and background work

- **One level of approval for everything.** No auto-execution, no tiered risk model. Every
  write goes through the same confirmation card with a real `from → to` read from the
  system.
- `IRREVERSIBLE_DOMAINS` adds one sentence of consequence before the ask (fiscal issuance
  and voiding, payroll settlement, cash close, payment application, archiving).
- A background task on the `ai-agent` queue **has no bearer token**. `write_endpoint`
  therefore refuses, and the rule "nothing applies without approval" holds by construction
  rather than by a special case. Tasks review, validate and prepare.
- A bulk file is validated row by row against the real template (`bulk_prepare`) and
  reported before anything is applied. Never state how many rows loaded before applying.

## Verification

| What | How |
|------|-----|
| Route catalog + multipart | `docker logs vendix_backend \| grep 'api-bridge'` and `list_endpoints` showing `necesita_documento` |
| Metering split | `SELECT app_key, count(*) FROM ai_engine_logs WHERE created_at > now() - interval '1 hour' GROUP BY 1` — separate rows for orchestrator and vision app |
| Document ↔ record | `SELECT original_name, linked_entity_type, linked_entity_id FROM ai_attachments ORDER BY id DESC LIMIT 5` |
| UI honesty | Playwright MCP on the POS with a variant product: the trace must show `needs_user_input` and the answer must ask |
| Audit | `curl -H "Authorization: Bearer $TOK" https://vendix.com/api/store/vexi/activity` |
| Zoneless compliance of new hosts | `./scripts/zoneless-audit.sh` |
| Compilation | CI (`Backend Build`, `Frontend Build (prod)`) — the dev machine does not build |

## Related Skills

`vendix-ai-agent-tools` (the propose→confirm→execute circuit), `vendix-ai-chat` (the dock
and panel), `vendix-ai-platform-core` (`AIEngineService.run`), `vendix-ai-streaming` (SSE
frames), `vendix-permissions` (the 549-permission catalog), `vendix-s3-storage`,
`vendix-ai-queue`, `vendix-zoneless-signals` (mandatory for any host component).
