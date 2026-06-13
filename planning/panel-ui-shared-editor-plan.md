# Plan: Componente compartido `app-panel-ui-modules-editor`

## Context
El árbol de toggles de módulos panel_ui (padre→children + "Herramientas Directas" + gating + sync padre/hijo + búsqueda) está **duplicado** en 3 componentes (`settings-modal`, `store-user-edit-modal`, `general-settings-form`) y un 4º lo edita como **textarea JSON crudo** (`user-config-modal` de org). Crear o cambiar un módulo obliga hoy a tocar N archivos y produce drift visual/funcional. El skill `vendix-panel-ui` ya advierte de este riesgo. Objetivo: extraer un único componente presentacional agnóstico (config de tienda vs de usuario) y reusarlo en todos, de modo que el catálogo `APP_MODULES` sea la única fuente y todas las superficies queden siempre sincronizadas.

## General Objective
Unificar el render y la interacción del editor de módulos panel_ui en un solo componente compartido reusado por las 4 superficies, manteniendo intactos los contratos de persistencia de cada una.

## Specific Objectives
1. Existe `app-panel-ui-modules-editor` en `shared/components/` con API agnóstica: entra `Record<string,boolean>` por app_type + arrays de gating, sale `valueChange: Record<string,boolean>`.
2. El componente posee: agrupación padre/children con árbol CSS, sección "Herramientas Directas", sync padre→children, gating (disabled + badge "Industria"/"Tienda"), búsqueda y badge "Nuevo".
3. `general-settings-form` (tienda) renderiza el árbol vía el componente compartido; su emit sigue siendo `{ STORE_ADMIN: { key:false } }` (solo apagados).
4. `settings-modal` (usuario) renderiza vía el componente; conserva su FormGroup anidado `panel_ui.{appType}.{key}` y su diff de save excluyendo gated.
5. `store-user-edit-modal` (usuario tienda) renderiza vía el componente; conserva su signal `localPanelUI[appType][key]` y su diff de save.
6. `user-config-modal` (org) reemplaza el textarea por: árbol compartido para `STORE_ADMIN` y `ORG_ADMIN` + bloque "Avanzado (JSON)" para `STORE_ECOMMERCE`/`VENDIX_LANDING`; el save sigue escribiendo el mapa anidado completo.
7. Las reglas de gating siguen leyéndose de la fuente única (`getModulesHiddenByIndustries` + `store_settings.panel_ui`); ningún componente inlinea reglas por-industria.
8. Build watch-mode limpio en las 4 superficies; toggles, sync, gating y save funcionan en cada una.

## Approach Chosen
**Componente presentacional agnóstico al storage.** Recibe el mapa resuelto `Record<string,boolean>` del app_type activo + arrays de gating (`hiddenByIndustry`, `hiddenByStore`) + `newKeys`; construye **internamente** un `FormGroup` plano por `key` (porque `app-setting-toggle` solo acepta valor vía CVA/`FormControl`, no tiene input `value`) y bindea `[formControl]`; emite `valueChange` con el mapa actualizado en cada toggle/cascade. Cada consumidor adapta su propio storage (FormGroup plano/anidado, signal Record, JSON) hacia/desde ese mapa y aplica su propia semántica de save (tienda=solo `false`; usuario=diff excluyendo gated; org=mapa completo). El componente centraliza render + interacción; la persistencia queda en el consumidor. Esto es exactamente "agnóstico a si es config de tienda o de usuario".

## Alternatives Considered
- **Reusar `SettingsModalComponent` completo en todos**: rechazado — arrastra tabs, app-type switching, NgRx de user-settings y save propio; no encaja en tienda (output emit) ni en org (JSON), y acoplaría todo a la lógica de user-settings.
- **Componente que reciba un `FormGroup` ya armado**: rechazado — obliga a todos a usar ReactiveForms con la misma forma (el de org usa JSON; el de store-user usa signals). El mapa normalizado es el mínimo común denominador.
- **Migrar #4 por completo al árbol (sin JSON)**: rechazado — `APP_MODULES` no cataloga `STORE_ECOMMERCE`/`VENDIX_LANDING`; perder su edición sería regresión. Híbrido árbol+JSON preserva capacidad.

## Critical Files
- `apps/frontend/src/app/shared/components/panel-ui-modules-editor/panel-ui-modules-editor.component.ts` — nuevo componente compartido (lógica + template inline o .html).
- `apps/frontend/src/app/shared/components/panel-ui-modules-editor/panel-ui-modules-editor.component.scss` — árbol/grupo/child/badge (movido desde los duplicados).
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts` — fuente del catálogo (`APP_MODULES`, `AppModule`); lectura.
- `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` — `getModulesHiddenByIndustries` (gating industria); lectura.
- `apps/frontend/src/app/shared/components/setting-toggle/setting-toggle.component.ts` — toggle reusado (CVA); lectura de contrato.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.ts` — consumidor #2 (tienda): adaptar a mapa + valueChange.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.html` — reemplazar árbol por el componente.
- `apps/frontend/src/app/private/modules/store/settings/general/components/general-settings-form/general-settings-form.component.scss` — quitar SCSS del árbol (migrado al compartido).
- `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.ts` — consumidor #1 (usuario): adaptar FormGroup anidado ↔ mapa; quitar árbol/gating/sync duplicados + su SCSS de módulos.
- `apps/frontend/src/app/shared/components/settings-modal/settings-modal.component.scss` — quitar SCSS del árbol migrado.
- `apps/frontend/src/app/private/modules/store/settings/users/components/store-user-edit-modal.component.ts` — consumidor #3 (usuario tienda): adaptar signal `localPanelUI` ↔ mapa; quitar duplicados.
- `apps/frontend/src/app/private/modules/organization/users/components/user-config-modal.component.ts` — consumidor #4 (org): textarea → árbol (STORE_ADMIN/ORG_ADMIN) + JSON avanzado (resto).

