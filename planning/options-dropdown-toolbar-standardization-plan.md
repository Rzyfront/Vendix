## Context
Las vistas principales de `SUPER_ADMIN`, `ORG_ADMIN` y algunas de `STORE_ADMIN` mezclan filtros visibles, botones de crear/refrescar/exportar/sincronizar y, en varios módulos, un `app-options-dropdown` que duplica acciones con botones directos. El estándar deseado es que los toolbars de listados queden compuestos por búsqueda visible y `app-options-dropdown`: filtros dentro del menú de filtros y acciones de vista dentro del menú de acciones. El alcance cubre vistas principales/listados; botones de modales, wizards, formularios, detalles, acciones por fila y flujos táctiles de POS quedan fuera salvo que sean claramente toolbars de listado. La ejecución debe preservar los cambios locales ya existentes en `super-admin/users` y los cambios no relacionados en `apps/mobile` y `package-lock.json`.

## General Objective
Estandarizar todos los toolbars de vistas principales de administración para que filtros y acciones de vista usen `app-options-dropdown`, eliminando botones redundantes cuando la acción ya existe en el dropdown.

## Specific Objectives
1. Inventariar y clasificar las vistas principales con filtros visibles, botones directos o dropdown duplicado en `SUPER_ADMIN`, `ORG_ADMIN` y `STORE_ADMIN`.
2. Reforzar `app-options-dropdown` solo si faltan capacidades necesarias para migrar filtros reales de listado sin crear otro componente paralelo.
3. Migrar los listados de `SUPER_ADMIN` que aún exponen filtros/acciones directas.
4. Migrar los listados de `ORG_ADMIN` que aún exponen filtros/acciones directas o botones duplicados junto al dropdown.
5. Limpiar en `STORE_ADMIN` los botones de acción redundantes en toolbars que ya tienen `app-options-dropdown`.
6. Migrar las vistas principales restantes de `STORE_ADMIN` que todavía no usan dropdown para filtros/acciones.
7. Actualizar la guía del estándar para que futuras vistas no vuelvan al patrón de botones sueltos.
8. Verificar compilación en Docker watch mode y hacer revisión visual de rutas representativas.

## Approach Chosen
Hacer la migración por oleadas, empezando por el componente compartido y luego por área de aplicación: primero `SUPER_ADMIN`, después `ORG_ADMIN`, y finalmente `STORE_ADMIN` separando limpieza de duplicados de migraciones nuevas. Este enfoque reduce conflictos porque muchos módulos de tienda ya tienen el patrón parcialmente implementado, mientras que Super Admin y Org Admin contienen más variaciones legacy. La regla de UI será: búsqueda visible, `app-options-dropdown` para filtros/acciones de vista, `ResponsiveDataView` para acciones por fila, y botones directos únicamente en modales/detalles/confirmaciones o flujos donde el dropdown de toolbar no aplica.

## Alternatives Considered
- Refactorizar todo a un nuevo componente `app-list-toolbar`: rechazado porque ya existe `app-options-dropdown` y crear otro wrapper aumentaría la superficie de migración.
- Migrar todos los módulos con un reemplazo textual masivo: rechazado porque hay filtros con estado local, NgRx, señales, formularios reactivos y acciones con permisos diferentes.
- Mantener botones directos para acciones primarias y usar dropdown solo para filtros: rechazado porque mantiene la redundancia que el usuario quiere eliminar en vistas principales.
- Incluir modales, detalles, formularios y POS en la misma migración: rechazado porque esos botones son contextuales y no pertenecen al toolbar estándar de listados.

