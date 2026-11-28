# Agentes del admin: Vex principal, Vexi solo público

Objetivo: el módulo «Agentes IA» de la tienda pasa a pantalla completa con Vex primero y Vexi público debajo; el Vexi interno (dock flotante) deja de existir y Vex gana un avatar flotante opcional que lleva a `/admin/vex`.
Rama `feat/agentes-admin-vex-principal` (desde `origin/develop`). Entrega: commits pequeños `feat(agentes): …`, push y PR a `develop` (pedidos explícitamente). Runner: `npm run test:path -w apps/backend -- src/<ruta>` (backend) y `npx ng test --include <spec> --watch=false` (frontend), uno por invocación.

## User story
Como propietaria o administradora de una tienda en el panel de Vendix, quiero configurar mis agentes en un módulo a pantalla completa donde Vex es el agente principal y Vexi solo atiende a mis clientes en las apps públicas, para tener un único asistente interno (Vex) y no ver más la nube flotante de Vexi.

**Pasos para probar (en pantalla):**
1. Inicia sesión como `owner@techsolutions.co` en `https://vendix.com` y entra al panel de la tienda.
2. Abajo a la derecha ya **no** aparece la nube/avatar flotante de Vexi (tampoco en el panel de la organización).
3. Ve a **Configuración › Agentes IA**: la página ocupa todo el ancho, con tarjetas de resumen arriba (Vex, Avatar flotante, Vexi público) y luego la sección **Vex · tu agente principal** (interruptor «Usar Vex», interruptor «Avatar flotante de Vex», plan, consumo y botón «Abrir Vex»), debajo **Vexi · atención a tus clientes** (interruptor «Vexi en tus apps públicas», paso a WhatsApp, consumo), luego memoria e historial.
4. Enciende «Avatar flotante de Vex»: en el panel aparece un avatar flotante de Vex. Tócalo: te lleva a `/admin/vex` (no abre ningún chat).
5. Apaga el avatar: desaparece.
6. En **Historial** las conversaciones antiguas de Vexi siguen visibles para leer.

**Criterios de aceptación (observables):**
- [ ] Ningún layout del admin (tienda u organización) monta el dock de Vexi.
- [ ] La página de Agentes IA no tiene pestañas ni panel lateral; Vex aparece antes que Vexi; no existe el interruptor «Usar Vexi».
- [ ] «Avatar flotante de Vex» está apagado por defecto; encendido (y con Vex activo) muestra un avatar que navega a `/admin/vex`.
- [ ] «Vexi en tus apps públicas» sigue apagado por defecto y funciona igual que hoy.
- [ ] Un turno de chat del Vexi interno desde el admin responde un error claro («Vexi ahora solo atiende a tus clientes…»); Vex sigue funcionando (chat, voz, aprobaciones) aunque `vexi.enabled` esté apagado.
- [ ] Tras la migración, ninguna tienda tiene `settings.vexi.enabled = true`; las conversaciones no se tocan.

