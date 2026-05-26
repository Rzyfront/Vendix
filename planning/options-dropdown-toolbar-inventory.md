# Inventario de toolbars para `app-options-dropdown`

Este inventario acompaña `planning/options-dropdown-toolbar-standardization-plan.md`.
El objetivo es separar acciones/filtros globales del listado de acciones contextuales de fila, modales y estados vacíos.

## Criterios

- `remove-duplicate-button`: quitar botón primario visible en el header cuando la misma acción ya existe en `app-options-dropdown`.
- `move-filters`: mover filtros del header/cuerpo superior al dropdown de filtros.
- `move-actions`: mover acciones globales del header al dropdown de acciones.
- `add-dropdown`: agregar `app-options-dropdown` donde el listado principal aún expone filtros/acciones sueltas.
- `exclude-contextual`: conservar acciones de fila, botones dentro de modales, detalles, flujos guiados y CTA de empty-state.

## SuperAdmin

- `super-admin/users`: ya migrado. `move-filters`, `move-actions`.
- `super-admin/stores`: `move-filters`, `move-actions`.
- `super-admin/organizations`: `move-filters`, `move-actions`.
- `super-admin/domains`: `move-actions`.
- `super-admin/legal-documents`: `move-filters`, `move-actions`.
- `super-admin/ai-engine`: `move-filters`, `move-actions` por cada panel principal.
- `super-admin/payroll-defaults`: `move-actions`.
- `super-admin/shipping/*`: `move-actions`.
- `super-admin/subscriptions/*`: `move-filters`, `move-actions`, revisar por vista.
- `super-admin/templates`: `move-filters`, `move-actions`.
- `super-admin/support`, `audit`, `currencies`, `payment-methods`, `help-center`: `add-dropdown` cuando sean vistas principales con acciones globales.

## OrgAdmin

- `organization/users`, `organization/stores`, `organization/orders`: `move-filters`, `move-actions`.
- `organization/purchase-orders/pages/list`: `move-filters`, `move-actions`.
- `organization/audit/logs`, `organization/audit/sessions`, `organization/audit/login-attempts`: `move-filters`, `move-actions`.
- `organization/domains`, `organization/roles`: `remove-duplicate-button`, `move-actions`.
- `organization/inventory/pages/locations`, `suppliers`, `transfers`, `adjustments`: `remove-duplicate-button`, `move-filters`, `move-actions`.
- `organization/invoicing/pages/resolutions`: `remove-duplicate-button`, `move-actions`.
- `organization/config/payment-methods`: `move-actions`.
- `organization/subscriptions/*`: `move-filters`, `move-actions` donde aplique.

## StoreAdmin

- `store/products/components/product-list`: `remove-duplicate-button`.
- `store/inventory/suppliers/components/supplier-list`: `remove-duplicate-button`.
- `store/inventory/transfers/components/transfer-list`: `remove-duplicate-button`.
- `store/settings/users`: `remove-duplicate-button`, `move-actions` al dropdown existente.
- `store/payroll/components/settlements/settlement-list`: `remove-duplicate-button`.
- `store/settings/roles`, `store/settings/domains`, `store/customers/components/customer-list`: `remove-duplicate-button`.
- `store/inventory/operations/components/adjustment-list`: ya usa dropdown sin botón duplicado.
- `store/dispatch-notes/components/dispatch-note-list`: ya usa dropdown sin botón duplicado.
- `store/invoicing/components/invoice-list`: ya usa dropdown sin botón duplicado.
- `store/payroll/components/employees`, `payroll-runs`, `advances`: ya usan dropdown en header. `exclude-contextual` para empty-state.
- `store/accounting/components/budgets/budget-list`: ya usa dropdown. Revisar solo si aparece botón duplicado en header.

## Exclusiones

- `exclude-contextual`: botones dentro de modales, formularios, páginas detalle, acciones de fila de `ResponsiveDataView`, tabs, selectores de alcance fiscal/tienda y CTAs de empty-state permanecen fuera del dropdown.
- `exclude-contextual`: filtros complejos que no encajan en `select`, `multi-select` o `date` quedan visibles hasta ampliar el componente compartido.