## Critical Files
- `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.ts` — componente canónico para acciones y filtros de toolbar.
- `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.html` — render de menús de acciones/filtros.
- `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.scss` — comportamiento responsive y overflow del dropdown.
- `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.interfaces.ts` — contrato `FilterConfig`, `DropdownAction`, `FilterValues`.
- `apps/frontend/src/app/shared/components/date-range-picker/date-range-picker.component.ts` — reutilizable si un filtro de rango debe entrar al dropdown.
- `apps/frontend/src/app/shared/components/index.ts` — exporta contratos compartidos si se amplía el API.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` — valida iconos de acciones migradas.
- `apps/frontend/src/app/private/modules/super-admin/users/users.component.html` — referencia reciente ya migrada y con cambios locales pendientes.
- `apps/frontend/src/app/private/modules/super-admin/users/users.component.ts` — referencia reciente ya migrada y con cambios locales pendientes.
- `apps/frontend/src/app/private/modules/super-admin/organizations/organizations.component.ts` — filtros y botones directos en listado.
- `apps/frontend/src/app/private/modules/super-admin/stores/stores.component.html` — varios `app-selector` y botones directos en toolbar.
- `apps/frontend/src/app/private/modules/super-admin/stores/stores.component.ts` — estado de filtros/acciones de tiendas.
- `apps/frontend/src/app/private/modules/super-admin/roles/roles.component.html` — filtro directo y botón directo.
- `apps/frontend/src/app/private/modules/super-admin/roles/roles.component.ts` — configuración de roles/listado.
- `apps/frontend/src/app/private/modules/super-admin/audit/audit.component.html` — filtros y acciones directas.
- `apps/frontend/src/app/private/modules/super-admin/audit/audit.component.ts` — estado de filtros de auditoría.
- `apps/frontend/src/app/private/modules/super-admin/currencies/currencies.component.html` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/super-admin/currencies/currencies.component.ts` — estado de listado de monedas.
- `apps/frontend/src/app/private/modules/super-admin/payment-methods/payment-methods.component.html` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/super-admin/payment-methods/payment-methods.component.ts` — estado de métodos de pago.
- `apps/frontend/src/app/private/modules/super-admin/domains/domains.component.ts` — listado con filtros/botones directos.
- `apps/frontend/src/app/private/modules/super-admin/legal-documents/legal-documents.component.ts` — listado con filtros/botones directos.
- `apps/frontend/src/app/private/modules/super-admin/templates/templates.component.ts` — listado con filtros/botones directos.
- `apps/frontend/src/app/private/modules/super-admin/support/support.component.html` — filtros y acciones directas.
- `apps/frontend/src/app/private/modules/super-admin/support/support.component.ts` — estado de soporte.
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/ai-engine.component.html` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/super-admin/ai-engine/ai-engine.component.ts` — estado AI engine.
- `apps/frontend/src/app/private/modules/super-admin/payroll-defaults/payroll-defaults.component.ts` — acciones de vista en toolbar.
- `apps/frontend/src/app/private/modules/super-admin/shipping/components/shipping-methods/shipping-methods.component.ts` — acción de vista en listado.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/plans/plans.component.ts` — filtros y acciones directas.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/promotional/promotional.component.ts` — filtros y acciones directas.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/partners/partners.component.ts` — filtros y acciones directas.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/payouts/partner-payouts.component.ts` — acciones directas.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/dunning/dunning-board.component.ts` — acciones directas de tablero.
- `apps/frontend/src/app/private/modules/super-admin/subscriptions/pages/events/subscription-events.component.ts` — acciones directas de eventos.
- `apps/frontend/src/app/private/modules/organization/users/users.component.html` — `select` y botones directos.
- `apps/frontend/src/app/private/modules/organization/users/users.component.ts` — estado de usuarios.
- `apps/frontend/src/app/private/modules/organization/stores/stores.component.ts` — `select` y botones directos.
- `apps/frontend/src/app/private/modules/organization/orders/orders-list.component.html` — acciones y varios `select` directos.
- `apps/frontend/src/app/private/modules/organization/orders/orders-list.component.ts` — estado de órdenes.
- `apps/frontend/src/app/private/modules/organization/purchase-orders/pages/list/purchase-orders-list.component.ts` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/organization/audit/logs/logs.component.html` — dropdown existente con botones directos.
- `apps/frontend/src/app/private/modules/organization/audit/logs/logs.component.ts` — estado de logs.
- `apps/frontend/src/app/private/modules/organization/audit/sessions/sessions.component.ts` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/organization/audit/login-attempts/login-attempts.component.ts` — filtros directos sin dropdown.
- `apps/frontend/src/app/private/modules/organization/domains/domains.component.ts` — dropdown existente con botones directos.
- `apps/frontend/src/app/private/modules/organization/roles/components/org-roles-list.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/organization/inventory/pages/locations/locations.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/organization/inventory/pages/suppliers/suppliers.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/organization/inventory/pages/transfers/components/transfer-list.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/organization/inventory/pages/adjustments/components/adjustment-list.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/organization/invoicing/pages/resolutions/org-invoice-resolutions.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/organization/subscriptions/pages/overview/org-subscriptions-overview.component.ts` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/organization/subscriptions/pages/invoices/subscription-invoices.component.ts` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/organization/subscriptions/pages/margins/partner-margins.component.ts` — filtros/botones directos.
- `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.html` — botón crear duplicado junto al dropdown.
- `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.ts` — `dropdownActions` de productos.
- `apps/frontend/src/app/private/modules/store/inventory/suppliers/components/supplier-list/supplier-list.component.html` — botón crear duplicado junto al dropdown.
- `apps/frontend/src/app/private/modules/store/inventory/suppliers/components/supplier-list/supplier-list.component.ts` — `dropdownActions` de proveedores.
- `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.html` — dropdown con acciones de listado.
- `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts` — configuración de acciones de pedidos.
- `apps/frontend/src/app/private/modules/store/settings/users/store-users-settings.component.ts` — botón crear duplicado junto al dropdown.
- `apps/frontend/src/app/private/modules/store/inventory/transfers/components/transfer-list.component.ts` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/inventory/operations/components/adjustment-list/adjustment-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/dispatch-notes/components/dispatch-note-list/dispatch-note-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/invoicing/components/invoice-list/invoice-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/payroll/components/employees/employee-list/employee-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/payroll/components/payroll-runs/payroll-run-list/payroll-run-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/payroll/components/settlements/settlement-list/settlement-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/accounting/components/budgets/budget-list/budget-list.component.html` — botón directo junto a dropdown.
- `apps/frontend/src/app/private/modules/store/settings/domains/store-domains.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/store/settings/roles/components/store-roles-list.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/store/customers/components/customer-list/customer-list.component.ts` — dropdown existente con botón directo.
- `apps/frontend/src/app/private/modules/store/cash-registers/cash-registers.component.ts` — filtros/botones directos sin dropdown.
- `apps/frontend/src/app/private/modules/store/data-collection/fields/fields.component.ts` — filtros/botones directos sin dropdown.
- `apps/frontend/src/app/private/modules/store/marketing/anuncios/anuncios.component.ts` — filtros/botones directos sin dropdown.
- `apps/frontend/src/app/private/modules/store/marketing/coupons/coupons.component.ts` — acciones directas sin dropdown.
- `apps/frontend/src/app/private/modules/store/accounting/components/chart-of-accounts/chart-of-accounts.component.ts` — filtros/botones directos sin dropdown.
- `apps/frontend/src/app/private/modules/store/accounting/components/bank-reconciliation/bank-accounts.component.ts` — filtros/botones directos sin dropdown.
- `apps/frontend/src/app/private/modules/store/accounting/components/fixed-assets/fixed-assets.component.ts` — filtros/botones directos sin dropdown.
- `apps/frontend/src/app/private/modules/store/reports/pages/report-list/report-list.component.html` — filtros visibles de categorías/búsqueda.
- `skills/vendix-frontend-standard-module/SKILL.md` — documenta el estándar de toolbar.
- `skills/vendix-frontend-data-display/SKILL.md` — documenta relación con acciones de fila y dropdown de acciones de vista.

## Reusable Assets
- `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.ts` — componente existente para agrupar acciones y filtros.
- `apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.interfaces.ts` — contratos compartidos para filtros y acciones.
- `apps/frontend/src/app/shared/components/date-range-picker/date-range-picker.component.ts` — selector reutilizable de rango si se requiere mover filtros de fechas al dropdown.
- `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.html` — referencia actual de toolbar con búsqueda y dropdown.
- `apps/frontend/src/app/private/modules/store/inventory/movements/components/movement-list/movement-list.component.html` — referencia limpia sin botón de acción directo.
- `apps/frontend/src/app/private/modules/organization/invoicing/pages/invoices/org-invoice-list.component.ts` — referencia de ORG_ADMIN con filtros/acciones en dropdown.
- `apps/frontend/src/app/private/modules/super-admin/users/users.component.html` — referencia reciente de Super Admin migrada al patrón.
- `apps/frontend/src/app/shared/components/responsive-data-view/responsive-data-view.component.ts` — mantiene acciones por fila separadas del toolbar.
- `apps/frontend/src/app/shared/components/empty-state/empty-state.component.ts` — conserva acciones de empty state solo cuando no duplican el toolbar.
- `apps/frontend/src/app/shared/components/icon/icons.registry.ts` — fuente autorizada para iconos de acciones migradas.

## Steps
1. Inventariar y clasificar toolbars migrables
   Skills: `vendix-frontend`, `vendix-frontend-standard-module`, `vendix-frontend-data-display`, `vendix-ui-ux`, `vendix-zoneless-signals`
   Resources: `rg -n "<app-options-dropdown|<app-button|<select|app-selector|FilterConfig|filterValues|dropdownActions|vendix-date-range-filter|filters-section|category-filters" apps/frontend/src/app/private/modules/super-admin apps/frontend/src/app/private/modules/organization apps/frontend/src/app/private/modules/store -g '*.ts' -g '*.html'`
   Business decision: solo los toolbars de vistas principales/listados entran al estándar; modales, wizards, formularios, detalles, acciones por fila y POS táctil quedan fuera salvo confirmación explícita.
   Why: va primero porque evita una migración indiscriminada y permite preservar acciones contextuales legítimas.
   Output: checklist de archivos migrables con tipo de cambio: `add-dropdown`, `move-filters`, `move-actions`, `remove-duplicate-button`, `exclude-contextual`.
   Verification: `rg -n "exclude-contextual|remove-duplicate-button|move-filters|move-actions" planning/options-dropdown-toolbar-inventory.md` confirma que el inventario fue materializado antes de editar vistas.

2. Ajustar el componente compartido solo para capacidades faltantes
   Skills: `vendix-frontend-component`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`, `vendix-date-timezone`
   Resources: `sed -n '1,260p' apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.ts` and `sed -n '1,220p' apps/frontend/src/app/shared/components/date-range-picker/date-range-picker.component.ts`
   Business decision: `app-options-dropdown` sigue siendo el único componente de toolbar para acciones/filtros; cualquier soporte faltante se agrega allí reutilizando componentes existentes.
   Why: debe ocurrir antes de migrar pantallas porque los filtros de fecha/rango, disabled states y etiquetas deben comportarse igual en todos los módulos.
   Output: soporte validado para filtros `select`, `multi-select`, `date` y, si el inventario lo requiere, rango de fechas reutilizando `app-date-range-picker`; `triggerLabel`/`title` deben reflejarse de forma consistente o eliminarse si no se usan.
   Verification: `rg -n "date-range|DateRangePickerComponent|triggerLabel\\(\\)|title\\(\\)" apps/frontend/src/app/shared/components/options-dropdown` confirma que la capacidad compartida existe o que no fue necesaria.