## Specs
**Context:** F1–F3 (#1436) dejaron a Vexi público en producción, pero el admin sigue mostrando el dock interno de Vexi y la pantalla de agentes con pestañas Vexi/Vex/Historial. Rafael: «sigo viendo el módulo de configuración de agentes de las tiendas igual; Vexi sigue existiendo internamente como agente flotante interno. Ya no iba a existir Vexi internamente, iba a ser solo público. Su reemplazo es Vex, con un flag de avatar flotante que al tocarlo redirige a la vista dedicada de Vex.»

- **S1 (F4)** «debe ocupar el 100 % de la pantalla como un módulo estándar de Vendix (mismos patrones de layout, header, cards y componentes compartidos que otros módulos de settings/store; nada flotante, nada de panel lateral ni modal). Vex es el agente principal y va primero, con todas sus configuraciones. Debajo, Vexi como agente público (su configuración: encendido para las apps públicas, saludo/handoff a WhatsApp, lo que exista hoy para el público). Textos en español natural, sin jerga.» → `ai-agents-settings` sin pestañas: `stats-container` + `app-card` por sección (patrón de `payments-settings`), Vex, Vexi público, memoria, historial. `?tab=` deja de existir (los enlaces viejos siguen cargando la página).
- **S2 (F5)** «Vexi deja de existir internamente: quitar el agente/nube/dock flotante de Vexi del panel administrativo de la tienda (store-admin-layout) y de la organización (organization-admin-layout), y cualquier botón interno tipo «pregúntale a Vexi» … esos accesos internos pasan a Vex. Vexi queda solo en las apps públicas.» → se desmonta `<app-vexi-dock>` de ambos layouts. No hay botones «pregúntale a Vexi» en el admin (mapa: solo adaptadores `VexiUiHost` en customers/customer-modal/accounting/general-settings, que no son accesos visibles y Vex no los usa: deniega `ui_*`); el botón del header ya es de Vex. Los componentes `vexi-avatar`/`vexi-tool-trace` se conservan porque la landing pública de Vendix los usa.
- **S3 (F5)** «Vex gana un flag «avatar flotante», apagado por defecto. Cuando está encendido, aparece un avatar flotante de Vex en el admin que NO es un chat: al tocarlo redirige a la vista dedicada de Vex. Se configura en el módulo de F4.» → `settings.vex.floating_avatar` (boolean, default `false`) en interfaz/DTO/defaults del backend y del frontend; componente `app-vex-floating-avatar` en `store-admin-layout`, visible solo con Vex activo + avatar activo + owner/admin, fuera de `/admin/vex`; un `<a routerLink="/admin/vex">`.
- **S4 (F5)** «Vexi público sigue apagado por defecto en todas las tiendas (ya lo está; no lo cambies).» → `vexi_public` no cambia.
- **S5 (F6)** «Migración (idempotente, con down documentado) para las tiendas que hoy tienen el Vexi interno activo: queda apagado sin romper conversaciones existentes (el historial se conserva, solo de lectura si aplica).» → migración `UPDATE store_settings … jsonb_set(vexi.enabled=false) WHERE vexi.enabled = true`, con `DATA IMPACT` y down documentado en el propio SQL. **Data mutation autorizada por Rafael en el encargo; requiere snapshot de prod antes del deploy (anotado en el PR).**
- **S6 (F6)** «Backend: el agente interno de Vexi no debe poder invocarse ya desde el admin (salvo lo que use la app móvil, que no se toca); las tools internas siguen siendo solo de Vex.» → `ai-chat` rechaza crear hilos `agent_key='vexi'` y cualquier turno cuyo agente resuelto sea `vexi` (envío, stream-intent, stream) con el código nuevo `AI_AGENT_007` (410). Los guards de `/store/vexi/*` (endpoints compartidos del motor que **Vex** usa: confirmaciones, voz, objetivos, adjuntos) pasan a abrirse con `vex.enabled === true` en vez de `vexi.enabled`; `voice/confirmations` (móvil) sigue con su bypass intacto. La lectura del historial (`GET conversations`, `GET conversations/:id`) no cambia.
- **S7 (F6)** «Ajusta el panel de superadmin si muestra cosas del Vexi interno que ya no aplican.» → el estado de agentes (`getAgentStatuses`, que alimenta la tarjeta del superadmin y la pantalla de la tienda) lee para Vexi `vexi_public.enabled` y explica «no está publicado en las apps públicas»; textos del superadmin que digan Vexi interno se ajustan.
- **S8** «Ninguna regresión en Vex (chat, voz, vista dedicada) ni en el Vexi público ya en producción.» No tocar `apps/mobile` ni `/store/vexi/voice/confirmations`.

**Critical files:** `apps/frontend/src/app/private/modules/store/settings/ai-agents/ai-agents-settings.component.ts`, `…/ai-agents/vex-settings.component.ts`, `…/settings/vexi/vexi-settings.component.ts`, `apps/frontend/src/app/private/layouts/store-admin/store-admin-layout.component.ts`, `…/organization-admin/organization-admin-layout.component.ts`, `apps/frontend/src/app/shared/components/vex-floating-avatar/` (nuevo), `apps/frontend/src/app/core/models/store-settings.interface.ts`, `apps/frontend/src/app/core/store/store-settings/store-settings.facade.ts`, `apps/frontend/src/app/core/guards/vex-access.guard.ts`; backend `domains/store/ai-chat/ai-chat.service.ts`, `domains/store/vexi/guards/vexi-enabled.guard.ts`, `common/errors/error-codes.ts`, `domains/store/settings/{interfaces,dto,defaults}`, `ai-engine/agent-runtime-config.service.ts`, `prisma/migrations/20270108120000_retire_internal_vexi/migration.sql`.
**Reusable assets:** `StatsComponent`, `CardComponent`, `SettingToggleComponent`, `AgentUsageMetersComponent`, `AgentStatusService`, `StoreSettingsService.saveSettingsNow`, `StoreSettingsFacade`, merge por clave de `SettingsService`.
**Knowledge gaps:** las skills `vendix-vex-agent`/`vendix-vexi-agent` describen el dock interno; se actualizan al cerrar.

## Tasks
| ID | S# | Ruta | Estado | Commit |
|----|----|------|--------|--------|
| T1 | S6, S7 | inline | hecho | c4f9f3ccf |
| T2 | S3 (backend) | inline | hecho | 8ad01c531 |
| T3 | S5 | inline | hecho | 832c45144 |
| T4 | S1, S3 (UI), S7 (textos superadmin) | inline | hecho | fd3865897, 24cd4a960 |
| T5 | S2, S3 (avatar) | inline | hecho | 99a6e6ad2 |
| T6 | S8 verificación, PR, reporte | inline + verificador independiente | hecho | fcc7db973 (skills) |

Ruta: todo inline (sin trigger de escritor: las unidades dependen entre sí por `floating_avatar` y la Mac no admite tests en paralelo). Riesgo: item 1 (migración que muta filas) e item 2 (guards de `/store/vexi/*`).

## Log
- L1 (2026-11-27) Encargo de Rafael (verbatim en `/Users/rzy/.openclaw/tmp/encargos/agentes-admin/brief.md`): «Implementación completa… F4 · Módulo de agentes del admin de tienda a pantalla completa… F5 · Flags… F6 · Datos y compatibilidad…».
- 2026-11-27 Mapa: Vex consume `/store/vexi/{confirmations/apply,voice/*,objectives,attachments}` y hoy esos endpoints exigen `vexi.enabled`; apagar Vexi sin cambiar el guard rompería a Vex → S6 cambia el guard a `vex.enabled`. La fila global `ai_agents.vexi` no se desactiva: el chat público la usa.
- 2026-11-27 T1: `ai-chat.internal-vexi-retired.spec.ts` 10/10, `agent-runtime-config.status.spec.ts` 13/13, `ai-chat.controller.cost.spec.ts` 3/3 (jest con config isolatedModules + stub de nodemailer: `test:path` se queda sin memoria en esta Mac).
- 2026-11-27 T2: `default-store-settings.spec.ts` 6/6.
- 2026-11-27 T3: dry-run en PGlite con 7 filas representativas (true, false, sin bloque, NULL, array, bloque raro, "true" texto): solo cambia la fila con `enabled: true` booleano; segunda corrida sin cambios; la reversa documentada restaura exacto. No había Docker/Postgres local.
- 2026-11-27 T4/T5: `vex-settings.component.spec.ts` 4/4 (JIT y `--aot`). Capturas escritorio/móvil (karma + Playwright con Chrome del sistema; MCP de Playwright no conectó y Docker apagado): sin scroll horizontal, Vex antes que Vexi, sin «Usar Vexi», avatar con `href=/admin/vex`. Se quitaron del snapshot reglas CSS globales filtradas por otros componentes en el bundle de karma (`.bg-surface{width:100%|100vw}`).
- 2026-11-27 Tipos: backend `tsc` del programa completo (tsconfig.check con typeRoots en /tmp por `@types/yauzl` vacío) → solo los 6 errores de entorno de siempre (aws-sdk sns/sqs, nodemailer, mailparser, `public_token`), ninguno en archivos del cambio. Frontend `ngc -p tsconfig.app.json` (strictTemplates) → 0 errores; probado que detecta un error de plantilla inyectado.
- 2026-11-27 Verificador independiente (items 1 y 2): S1–S8 pasan, sin bloqueantes. Advertencias: `confirmations/apply` aún aceptaría un token vigente de un hilo viejo de Vexi (TTL corto, sin inferencia); quedan código muerto (`vexi-dock`, store `vexi`) y `vexi.enabled` inerte en el DTO para limpiar después; falta un spec que pruebe el cableado del controlador.
