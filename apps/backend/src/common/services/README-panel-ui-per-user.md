# `panel_ui` por usuario — guía operativa (QUI-727 B.3 / QUI-738)

> Documenta cómo se **configura** la visibilidad de módulos del sidebar
> por usuario, **qué puertas puede tocar un admin**, y dónde está la
> línea roja entre ocultar un módulo y autorizarlo.
>
> Este doc **no reescribe** la teoría de `MenuFilterService`, el triple
> cruce ni el contrato del backend: esa vive en la skill
> `vendix-panel-ui` (catálogo único). Aquí está **cómo opera un
> developer que tiene que guardar o leer `panel_ui` por usuario** sin
> romper la invariante central.
>
> Fuente de verdad verificada línea por línea antes de escribir este
> documento:
> - `apps/backend/src/common/services/default-panel-ui.service.ts` — `PANEL_UI_FALLBACK`,
>   `getUnifiedTemplate()`, auto-merge.
> - `apps/backend/src/common/utils/panel-ui.util.ts` — `mergePanelUiByAppType`,
>   `@PanelUiKeysWhitelist()`, `PanelUiWhitelistConstraint.validate`.
> - `apps/backend/src/common/utils/panel-ui-merge.util.ts` — `mergePanelUiSoft`,
>   `mergeUserConfigPanelUi`, `isLegacyFlatPanelUi`.
> - `apps/backend/src/domains/organization/users/dto/user-config.dto.ts:56-57`
>   — el DTO con el shape canónico anidado y la whitelist.
> - `apps/backend/src/domains/store/store-users/dto/update-user-panel-ui.dto.ts`
>   — DTO gemelo del segundo endpoint.
> - `apps/backend/src/domains/auth/README-permisos-por-rol.md` §9 — nota
>   sobre `panel_ui` vs autorización.
>
> ## 1. Regla de oro — **visibilidad ≠ autorización**
>
> `panel_ui` controla qué módulos ve un usuario en el sidebar. Esa
> visibilidad se aplica en **el navegador** (Angular). **No es una
> defensa de API**. Un usuario con el `@Permissions` correcto en el JWT
> puede llamar al endpoint **directamente** (`curl`, DevTools, un
> cliente HTTP) aunque `panel_ui[modulo]=false`, porque el guard
> backend (`PermissionsGuard` en
> `apps/backend/src/domains/auth/guards/permissions.guard.ts`) no
> consulta `panel_ui`. Esa decisión está documentada en
> `apps/backend/src/domains/auth/README-permisos-por-rol.md` §9 y en
> `apps/backend/src/domains/auth/guards/permissions.guard.ts`.
>
> Por eso este documento **no** menciona "asegurar módulos": la
> defensa de seguridad real es backend (permisos + roles +
> `PermissionsGuard`). `panel_ui` es **UX**, nunca seguridad.
>
> ## 2. Forma canónica del JSON — **anidado por `app_type`**
>
> El único shape soportado es **anidado por `app_type`**:
>
> ```jsonc
> {
>   "ORG_ADMIN":       { "dashboard": true, "stores": true, ... },
>   "STORE_ADMIN":     { "dashboard": true, "pos": true, "products": true, ... },
>   "STORE_ECOMMERCE": { ... },
>   "VENDIX_LANDING":  {}
> }
> ```
>
> La forma plana legacy `{ products: true, dashboard: true }` está
> **descartada en lectura** por `isLegacyFlatPanelUi`
> (`panel-ui-merge.util.ts`). Privilegiados reciben defaults por auto-merge;
> no-privilegiados ven `{}` (panel vacío), no honor de la legacy.
>
> Guardar la forma plana desde un handler es un **bug silencioso**: el
> siguiente login del usuario pierde su config. No lo hagas.
>
> ## 3. Whitelist de claves — `PANEL_UI_FALLBACK` es la única fuente backend
>
> La whitelist deriva de `DefaultPanelUIService.PANEL_UI_FALLBACK`
> (`apps/backend/src/common/services/default-panel-ui.service.ts:42`),
> un `Record<app_type, Record<key, true>>` privado. El validador
> `@PanelUiKeysWhitelist()`
> (`apps/backend/src/common/utils/panel-ui.util.ts`) reflexiona sobre
> la instancia para no acoplar el validador al servicio.
>
> Comportamiento del validador (verificado leyendo `validate()`):
>
> - `value == null` o `typeof !== 'object'` → pasa (campo opcional).
> - Array → rechaza (no es un mapa anidado).
> - Para cada `appType`, verifica que cada `key` exista en
>   `PANEL_UI_FALLBACK[appType]`.
> - Si la `appType` misma no existe en `PANEL_UI_FALLBACK`, **no
>   falla por eso** — el validador solo mira las claves de cada app.
>   Esto es por diseño: el frontend puede tener un `app_type` que el
>   backend aún no conoce; el contrato de whitelist es **hacia
>   adentro** (no se filtra lo nuevo), no hacia fuera.
>
> ⚠️ Deuda de mantenimiento dual: el catálogo vive en `PANEL_UI_FALLBACK`
> (backend) y en `APP_MODULES` + `store-module-catalog.constant.ts`
> (frontend). Los dos pueden divergir. El propio
> `panel-ui.util.ts:17-23` lo documenta. Hay tests cruzados en
> `default-panel-ui.service.spec.ts` que parsean ambos archivos del
> disco para detectar drift.
>
> ## 4. Endpoints que **escriben** `panel_ui` por usuario
>
> Dos endpoints, los dos con **deep-merge por `app_type`** vía
> `mergePanelUiByAppType` (`panel-ui.util.ts:67`). Esto significa:
> **un PATCH con `{ STORE_ADMIN: { pos: false } }` no pisa las otras
> claves** que el usuario tenía; solo actualiza la rama afectada.
>
> | Endpoint | Auth | DTO |
> |----------|------|-----|
> | `PATCH /api/organization/users/:id/configuration` | `organization:users:update` | `user-config.dto.ts:56-57` (`@IsObject() @PanelUiKeysWhitelist()`) |
> | `PATCH /api/store/store-users/management/:id/panel-ui` | admin de tienda | `store-users/dto/update-user-panel-ui.dto.ts` |
>
> ⚠️ **No existe `/api/auth/users/me/config`.** Un `grep` sobre el
> repo devuelve cero resultados. El usuario **no puede
> autoconfigurarse** `panel_ui` por la vía de `configuration` —
> necesita un admin con el permiso `organization:users:update`.
>
> ⚠️ **La whitelist responde 400, no 422.** El validador es un
> `class-validator` y el `ValidationPipe` global responde 400. Si
> pruebas `panel_ui: { "fake-key": false }`, espera 400.
>
> ## 5. Lectura — qué recibe el frontend
>
> El frontend nunca lee `panel_ui` directo de la DB. La cadena es:
>
> 1. `auth.service.ts` (login/refresh/env-switch) → `getSettings()`.
> 2. `DefaultPanelUIService.getUnifiedTemplate()` aplica el
>    **auto-merge** entre la fila de `default_templates` y
>    `PANEL_UI_FALLBACK`. Resultado: cualquier clave nueva en el
>    fallback aparece sin migración, sin seed, sin re-deploy.
> 3. `mergeUserConfigPanelUi(config, defaults, roles)`:
>    - Detecta forma plana legacy → descarta.
>    - Si el rol está en `PRIVILEGED_ROLE_NAMES`
>      (`owner|admin|super_admin`, definido en
>      `common/utils/privileged-roles.util.ts`) → **deep-fill de
>      claves ausentes con los defaults** por `app_type`. Si está en
>      `false`, se respeta. Si está ausente → toma el default.
>    - Si el rol NO es privilegiado → devuelve el `panel_ui` del
>      usuario **tal cual**. Defaults no entran.
> 4. `user_settings.config.new_keys[app_type]` = defaults.keys
>    filtrados por los que el usuario ya marcó como vistos (sirve el
>    badge "Nuevo" en el dropdown del usuario y en "Módulos del
>    Panel", nunca en el sidebar).
>
> El resultado se envía en `user_settings.config.panel_ui` de la
> respuesta de login / `getSettings()` / `environment-switch`.
> `MenuFilterService` (frontend) lo cruza con `industries ∩
> store_panel_ui ∩ user_panel_ui ∩ store_type ∩ module_flows ∩
> operating-scope ∩ fiscal-scope ∩ subscription gates` antes de
> pintar el sidebar.
>
> ## 6. Backfill masivo — `sync-panel-ui`
>
> Para persistir el auto-merge a todos los usuarios privilegiados
> (típicamente antes de cambiar defaults otra vez):
>
> - `GET  /superadmin/users/panel-ui-preview` — dry-run, conteos
>   por `app_type`, sin escribir.
> - `POST /superadmin/users/sync-panel-ui` — body
>   `{ user_ids?: number[], app_types?: string[], strategy?: 'merge' | 'replace' }`.
>   Default `merge` (fill de ausentes, respeta `false`); `replace`
>   sobreescribe la rama entera.
> - Guard: `@Roles(UserRole.SUPER_ADMIN)`. No requiere permission row
>   adicional.
> - Implementación:
>   `apps/backend/src/domains/superadmin/users/users.service.ts:syncPanelUI`.
>
> ⚠️ Los targets elegibles son **solo** los privilegiados
> (`PRIVILEGED_ROLE_NAMES`). `manager`, `cashier`, `employee`,
> `mesero`, `cocina` **no** se tocan con `merge` — su `panel_ui` lo
> gestiona el admin explícitamente.
>
> ## 7. Marcar clave como vista — `markPanelUiSeen`
>
> Endpoint: `POST /api/auth/panel-ui/mark-seen`
> - Body: `{ key: string, app_type: string }`.
> - Appendea `key` a
>   `user_settings.config.panel_ui_seen_keys[app_type]`.
> - Auth: cualquier usuario autenticado.
>
> El frontend lo dispara al togglear ON un módulo desde "Módulos del
> Panel" (settings-modal) o al activarlo desde el banner del dropdown
> del usuario. **Nunca** desde un click del sidebar.
>
> ## 8. Diferencias con la auth
>
> | Preocupación | Sistema |
> |--------------|---------|
> | Ocultar / mostrar módulo del sidebar | `panel_ui` (industria ∩ tienda ∩ usuario ∩ store_type ∩ module_flows ∩ scopes ∩ subscription) |
> | Permitir / denegar operación de API | `PermissionsGuard`, roles, auth guards |
> | Asignar permisos a un rol | `apps/backend/prisma/seeds/permissions-roles.seed.ts` |
> | Cambiar la **forma** de `panel_ui` (legacy → nested) | Super-admin: `POST /superadmin/users/sync-panel-ui` con `strategy: 'replace'` |
>
> Para reglas finas (qué permisos tiene un rol concreto, quién
> asigna `mesero`/`cocina`, qué pasa si el seed no revoca por
> sí solo), ver `apps/backend/src/domains/auth/README-permisos-por-rol.md`.
> Para el diagnóstico de por qué un módulo no aparece, ver la skill
> `vendix-panel-ui` → sección "Diagnose".
>
> ## 9. Referencias
>
> - `apps/backend/src/common/services/default-panel-ui.service.ts:42`
>   — `PANEL_UI_FALLBACK`.
> - `apps/backend/src/common/utils/panel-ui.util.ts` — whitelist,
>   `mergePanelUiByAppType`, deuda de mantenimiento dual.
> - `apps/backend/src/common/utils/panel-ui-merge.util.ts` —
>   `mergePanelUiSoft`, `mergeUserConfigPanelUi`,
>   `isLegacyFlatPanelUi`.
> - `apps/backend/src/common/utils/privileged-roles.util.ts` —
>   `PRIVILEGED_ROLE_NAMES`.
> - `apps/backend/src/domains/organization/users/dto/user-config.dto.ts:56-57`.
> - `apps/backend/src/domains/store/store-users/dto/update-user-panel-ui.dto.ts`.
> - `apps/backend/src/domains/auth/README-permisos-por-rol.md` §9.
> - Skill `vendix-panel-ui` (teoría y diagnosis).