3. Migrar toolbars de `SUPER_ADMIN`
   Skills: `vendix-frontend-standard-module`, `vendix-frontend-component`, `vendix-frontend-data-display`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`
   Resources: `rg -n "<app-button|<select|app-selector|app-options-dropdown|FilterConfig|dropdownActions" apps/frontend/src/app/private/modules/super-admin -g '*.ts' -g '*.html'`
   Business decision: Super Admin debe usar una experiencia administrativa compacta: búsqueda visible, filtros en dropdown, acciones de vista en dropdown y sin botones de toolbar duplicados.
   Why: Super Admin es el área con más inconsistencias visibles y debe fijar el estándar antes de replicarlo en ORG_ADMIN.
   Output: migración de los listados Super Admin identificados en `Critical Files`, incluyendo `organizations`, `stores`, `roles`, `audit`, `currencies`, `payment-methods`, `domains`, `legal-documents`, `templates`, `support`, `ai-engine`, `payroll-defaults`, `shipping` y `subscriptions`.
   Verification: `rg -n "<select|app-selector|<app-button" apps/frontend/src/app/private/modules/super-admin -g '*.ts' -g '*.html'` se revisa contra el inventario y solo deja coincidencias marcadas como `exclude-contextual`.

4. Migrar toolbars de `ORG_ADMIN`
   Skills: `vendix-frontend-standard-module`, `vendix-frontend-component`, `vendix-frontend-data-display`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`
   Resources: `rg -n "<app-button|<select|app-selector|app-options-dropdown|FilterConfig|dropdownActions" apps/frontend/src/app/private/modules/organization -g '*.ts' -g '*.html'`
   Business decision: ORG_ADMIN prioriza supervisión densa multi-tienda; los filtros pueden existir, pero deben estar agrupados en dropdown y no ocupar el toolbar como controles sueltos.
   Why: se hace después de Super Admin para aplicar el patrón validado a módulos con más señales/estado local y menos riesgo de duplicar decisiones visuales.
   Output: migración de `users`, `stores`, `orders`, `purchase-orders`, `audit`, `domains`, `roles`, inventario organizacional, invoicing resolutions y páginas de subscriptions con filtros/acciones directas.
   Verification: `rg -n "<select|app-selector|<app-button" apps/frontend/src/app/private/modules/organization -g '*.ts' -g '*.html'` se revisa contra el inventario y solo deja coincidencias marcadas como `exclude-contextual`.

