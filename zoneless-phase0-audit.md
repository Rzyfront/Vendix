# PHASE 0 BASELINE AUDIT - Zoneless Migration

**Date:** Fri Apr 17 2026

---

## Conteos objetivo = 0

| Metric                                 | Count | Target |
| -------------------------------------- | ----- | ------ |
| @Input()/@Output() files               | 0     | 0      |
| EventEmitter files                     | 0     | 0      |
| NgZone files (excluding app.config.ts) | 0     | 0      |
| markForCheck/detectChanges files       | 0     | 0      |
| *ngIf/*ngFor/\*ngSwitch in HTML        | 0     | 0      |
| take(1) files                          | 19    | 0      |
| zone.js in build/serve/server          | 1     | 0      |

---

## Conteos objetivo: ≥244

| Metric                                    | Count | Target |
| ----------------------------------------- | ----- | ------ |
| input()/output()/model() signal API files | 100   | ≥244   |

---

## .subscribe() sin gestión

| Metric                                                 | Count |
| ------------------------------------------------------ | ----- |
| Files with .subscribe()                                | 295   |
| Files with takeUntilDestroyed or firstValueFrom        | 194   |
| .subscribe() WITHOUT takeUntilDestroyed/firstValueFrom | 108   |

---

## BehaviorSubject/Subject files

29 files found:

1. apps/frontend/src/app/private/modules/store/help/help-center/help-center.component.ts
2. apps/frontend/src/app/private/modules/store/reservations/components/reservation-form-modal/reservation-form-modal.component.ts
3. apps/frontend/src/app/private/modules/store/quotations/components/quotation-form-modal/quotation-form-modal.component.ts
4. apps/frontend/src/app/private/modules/store/payroll/components/payroll-runs/payroll-run-detail/payroll-run-detail.component.ts
5. apps/frontend/src/app/private/modules/store/reservations/components/calendar/quick-book-from-slot-modal/quick-book-from-slot-modal.component.ts
6. apps/frontend/src/app/private/modules/store/habeas-data/habeas-data.component.ts
7. apps/frontend/src/app/private/modules/store/inventory/pop/components/pop-product-selection.component.ts
8. apps/frontend/src/app/private/modules/super-admin/monitoring/services/monitoring.service.ts
9. apps/frontend/src/app/core/interceptors/auth.interceptor.ts
10. apps/frontend/src/app/private/modules/store/pos/services/pos-payment.service.ts
11. apps/frontend/src/app/private/modules/store/pos/components/pos-shipping-modal/pos-shipping-modal.component.ts
12. apps/frontend/src/app/private/modules/store/pos/components/pos-product-search.component.ts
13. apps/frontend/src/app/private/modules/store/pos/services/pos-scale.service.ts
14. apps/frontend/src/app/private/modules/store/pos/components/pos-customer-modal.component.ts
15. apps/frontend/src/app/private/modules/store/pos/services/pos-keyboard.service.ts
16. apps/frontend/src/app/private/modules/store/pos/components/pos-product-selection.component.ts
17. apps/frontend/src/app/shared/components/help-search-overlay/help-search-overlay.component.ts
18. apps/frontend/src/app/shared/components/options-dropdown/options-dropdown.component.ts
19. apps/frontend/src/app/shared/components/inputsearch/inputsearch.component.ts
20. apps/frontend/src/app/private/modules/ecommerce/services/store-ui.service.ts
21. apps/frontend/src/app/private/modules/ecommerce/services/cart.service.ts
22. apps/frontend/src/app/private/modules/ecommerce/services/wishlist.service.ts
23. apps/frontend/src/app/private/modules/super-admin/support/support.component.ts
24. apps/frontend/src/app/private/modules/ecommerce/pages/catalog/catalog.component.ts
25. apps/frontend/src/app/private/modules/super-admin/stores/stores.component.ts
26. apps/frontend/src/app/private/modules/super-admin/roles/components/role-permissions-modal.component.ts
27. apps/frontend/src/app/private/modules/super-admin/roles/roles.component.ts
28. apps/frontend/src/app/private/modules/super-admin/payment-methods/payment-methods.component.ts
29. apps/frontend/src/app/private/modules/super-admin/users/users.component.ts
30. apps/frontend/src/app/private/modules/ecommerce/components/search-autocomplete/search-autocomplete.component.ts
31. apps/frontend/src/app/private/modules/organization/users/users.component.ts
32. apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts

---

## Heurística: Variables planas de UI state

50 matches found:

| File                                                           | Line     | Code                                                                                                                  |
| -------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| store/marketing/promotions/promotion-list.component.ts         | 189      | searchTerm = ''                                                                                                       |
| store/products/products.component.ts                           | 159      | searchTerm = ''                                                                                                       |
| store/payroll/employees/employee-list.component.ts             | 67       | searchTerm = ''                                                                                                       |
| store/payroll/payroll-runs/payroll-run-list.component.ts       | 68       | searchTerm = ''                                                                                                       |
| store/payroll/settlements/settlement-list.component.ts         | 61       | searchTerm = ''                                                                                                       |
| store/settings/roles/store-roles-list.component.ts             | 161      | searchTerm = ''                                                                                                       |
| store/settings/roles/store-role-permissions-modal.component.ts | 304      | searchTerm = ''                                                                                                       |
| store/settings/roles/store-roles-settings.component.ts         | 128      | searchTerm = ''                                                                                                       |
| organization/orders/orders-list.component.ts                   | 54-60    | searchTerm, selectedStatus, selectedPaymentStatus, selectedStore, selectedOrderType, selectedDateFrom, selectedDateTo |
| store/exogenous/exogenous.component.ts                         | 111      | selectedFormat = '1007'                                                                                               |
| store/inventory/movements/movement-list.component.ts           | 49       | searchTerm = ''                                                                                                       |
| organization/users/users.component.ts                          | 190      | pagination = {...}                                                                                                    |
| store/inventory/operations/bulk-adjustment-modal.component.ts  | 317-318  | selected_location_id, selected_adjustment_type                                                                        |
| organization/audit/logs/logs.component.ts                      | 134      | pagination = {...}                                                                                                    |
| store/inventory/operations/adjustment-list.component.ts        | 62       | searchTerm = ''                                                                                                       |
| store/products/product-list.component.ts                       | 78-82    | searchTerm, selectedState, selectedCategory, selectedBrand, selectedProductType                                       |
| store/orders/purchase-orders/purchase-order-list.component.ts  | 77-78    | searchTerm, selectedStatus                                                                                            |
| store/inventory/transfers/transfer-list.component.ts           | 162      | searchTerm = ''                                                                                                       |
| store/inventory/transfers/transfers.component.ts               | 141      | searchTerm = ''                                                                                                       |
| store/quotations/quotations.component.ts                       | 103      | searchTerm = ''                                                                                                       |
| store/inventory/pop/pop-summary.component.ts                   | 189      | selectedPaymentPreset = ''                                                                                            |
| store/dispatch-notes/dispatch-note-list.component.ts           | 82, 101  | selected_status = '', filter_values = {}                                                                              |
| super-admin/audit/audit.component.ts                           | 73       | pagination = {...}                                                                                                    |
| store/pos/pos-ticket-printer.component.ts                      | 420      | selectedPrinter = ''                                                                                                  |
| super-admin/currencies/currencies.component.ts                 | 79       | pagination = {...}                                                                                                    |
| super-admin/stores/stores.component.ts                         | 85-87    | searchTerm, selectedOrganization, pagination                                                                          |
| super-admin/users/users.component.ts                           | 121      | pagination = {...}                                                                                                    |
| super-admin/organizations/organizations.component.ts           | 211-213  | searchTerm, selectedStatus, selectedMode                                                                              |
| super-admin/domains/domains.component.ts                       | 205      | searchTerm = ''                                                                                                       |
| super-admin/support/support.component.ts                       | 96       | pagination = {...}                                                                                                    |
| super-admin/templates/templates.component.ts                   | 191, 299 | searchTerm, pagination                                                                                                |

---

## Heurística: Signal sin invocar

1 match found:

| File                                                         | Line | Code                       |
| ------------------------------------------------------------ | ---- | -------------------------- |
| shared/components/setting-toggle/setting-toggle.component.ts | 109  | if (this.disabled) return; |

---

## Heurística: toSignal sin initialValue en facades

50+ matches found across multiple facades:

### base.facade.ts (3)

- Line 21: `readonly data = toSignal(this.data$);`
- Line 23: `readonly error = toSignal(this.error$);`
- Line 24: `readonly lastUpdated = toSignal(this.lastUpdated$);`

### ai-chat.facade.ts (3)

- Line 26: `readonly activeConversationId = toSignal(this.activeConversationId$);`
- Line 28: `readonly streamingContent = toSignal(this.streamingContent$);`
- Line 32: `readonly error = toSignal(this.error$);`

### auth.facade.ts (22)

- Lines 135-176: 22 instances of `toSignal(this.xxx$)` without initialValue

### config.facade.ts (3)

- Line 25: `readonly appConfig = toSignal(this.appConfig$);`
- Line 27: `readonly error = toSignal(this.error$);`
- Line 28: `readonly domainConfig = toSignal(this.domainConfig$);`

### global.facade.ts (8)

- Lines 36-44: 8 instances of `toSignal(this.xxx$)` without initialValue

### tenant.facade.ts (10+)

- Lines 75-84+: 10+ instances of `toSignal(this.xxx$)` without initialValue

---

## angular.json zone.js check

| Section            | Count | Target |
| ------------------ | ----- | ------ |
| build/serve/server | 1     | 0      |
| test               | 1     | ≥1     |

---

## | async pipe files

0 files found

---

## Summary

### Already Clean (Target = 0, Achieved = 0)

- @Input()/@Output() ✅
- EventEmitter ✅
- NgZone (excluding app.config.ts) ✅
- markForCheck/detectChanges ✅
- *ngIf/*ngFor/\*ngSwitch in HTML ✅
- | async pipe ✅

### Needs Work

| Metric                          | Current | Target | Gap  |
| ------------------------------- | ------- | ------ | ---- |
| take(1) files                   | 19      | 0      | -19  |
| input()/output()/model() files  | 100     | ≥244   | +144 |
| zone.js in build/serve/server   | 1       | 0      | -1   |
| .subscribe() without management | 108     | 0      | -108 |
| BehaviorSubject/Subject files   | 32      | 0      | -32  |
| Flat UI state variables         | 50+     | 0      | -50+ |
| Signal sin invocar              | 1       | 0      | -1   |
| toSignal without initialValue   | 50+     | 0      | -50+ |