## Reusable Assets
- `apps/frontend/src/app/shared/components/setting-toggle/setting-toggle.component.ts` — fila toggle CVA (label/description/isNew/changed); el átomo del árbol.
- `apps/frontend/src/app/shared/constants/app-modules.constant.ts` — `APP_MODULES` + `AppModule` (estructura anidada con `.children`); fuente del render.
- `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` — `getModulesHiddenByIndustries` (fuente única de reglas por industria).
- SCSS del árbol ya existente en `settings-modal.component.scss` (`.compact-modules-grid`/`.module-group`/`.children-grid`/`.child-item`/`.panel-toggle-reason-badge`) — se mueve al componente compartido.
- `apps/frontend/src/app/shared/components/modal/modal.component.ts` — wrapper de modal (sin cambios; los consumidores siguen envolviendo).

## Steps
1. Crear `app-panel-ui-modules-editor` (componente compartido)
   Skills: vendix-frontend-component, vendix-zoneless-signals, vendix-panel-ui, vendix-angular-forms
   Resources: `docker logs --tail 60 vendix_frontend`
   Business decision: panel_ui es solo visibilidad; el componente muestra gating como disabled + badge ("Industria"/"Tienda", industria precede) y nunca oculta toggles gated; toggles gated se excluyen del save (los maneja el consumidor con los mismos arrays). Render = catálogo `APP_MODULES` (fuente única).
   Why: primero porque los 4 consumidores dependen de su API; sin él no hay nada que reusar.
   Output: componente standalone con inputs `appType`, `value: Record<string,boolean>`, `hiddenByIndustry: string[]`, `hiddenByStore: string[]`, `newKeys: string[]`, `searchable=true`, `parentSync=true`, `readOnly=false`; output `valueChange: Record<string,boolean>`; FormGroup interno por key; `modulesWithChildren`/`standaloneModules` por appType; búsqueda (computed sobre término+catálogo, no sobre form.value); sync padre→children; SCSS del árbol.
   Verification: build watch-mode limpio; render aislado del árbol con datos STORE_ADMIN muestra grupos+children+standalone+badges.