5. Eliminar botones redundantes en `STORE_ADMIN` donde ya existe dropdown
   Skills: `vendix-frontend-standard-module`, `vendix-frontend-data-display`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`
   Resources: `rg -n "<app-options-dropdown|<app-button" apps/frontend/src/app/private/modules/store -g '*.ts' -g '*.html'`
   Business decision: si una acción de vista ya está en `dropdownActions`, no debe existir otro botón de toolbar para la misma acción.
   Why: esta limpieza es más segura que migrar nuevas pantallas porque aprovecha módulos que ya tienen `DropdownAction[]`.
   Output: eliminación de botones duplicados en `products`, `suppliers`, `orders`, `purchase-orders`, `dispatch-notes`, `expenses`, `invoice-list`, `layaway`, `promotions`, payroll lists, `reservations`, settings users/roles/domains y listas de accounting con dropdown.
   Verification: `rg -n "<app-button" apps/frontend/src/app/private/modules/store/products/components/product-list apps/frontend/src/app/private/modules/store/inventory/suppliers/components/supplier-list apps/frontend/src/app/private/modules/store/settings/users -g '*.ts' -g '*.html'` no muestra botones de toolbar duplicados para acciones ya presentes en dropdown.

6. Migrar vistas principales restantes de `STORE_ADMIN` sin dropdown
   Skills: `vendix-frontend-standard-module`, `vendix-frontend-component`, `vendix-frontend-data-display`, `vendix-zoneless-signals`, `vendix-ui-ux`, `vendix-frontend-icons`
   Resources: `rg -n "<app-button|<select|app-selector|filters-section|category-filters|date-range-filter" apps/frontend/src/app/private/modules/store -g '*.ts' -g '*.html'`
   Business decision: las vistas principales de tienda deben compartir el mismo toolbar administrativo; las páginas analíticas o reportes que no sean listados se migran solo cuando el filtro sea parte del toolbar principal.
   Why: se deja para después de limpiar duplicados porque estas pantallas pueden necesitar mapear filtros locales o reportes a `FilterConfig`.
   Output: migración de vistas sin dropdown como `cash-registers`, `data-collection`, `marketing/coupons`, `marketing/anuncios`, accounting bank/chart/fixed-assets, `reports` list y settings payment/legal/shipping lists cuando aplique.
   Verification: `rg -n "filters-section|category-filters|<select|app-selector" apps/frontend/src/app/private/modules/store -g '*.ts' -g '*.html'` se revisa contra el inventario y solo deja coincidencias marcadas como `exclude-contextual`.

7. Actualizar estándar y skills
   Skills: `skill-creator`, `skill-sync`, `vendix-frontend-standard-module`, `vendix-frontend-data-display`
   Resources: `./skills/skill-sync/assets/sync.sh` and `./skills/setup.sh --sync`
   Business decision: este patrón transversal debe quedar documentado en la skill existente de módulos estándar, no en una skill nueva, salvo que el usuario prefiera separarlo.
   Why: va después de validar la migración porque la documentación debe reflejar el código real final.
   Output: `skills/vendix-frontend-standard-module/SKILL.md` documenta “búsqueda visible + `app-options-dropdown`”, eliminación de botones duplicados y límites de alcance; provider copies quedan sincronizadas.
   Verification: `rg -n "app-options-dropdown|botones duplicados|dropdownActions|FilterConfig" skills/vendix-frontend-standard-module/SKILL.md .agents/skills/vendix-frontend-standard-module/SKILL.md AGENTS.md` confirma la guía actualizada/sincronizada.

8. Verificar compilación y experiencia visual
   Skills: `buildcheck-dev`, `vendix-zoneless-signals`, `vendix-ui-ux`
   Resources: `docker logs --tail 80 vendix_frontend`, `docker ps`, `apps/frontend/scripts/zoneless-audit.sh`, `Browser plugin: http://localhost:4200/super-admin/users`, `Browser plugin: http://localhost:4200/super-admin/organizations`, `Browser plugin: http://localhost:4200/admin/users`
   Business decision: no se considera terminado si el frontend watch mode reporta errores o si una ruta representativa conserva filtros/botones de toolbar fuera del dropdown.
   Why: cierra la migración con señales técnicas y visuales en las tres apps afectadas.
   Output: frontend sin errores relevantes, contenedores activos, y revisión visual de rutas representativas de `SUPER_ADMIN`, `ORG_ADMIN` y `STORE_ADMIN`.
   Verification: `docker logs --tail 80 vendix_frontend` no muestra errores Angular/TypeScript/template, `docker ps` muestra `vendix_frontend` running, y `apps/frontend/scripts/zoneless-audit.sh` no reporta nuevos bloqueos.

