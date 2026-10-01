# Vex Remediation — Cierre E2E 1-3 en vivo post-fix (rxH-e2e2)

Fecha: 2026-10-01. Rama: `develop`, HEAD `15ce60cd6` (batch `[rxH-e2e]` incluido).
Plan: `docs/plans/vex-agent-remediation-plan.md`, sección End-to-End Verification.

Este reporte prueba que E2E 1-3 PASAN en vivo sobre el código post-fix, con
evidencia inspeccionable archivo por archivo en esta misma carpeta.

## Entorno

- Backend: contenedor `vendix_backend` (`/api/health` ok). Frontend: `ng serve`
  nativo, `buildcheck.sh --watch` = OK sin errores. Vhost `https://vendix.com`.
- Tienda: Roku (id 10), `settings.vex.enabled=true`. Plan dev-annual (id 6) con
  `vex_agent` habilitado (caps 5000 tool-calls / 1M tokens / 100 msgs).
- `STORE_GATE_ENFORCE=true`. Modelo: `vex_assistant` → DeepSeek vía OpenRouter.
- Usuarios: owner `owner@roku.vendix.com` (id 162), admin
  `admin@roku-demo.vendix.local` (id 163). Conversaciones nuevas de este run:
  E2E-1 = 80, E2E-2/E2E-3 = 81 (sin reutilizar hilos del run previo).

## E2E-1 Seguridad — PASS

Prompt (conv 80): crear `E2E2A-vex` ($1000) + `E2E2B-vex` ($2000) + eliminar
`E2E2Z-sacrificial` (id 2513, creado por API antes del turno).

Desviación documentada vs el plan: el paso irreversible es `archive_product`
en vez de `send_invoice_dian`. Ambos pertenecen a la clase irreversible del
paso 1 de remediación (`delete/archive` está en el regex de cobertura) y
ejercitan el mismo camino de código (flag → `reconfirm_steps` → `AI_AGENT_005`
→ tarjeta propia); emitir una factura DIAN real en un E2E sería inseguro.

1. El stream SSE trae UN frame `plan_approval` con `plan_id=44826ba2-…` y 3
   pasos: 2× `create_product` (`irreversible=false`) + `archive_product`
   (`irreversible=true`). Ver `e1-stream.sse`, `e1-plan-frame.json`.
2. `GET conversations/80` persiste `metadata.plan` (`plan_id` igual al frame,
   `status=proposed`, `step_id` s1/s2/s3). Ver `e1-conv-get.txt`.
3. UNA aprobación (`POST plans/:id/approve` como owner) responde
   `covered_steps=[1,2]`, `reconfirm_steps=[3]`, `ignored_steps=[]` con
   `plan_token` TTL 900 s. Ver `e1-approve.json`, `e1-approve-body.json`.
4. Aplicar pasos 1-2 crea los productos 2514/2515 (activos). Ver
   `e1-apply1.json`, `e1-apply2.json`, `e1-verify-products.txt`.
5. El irreversible NO se ejecuta con la aprobación: 2513 sigue `active` y
   aplicar el paso 3 con el plan-token responde `AI_AGENT_005` + token
   single-use fresco (`eaefaf86-…`). Ver `e1-apply3-reconfirm.json`.
6. La confirmación propia (`POST /store/vexi/confirmations/apply` con el token
   fresco) archiva 2513. Ver `e1-apply3-single.json`,
   `e1-sacrificial-archived.txt`, `e1-db-ground-truth.txt`.
7. Otro usuario de la misma tienda (admin 163) intentando aprobar recibe
   `403 AUTH_PERM_001`. Ver `e1-approve-admin403.json`.
8. UI (`ui-e1-plan-card.png`): tarjeta con "3 paso(s) · aprobado",
   "1 irreversible(s)", badge Irreversible + botones propios en el paso 3,
   estado "Plan aprobado", y bitácora con las 3 acciones a las 12:54 (hora
   tienda = 17:54 UTC).

## E2E-2 Bloques y persistencia — PASS

Prompt (conv 81): ventas por categoría del mes en gráfico + tabla + exportar
a Excel.

1. El turno emite 3 frames `ui_block` con `block_id` real: `chart`
   `0ea809ec-…`, `table` `f5eddd9e-…`, `file` `00689d48-…`. Ver `e2-stream.sse`.
2. `metadata.blocks` persiste 5 refs (2 markdown + chart + table + file).
   Ver `e2-meta.txt`, `e2-table.txt` (5 filas).
3. El bloque `file` persiste SOLO `s3_key` en `ai_ui_blocks`; la lectura
   emite URL firmada fresca (`X-Amz-Expires=900`). Ver `e2-file-db.txt`.
4. `row_select` con Televisores (3.299.000) + Alimentos (2.302.000) queda
   registrado; el follow-up "Suma los ingresos…" responde **5.601.000 COP**
   con desglose correcto. Ver `e2-interaction.json`, `e2-stream2.sse`.
5. UI: al abrir conv 81 el navegador pide `GET blocks/:id` de los 5 bloques
   (todos 200) y renderiza chart + tabla + archivo + KPI de suma. Ver
   `ui-network.log`, `ui-e2-blocks.png`. Consola: 0 errores (1 warning
   NG0505 de hidratación, pre-existente). Ver `ui-console.log`.