2. Migrar `general-settings-form` (#2, tienda) al componente
   Skills: vendix-frontend-modal, vendix-zoneless-signals, vendix-panel-ui, vendix-settings-system
   Resources: `docker logs --tail 60 vendix_frontend`
   Business decision: emit de tienda sigue siendo `{ STORE_ADMIN: { key:false } }` (solo apagados; absent=permitido). Gating: solo industria (`hiddenByStore=[]`).
   Why: es el componente ya tocado en esta sesión; sirve de piloto del nuevo API antes de los más complejos.
   Output: en el modal "Módulos de la Tienda", `<app-panel-ui-modules-editor>` reemplaza el árbol; `panelUi` input → mapa `value`; `valueChange` → reconstruye y emite `panelUiChange`. Eliminado del componente: `panelUiForm`, `onParentToggle`, `syncPanelUiDisabledState`, `recomputeOffCount` ad-hoc del árbol y el SCSS del árbol (se conserva `offModulesCount` derivado del mapa para el badge "ocultos").
   Verification: en `/admin/settings/general`, abrir modal, togglear padre/hijo, confirmar auto-save (`panelUiChange`) y badge de ocultos; build limpio.
3. Migrar `settings-modal` (#1, usuario) al componente
   Skills: vendix-frontend-modal, vendix-zoneless-signals, vendix-panel-ui, vendix-frontend-state, vendix-angular-forms
   Resources: `docker logs --tail 60 vendix_frontend`
   Business decision: conserva FormGroup anidado `panel_ui.{appType}.{key}` y `buildPanelUiDiff()` excluyendo gated; gating STORE_ADMIN = industria ∩ store panel; ORG_ADMIN sin gating. "Nuevo" vía `new_keys`.
   Why: tras validar el API en tienda; es el consumidor con más lógica (dual app + search + new badge) — confirma que el componente absorbe todo.
   Output: por app_type activo, render vía el componente con `value` derivado del FormGroup, `hiddenByIndustry`/`hiddenByStore`/`newKeys` pasados; `valueChange` parchea el FormGroup (`emitEvent:false`). Eliminado: markup del árbol, métodos de gating/sync/search duplicados, SCSS del árbol.
   Verification: abrir Configuración (dropdown usuario), togglear en STORE_ADMIN y ORG_ADMIN, ver badges gated en STORE_ADMIN, guardar y confirmar `updateUserSettings` con diff correcto; build limpio.
4. Migrar `store-user-edit-modal` (#3, usuario tienda) al componente
   Skills: vendix-frontend-modal, vendix-zoneless-signals, vendix-panel-ui, vendix-frontend-state
   Resources: `docker logs --tail 60 vendix_frontend`
   Business decision: conserva signal `localPanelUI[appType][key]` y `buildPanelUIDiff()` excluyendo gated; mismas reglas de gating que #1.
   Why: comparte forma de datos (signal Record) distinta a los FormGroups; valida que el mapa normalizado sirve también sin ReactiveForm en el consumidor.
   Output: pestaña "Modulos" renderiza vía el componente con `value` = `localPanelUI[appType]`; `valueChange` actualiza el signal; gating + search delegados. Eliminado: markup/SCSS/métodos duplicados.
   Verification: en `/admin/settings/users`, editar usuario, pestaña Modulos, togglear, ver gating, "Guardar modulos" dispara `updateUserPanelUI` con diff correcto; build limpio.
5. Migrar `user-config-modal` (#4, org) a árbol híbrido
   Skills: vendix-frontend-modal, vendix-zoneless-signals, vendix-panel-ui, vendix-validation
   Resources: `docker logs --tail 60 vendix_frontend`
   Business decision: org no tiene gating (`hiddenByIndustry=[]`, `hiddenByStore=[]`). Para app_types catalogados (`STORE_ADMIN`,`ORG_ADMIN`) absent se resuelve a `true` para mostrar; el save escribe el mapa anidado completo (paridad con el textarea). `STORE_ECOMMERCE`/`VENDIX_LANDING` siguen vía "Avanzado (JSON)" por falta de catálogo.
   Why: último porque su forma (JSON) es la más distinta y requiere el bloque híbrido; aprovecha el componente ya validado en 3 superficies.
   Output: pestaña "Panel UI" con sub-tabs por app_type catalogado usando el componente + `<details>` "Avanzado (JSON)" para los no catalogados; parse del `panel_ui` JSON ↔ mapas; save `updateUserConfiguration` con el objeto completo. Validación JSON conservada para el bloque avanzado.
   Verification: en config de usuario de org, editar toggles STORE_ADMIN/ORG_ADMIN + JSON avanzado, guardar y confirmar `panel_ui` resultante íntegro; build limpio.
6. Verificación integral de las 4 superficies
   Skills: buildcheck-dev, vendix-panel-ui
   Resources: `docker logs --tail 80 vendix_frontend`; rutas UI: `/admin/settings/general`, dropdown→Configuración, `/admin/settings/users`, config usuario org
   Business decision: ninguna superficie puede quedar con árbol propio; todas consumen el compartido (excepto el JSON avanzado de org documentado como gap).
   Why: cierra el objetivo de "todas siempre con lo mismo"; detecta drift residual.
   Output: 4 superficies renderizando el componente compartido; sin SCSS/markup de árbol duplicado restante.
   Verification: build watch-mode sin ERROR/NG; recorrido manual de las 4 rutas con toggle+save; `grep -rn "compact-modules-grid" apps/frontend/src` solo aparece en el componente compartido (+ JSON avanzado si aplica).

## End-to-End Verification
1. Build watch-mode: `docker logs --tail 80 vendix_frontend` muestra "Application bundle generation complete" sin "ERROR"/códigos NG tras los cambios.
2. UI tienda: en `/admin/settings/general` modal "Módulos de la Tienda" — togglear padre apaga children (disabled), auto-save vía `panelUiChange`, badge "N ocultos" correcto.
3. UI usuario (settings-modal) y usuario-tienda (store-user-edit-modal): togglear en STORE_ADMIN muestra badges "Industria"/"Tienda" en módulos gated; guardar persiste diff excluyendo gated (verificar payload en Network/`updateUserSettings`/`updateUserPanelUI`).
4. UI org (user-config-modal): toggles STORE_ADMIN/ORG_ADMIN + JSON avanzado producen un `panel_ui` anidado completo al guardar (`updateUserConfiguration`).
5. Anti-drift: `grep -rn "compact-modules-grid\|children-grid\|module-group" apps/frontend/src/app` solo referencia el componente compartido (y su SCSS), no los 3 consumidores migrados.

## Knowledge Gaps
- Catálogo de módulos para `STORE_ECOMMERCE` y `VENDIX_LANDING` ausente en `APP_MODULES` → el editor de org no puede unificar esos app_types al árbol (queda JSON avanzado). Proponer plan follow-up para catalogarlos y eliminar el JSON.
- Patrón "editor de módulos panel_ui = un solo componente compartido" no documentado como tal → proponer actualizar `vendix-panel-ui` (sección "Render único: `app-panel-ui-modules-editor`") vía `skill-creator` tras estabilizar.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
