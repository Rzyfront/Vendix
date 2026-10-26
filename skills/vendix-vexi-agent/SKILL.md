---
name: vendix-vexi-agent
description: >
  Patterns making Vexi an integral agent: permission-derived capabilities, vision sub-agents, closed UI loop (VexiUiHost), persisted attachments. Trigger: widening Vexi's reach, adding a UI host, chat document flows, Vexi claiming unverified changes.
license: MIT
metadata:
  author: rzyfront
  version: "1.1"
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

- `apps/backend/src/ai-engine/ai-agent.service.ts` — loop; clientSide tools block on the browser.
- `apps/backend/src/ai-engine/tools/ai-tool-registry.ts` — single execution choke point.
- `apps/backend/src/ai-engine/tools/bridge/` — `api-catalog.service.ts` (boot-time route discovery, multipart detection, field types), `api-bridge.tools.ts` (`call_endpoint` / `write_endpoint`, real `from → to` diff), `internal-http.ts` (`internalAuthHeaders`, `buildMultipartBody`).
- `apps/backend/src/domains/store/vexi/` — `vexi-confirmation.service.ts` (single-use token), `vexi-ui-channel.service.ts` (UI return path), `vexi-attachments.service.ts` (S3 + `ai_attachments` + `linkTo`), `vexi-activity.service.ts` (audit from the trace).
- `apps/frontend/src/app/core/services/vexi-ui-host.registry.ts`, `vexi-ui-command.service.ts` (`ui_*` commands against the registered host).

## 1. Capabilities are derived, never curated

- `ApiCatalogService` discovers every route at boot (`DiscoveryService` + `Reflector`: `@Permissions`, `@ApiOperation.summary`, DTO class-validator metadata, `FileInterceptor`). `list_endpoints` / `list_capabilities` filter by the caller's real permissions; a permission without a route is reported as a gap.
- Anti-pattern: per-domain hand-written write tools (~400 tools, don't fit context). The six legacy write tools in `writes.tools.ts` survive only because they encode business rules the catalog cannot see; they are not a whitelist.
- Publish fields as `{ name, type, required, enum_values }`: the global `ValidationPipe` uses `forbidNonWhitelisted`, so a guessed field fails after the person approved.

## 2. Vision runs in its own model, with feedback

The orchestrator never receives the binary, only an `attachment_id`: `ai_extract_document(attachment_id, document_kind)` (vision app) → `validate_extraction(json, domain)` against real records → retry with `retry_hint` (max 2) → propose → card → apply.

- Every sub-agent call goes through `AIEngineService.run()` (the only metered path: gate, rate limit, `ai_engine_logs`), never `runByApplicationType`.
- Never propose an extraction before crossing it with real records. Not-found stays not-found: creating a missing supplier is a human decision.

## 3. The UI loop is closed, or Vexi says it doesn't know

- A `clientSide` tool suspends the turn on `(stream_id, tool_call_id)`; the browser POSTs the real result to `/store/vexi/ui-result`. Redis GETDEL polling (not pub/sub), 25 s wait, paused from the agent's active time. Missing/late result → `{dispatched: true, result_unknown: true}`, never `ok`.
- `needs_user_input` (variant choice, weight, confirmation dialog) is a first-class result, not a failure.
- A module enters Vexi's reach by registering a `VexiUiHost` in its constructor and unregistering on destroy (example: `references/ui-host-example.md`). Rules:
  1. Register an adapter object, not `implements VexiUiHost`, when the component already has `refresh`/`openModal` with another contract. Keep its identity stable (`unregister` compares by identity).
  2. Delegate to the component's own handlers (`onSearch` resets paging), never to its services.
  3. Do not declare what you do not implement (`OrdersComponent` omits `setFilter`).
  4. `ui_refresh` cascades: domain NgRx action from `VEXI_REFRESH_ACTIONS` gated on the route matching → host `refresh()` → honest "no puedo refrescar". POS actions go through `VexiPosBridgeService` (registered by the POS component, identity-checked unregister).

## 4. The document belongs to the record

Attachments are staged in `ai_attachments` (S3 key, never signed URL) and handed to the domain's own endpoint and contract. `write_endpoint` reads the buffer from S3 and builds `FormData` with `buildMultipartBody` (no explicit `Content-Type`). After `applied: true`, `attachments.linkTo(id, domain, extractCreatedId(body))` stamps the row so the record shows it. Never a parallel attachment mechanism; a domain without a file contract is a pending decision for that domain.

## Approval

- One approval level for every write: the same card with a real `from → to`. No auto-execution, no tiered risk.
- `IRREVERSIBLE_DOMAINS` adds one sentence of consequence before asking (fiscal issuance/voiding, payroll settlement, cash close, payment application, archiving).
- Background tasks on `ai-agent` have no bearer, so they never apply (`vendix-ai-queue`).
- Bulk files are validated row by row against the real template (`bulk_prepare`) before anything applies; never state rows loaded before applying.

## Verification

| What | How |
|------|-----|
| Route catalog + multipart | `docker logs vendix_backend \| grep 'api-bridge'`; `list_endpoints` shows `necesita_documento` |
| Metering split | `SELECT app_key, count(*) FROM ai_engine_logs WHERE created_at > now() - interval '1 hour' GROUP BY 1` |
| Document ↔ record | `SELECT original_name, linked_entity_type, linked_entity_id FROM ai_attachments ORDER BY id DESC LIMIT 5` |
| UI honesty | Playwright MCP on POS with a variant product: trace shows `needs_user_input`, answer asks |
| Audit | `GET /api/store/vexi/activity` with a seed-user bearer |
| New hosts | `./scripts/zoneless-audit.sh`; compilation in CI |

## Related Skills

`vendix-ai-agent-tools`, `vendix-ai-chat`, `vendix-ai-platform-core`, `vendix-ai-streaming`, `vendix-permissions`, `vendix-s3-storage`, `vendix-ai-queue`, `vendix-zoneless-signals`.
