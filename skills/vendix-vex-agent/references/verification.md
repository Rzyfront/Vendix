# Vex verification checklist


| What | How |
|------|-----|
| Agent row | `psql "$DATABASE_URL" -c "select key, app_key, max_iterations from ai_agents where key='vex'"` — 25 `ui_*` in `denied_tools` |
| Deny filter | `npm run test:path -w apps/backend -- src/ai-engine/ai-agent.service.spec.ts` — `ui_navigate` absent from vex catalog, present for vexi |
| Plan approval | `npm run test:path -w apps/backend -- src/domains/store/vex/services/plan-approval.service.spec.ts` — legacy token coverage plus the single-step loop policy; drifted args and `send_invoice_dian` reconfirm; token replay rejected |
| Irreversible coverage | `npm run test:path -w apps/backend -- src/ai-engine/tools/irreversible-coverage.spec.ts` — fails if a dangerous-domain write lacks `irreversible: true` (check by reverting `close_cash_session` locally) |
| Offered-catalog guard | `npm run test:path -w apps/backend -- src/ai-engine/ai-agent.service.spec.ts` — simulated `ui_navigate` call in a vex turn → `AI_AGENT_TOOL_NOT_ALLOWED`, 0 `executeTool`/client dispatches |
| Wiring | `npm run test:path -w apps/backend -- src/domains/store/ai-chat/ai-chat.plan.spec.ts` — vex turn receives `plan_approval` + `block_sink`, vexi receives neither; closing message persists `metadata.blocks/plan` |
| Blocks | `npm run test:path -w apps/backend -- src/domains/store/vex/services/vex-block.service.spec.ts` — schema validation, transform, cross-store 404 |
| Gating | cashier token → 403; owner with `vex.enabled=false` → disabled-agent error; owner with `true` → 200 |
| Thread split | list `?agent_key=vex` shows only Vex threads; Vexi list excludes them |
| Caching | provider spec asserts `cache_control`; `ai_engine_logs.usage` shows `cache_read_input_tokens` > 0 |
| E2E | Playwright on `/admin/vex`: plan card approve → applied; irreversible step asks again; select block rows → "suma las seleccionadas" answers the correct total |