## End-to-End Verification
1. Abrir en navegador autenticado `/super-admin/organizations`, `/super-admin/stores`, `/super-admin/roles`, `/super-admin/subscriptions/plans` y confirmar que el toolbar muestra búsqueda + dropdown, sin filtros/botones directos duplicados.
2. Abrir `/admin/users`, `/admin/stores`, `/admin/orders`, `/admin/inventory/locations`, `/admin/purchase-orders` en contexto ORG_ADMIN y confirmar filtros/acciones dentro de dropdown.
3. Abrir `/admin/products`, `/admin/inventory/suppliers`, `/admin/orders/sales`, `/admin/settings/users`, `/admin/settings/roles`, `/admin/cash-registers` en STORE_ADMIN y confirmar que acciones de crear/refrescar/exportar/importar están en dropdown y no duplicadas en botones de toolbar.
4. Ejecutar `docker logs --tail 80 vendix_frontend` y `docker ps`.
5. Ejecutar `apps/frontend/scripts/zoneless-audit.sh`.

## Knowledge Gaps
- Toolbar dropdown standard: el patrón existe en código, pero no está suficientemente documentado como regla obligatoria. Propongo actualizar `vendix-frontend-standard-module` en la ejecución; si prefieres una skill separada, el nombre sugerido sería `vendix-frontend-toolbar-actions`.

## Approval Request
This plan is ready for human review. Reply **"ejecuta"**, **"apruebo"**, or **"procede"** to start execution under `how-to-dev`. Reply with corrections to revise the plan in place.