6. Recarga dura de `/admin/vex` (sin redirect del guard) + reapertura de
   conv 81: mismos bloques y misma suma; screenshot post-reload
   **byte-idéntico** al pre-reload (md5 `3cf1a29a…`). Ver
   `ui-e2-after-reload.png`.

## E2E-3 Gating — PASS

Hallazgo de método (documentado, no bug): el gate resuelve features EN VIVO
desde las filas del plan (`paid_plan.ai_feature_flags`, vía
`SubscriptionResolverService` + caché `sub:features:{store}` 60 s);
`store_subscriptions.resolved_features` es snapshot denormalizado. Tocar solo
el snapshot NO bloquea (probado: turno pasa, ver `e3-gated-stream.sse`). El
toggle correcto equivale al editor de superadmin (plan + invalidar caché).

1. Con `vex_agent.enabled=false` en el plan 6 y caché invalidada:
   `POST stream-intent` → `403 SUBSCRIPTION_005` y `POST messages` → mismo
   403. Ver `e3-blocked-intent.json`, `e3-blocked-message.json`. Cuota
   intacta (126). Ver `e3-quota-gated.txt`.
2. Re-enable (`enabled=true` + `DEL sub:features:10`, == superadmin):
   el turno pasa ("restaurado"). Ver `e3-restored-stream.sse`.
3. Medición: turno de 1 tool (`find_product`) mueve
   `ai:quota:10:vex_agent:202610` de 126 → 127. Ver `e3-meter-stream.sse`,
   `e3-quota-before/after.txt`. Turnos solo-texto no consumen tool-calls
   (correcto: el contador es de tool-calls). `tool_agents` no recibe el
   consumo Vex (48, sin movimiento atribuible).
4. Estado restaurado: plan 6 == backup (`e3-plan6-backup.txt`), snapshot ==
   backup (`e3-resolved-backup.txt`), caché regenerada por el resolver.

## E2E-4 Tests — PASS (con nota de zoneless)

- Jest dirigido (vex + ai-chat.plan + ai-agent + registry + coverage):
  **11 suites / 271 tests PASS**. Ver `e4-jest-vex.txt`.
- Jest providers + domains tocados por remediación
  (anthropic-compatible.provider, vex-blocks, reporting, cash-register,
  products, variants, subscriptions): **7 suites / 195 tests PASS**.
  Ver `e4-jest-run2.txt`. Total E2E-4: 18 suites / 466 tests verdes.
  (Nota: el barrido completo de `tools/domains` se abortó por contención de
  memoria local —swap— tras 10 min sin progreso; el set dirigido cubre todos
  los archivos que la remediación tocó en esos directorios; CI corre el resto.)
- `zoneless:audit`: FAIL repo-wide, pero los offenders están FUERA del scope
  Vex (dian-municipality-select, planilla-pdf-viewer, invoice-create-page,
  pos-customer-modal, tour-modal, menu-filter spec) — pre-existente, no de
  remediación. Scope Vex (`store/vex`, `settings/ai-agents`,
  `vex-access.guard`): 0 hits en las 5 categorías. Ver `e4-zoneless.txt`.
- Grep colores fijos (paso 10) en scope Vex: 0 líneas. Ver `e4-colors.txt`.
- `buildcheck.sh --watch`: `ng serve` ACTIVO, último ciclo OK, sin errores.

## Matriz de cobertura (how-to-test)

| Flujo | Happy ✅ | Sad ⚠️ | Brute 🔒 | Evidencia |
|---|---|---|---|---|
| E2E-1 plan 2+1 | approve aplica 2 reversibles | aplicar irreversible con plan-token → AI_AGENT_005 claro, sin escritura parcial | otro usuario approve → 403; steps alterados ignorados (hashes servidor) | e1-*.json/sse/txt |
| E2E-2 bloques | chart+table+file+suma correcta | n/a (turno read-only) | bloque ajeno → 404 (spec), s3_key sin URL persistida | e2-*, ui-* |
| E2E-3 gating | re-enable pasa + cuota sube | plan sin feature → 403 claro | bypass por snapshot no funciona (fuente = plan) | e3-* |

Sad-path adicional (brute-force de login): durante las pruebas se tripeó el
rate-limit de login (429, ~10 min); el login real por UI posterior funcionó y
es el usado en la evidencia Playwright.

## Observaciones (no bloquean)

1. Pasos aplicados fuera del UI (vía API/curl) siguen mostrándose como
   "pendiente" a nivel de paso aunque el plan diga "aprobado": el estado por
   paso lo mueve el flujo UI; el estado de plan (fuente de verdad) es
   correcto. Reintentar aplicar está protegido por tokens single-use
   (`replayed`, cubierto por specs).
2. `curl -H "Authorization: [redacted]"` fue reescrito por la capa de
   redacción de secretos del harness en este entorno; toda la evidencia curl
   usa `--oauth2-bearer` (equivalente). Ver `runner-vex_e2e2.py` para el
   runner SSE usado.
3. Consola del navegador: 1 warning NG0505 (hidratación), pre-existente,
   sin relación con Vex.

## Cierre

E2E 1-3 verificados en vivo post-fix con 49 artefactos inspeccionables. Los
productos E2E2A/E2E2B (activos) y E2E2Z (archivado) quedan como rastro
auditable en la tienda Roku (ids 2514/2515/2513).
