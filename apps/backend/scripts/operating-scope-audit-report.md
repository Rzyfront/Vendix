# Operating Scope Audit Report — 2026-05-03T23:42:33.995Z

> Auditoría reproducible Phase 0 del contrato `operating_scope` (STORE vs ORGANIZATION).
> Generado por `apps/backend/scripts/operating-scope-audit.ts`.

## Summary

- Total DTOs con `store_id` en body: **48**
- Servicios sin OperatingScopeService: **188** (de 195 servicios bajo domains/store y domains/organization)
- Usos de `withoutScope()`: **121**
- Violaciones regla cero ORG_ADMIN → `/store/*`: **26**
- Violaciones regla cero STORE_ADMIN → `/organization/*`: **1**

## 1. DTOs con `store_id` en body

| File | Line | DTO | Required |
|------|------|-----|----------|
| apps/backend/src/domains/superadmin/support/dto/superadmin-ticket-query.dto.ts | 21 | SuperadminTicketQueryDto | no |
| apps/backend/src/domains/superadmin/subscriptions/dto/assign-promo-plan.dto.ts | 27 | AssignPromoPlanDto | no |
| apps/backend/src/domains/superadmin/subscriptions/dto/subscription-query.dto.ts | 39 | SubscriptionQueryDto | no |
| apps/backend/src/domains/superadmin/organizations/dto/index.ts | 192 | OrganizationDashboardDto | no |
| apps/backend/src/domains/store/taxes/dto/index.ts | 55 | CreateTaxCategoryDto | yes |
| apps/backend/src/domains/store/taxes/dto/index.ts | 85 | UpdateTaxCategoryDto | no |
| apps/backend/src/domains/store/taxes/dto/index.ts | 115 | TaxCategoryQueryDto | no |
| apps/backend/src/domains/store/taxes/dto/index.ts | 164 | TaxCalculationDto | yes |
| apps/backend/src/domains/store/suppliers/dto/supplier-query.dto.ts | 35 | SupplierQueryDto | no |
| apps/backend/src/domains/store/products/dto/index.ts | 179 | CreateProductDto | no |
| apps/backend/src/domains/store/products/dto/index.ts | 636 | ProductQueryDto | no |
| apps/backend/src/domains/store/payroll/payroll-runs/dto/create-payroll-run.dto.ts | 28 | CreatePayrollRunDto | no |
| apps/backend/src/domains/store/payments/dto/create-pos-payment.dto.ts | 159 | CreatePosPaymentDto | yes |
| apps/backend/src/domains/store/orders/sales-orders/dto/sales-order-query.dto.ts | 20 | SalesOrderQueryDto | no |
| apps/backend/src/domains/store/orders/return-orders/dto/create-return-order.dto.ts | 81 | CreateReturnOrderDto | no |
| apps/backend/src/domains/store/orders/return-orders/dto/return-order-query.dto.ts | 65 | ReturnOrderQueryDto | no |
| apps/backend/src/domains/store/orders/purchase-orders/dto/purchase-order-query.dto.ts | 21 | PurchaseOrderQueryDto | no |
| apps/backend/src/domains/store/orders/dto/create-order.dto.ts | 77 | CreateOrderDto | yes |
| apps/backend/src/domains/store/orders/dto/order-query.dto.ts | 52 | OrderQueryDto | no |
| apps/backend/src/domains/store/inventory/suppliers/dto/supplier-query.dto.ts | 14 | SupplierQueryDto | no |
| apps/backend/src/domains/store/inventory/movements/dto/movement-query.dto.ts | 20 | MovementQueryDto | no |
| apps/backend/src/domains/store/inventory/locations/dto/create-location.dto.ts | 20 | CreateLocationDto | no |
| apps/backend/src/domains/store/inventory/locations/dto/location-query.dto.ts | 20 | LocationQueryDto | no |
| apps/backend/src/domains/store/addresses/dto/index.ts | 92 | CreateAddressDto | no |
| apps/backend/src/domains/store/addresses/dto/index.ts | 213 | AddressQueryDto | no |
| apps/backend/src/domains/store/accounting/reports/dto/report-query.dto.ts | 12 | ReportQueryDto | no |
| apps/backend/src/domains/store/accounting/journal-entries/dto/create-journal-entry.dto.ts | 71 | CreateJournalEntryDto | no |
| apps/backend/src/domains/store/accounting/journal-entries/dto/query-journal-entry.dto.ts | 61 | QueryJournalEntryDto | no |
| apps/backend/src/domains/store/accounting/fixed-assets/dto/create-fixed-asset.dto.ts | 61 | CreateFixedAssetDto | no |
| apps/backend/src/domains/store/accounting/fixed-assets/dto/query-fixed-assets.dto.ts | 21 | QueryFixedAssetsDto | no |
| apps/backend/src/domains/store/accounting/consolidation/dto/create-adjustment.dto.ts | 33 | CreateAdjustmentDto | no |
| apps/backend/src/domains/store/accounting/consolidation/dto/query-transactions.dto.ts | 8 | QueryTransactionsDto | no |
| apps/backend/src/domains/store/accounting/budgets/dto/create-budget.dto.ts | 34 | CreateBudgetDto | no |
| apps/backend/src/domains/store/accounting/budgets/dto/query-budget.dto.ts | 17 | QueryBudgetDto | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/dto/create-bank-account.dto.ts | 40 | CreateBankAccountDto | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/dto/query-bank-account.dto.ts | 16 | QueryBankAccountDto | no |
| apps/backend/src/domains/store/accounting/account-mappings/dto/upsert-account-mapping.dto.ts | 30 | UpsertAccountMappingDto | no |
| apps/backend/src/domains/store/accounting/account-mappings/dto/upsert-account-mapping.dto.ts | 37 | ResetAccountMappingDto | no |
| apps/backend/src/domains/organization/users/dto/users-dashboard.dto.ts | 8 | UsersDashboardDto | no |
| apps/backend/src/domains/organization/onboarding/dto/onboarding-status.dto.ts | 19 | StoreOnboardingStatusDto | yes |
| apps/backend/src/domains/organization/onboarding/dto/onboarding-status.dto.ts | 41 | CompleteStoreOnboardingDto | yes |
| apps/backend/src/domains/organization/login-attempts/dto/index.ts | 52 | LoginAttemptsQueryDto | no |
| apps/backend/src/domains/organization/domains/dto/domain-settings.dto.ts | 501 | CreateDomainSettingDto | no |
| apps/backend/src/domains/organization/addresses/dto/index.ts | 88 | CreateAddressDto | no |
| apps/backend/src/domains/organization/addresses/dto/index.ts | 209 | AddressQueryDto | no |
| apps/backend/src/domains/auth/dto/login-customer.dto.ts | 27 | LoginCustomerDto | yes |
| apps/backend/src/domains/auth/dto/register-customer.dto.ts | 82 | RegisterCustomerDto | yes |
| apps/backend/src/domains/auth/dto/register-staff.dto.ts | 60 | RegisterStaffDto | no |

## 2. Servicios sin OperatingScopeService

Lista completa de servicios bajo `apps/backend/src/domains/store` y `apps/backend/src/domains/organization`. Columna `Injects` indica si su constructor inyecta `OperatingScopeService`.

### 2.1 No inyectan (candidatos a refactor)

| File | Service | Injects |
|------|---------|---------|
| apps/backend/src/domains/store/withholding-tax/withholding-calculator.service.ts | WithholdingCalculatorService | no |
| apps/backend/src/domains/store/withholding-tax/withholding-tax.service.ts | WithholdingTaxService | no |
| apps/backend/src/domains/store/wallet/wallet.service.ts | WalletService | no |
| apps/backend/src/domains/store/wallet/services/wallet-balance.service.ts | WalletBalanceService | no |
| apps/backend/src/domains/store/taxes/ica.service.ts | IcaService | no |
| apps/backend/src/domains/store/taxes/taxes.service.ts | TaxesService | no |
| apps/backend/src/domains/store/suppliers/suppliers.service.ts | SuppliersService | no |
| apps/backend/src/domains/store/subscriptions/services/partner-commissions.service.ts | PartnerCommissionsService | no |
| apps/backend/src/domains/store/subscriptions/services/promotional-apply.service.ts | PromotionalApplyService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-access.service.ts | SubscriptionAccessService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-billing.service.ts | SubscriptionBillingService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-fraud.service.ts | SubscriptionFraudService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-invoice-pdf.service.ts | SubscriptionInvoicePdfService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-manual-payment.service.ts | SubscriptionManualPaymentService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-payment-methods.service.ts | SubscriptionPaymentMethodsService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-payment.service.ts | SubscriptionPaymentService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-proration.service.ts | SubscriptionProrationService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-redemption.service.ts | SubscriptionRedemptionService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-resolver.service.ts | SubscriptionResolverService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-state.service.ts | SubscriptionStateService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-support-request.service.ts | SubscriptionSupportRequestService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-trial.service.ts | SubscriptionTrialService | no |
| apps/backend/src/domains/store/subscriptions/services/subscription-webhook.service.ts | SubscriptionWebhookService | no |
| apps/backend/src/domains/store/stores/stores.service.ts | StoresService | no |
| apps/backend/src/domains/store/store-users/store-user-management.service.ts | StoreUserManagementService | no |
| apps/backend/src/domains/store/store-users/store-users.service.ts | StoreUsersService | no |
| apps/backend/src/domains/store/shipping/shipping-calculator.service.ts | ShippingCalculatorService | no |
| apps/backend/src/domains/store/shipping/shipping.service.ts | ShippingService | no |
| apps/backend/src/domains/store/shipping/services/store-shipping-methods.service.ts | StoreShippingMethodsService | no |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | StoreShippingZonesService | no |
| apps/backend/src/domains/store/settings/schedule-validation.service.ts | ScheduleValidationService | no |
| apps/backend/src/domains/store/settings/settings.service.ts | SettingsService | no |
| apps/backend/src/domains/store/roles/store-roles.service.ts | StoreRolesService | no |
| apps/backend/src/domains/store/reviews/reviews.service.ts | ReviewsService | no |
| apps/backend/src/domains/store/reservations/availability.service.ts | AvailabilityService | no |
| apps/backend/src/domains/store/reservations/booking-confirmation.service.ts | BookingConfirmationService | no |
| apps/backend/src/domains/store/reservations/reservations.service.ts | ReservationsService | no |
| apps/backend/src/domains/store/reservations/providers/provider-schedule.service.ts | ProviderScheduleService | no |
| apps/backend/src/domains/store/reservations/providers/providers.service.ts | ProvidersService | no |
| apps/backend/src/domains/store/reports/payroll/payroll-reports.service.ts | PayrollReportsService | no |
| apps/backend/src/domains/store/quotations/quotations.service.ts | QuotationsService | no |
| apps/backend/src/domains/store/promotions/promotions.service.ts | PromotionsService | no |
| apps/backend/src/domains/store/promotions/promotion-engine/promotion-engine.service.ts | PromotionEngineService | no |
| apps/backend/src/domains/store/products/products-bulk-image.service.ts | ProductsBulkImageService | no |
| apps/backend/src/domains/store/products/products-bulk.service.ts | ProductsBulkService | no |
| apps/backend/src/domains/store/products/products.service.ts | ProductsService | no |
| apps/backend/src/domains/store/products/services/price-resolver.service.ts | PriceResolverService | no |
| apps/backend/src/domains/store/products/services/product-variant.service.ts | ProductVariantService | no |
| apps/backend/src/domains/store/payroll/settlements/settlement-calculation.service.ts | SettlementCalculationService | no |
| apps/backend/src/domains/store/payroll/settlements/settlement-flow.service.ts | SettlementFlowService | no |
| apps/backend/src/domains/store/payroll/settlements/settlements.service.ts | SettlementsService | no |
| apps/backend/src/domains/store/payroll/paystubs/paystub.service.ts | PaystubService | no |
| apps/backend/src/domains/store/payroll/payroll-runs/payroll-flow.service.ts | PayrollFlowService | no |
| apps/backend/src/domains/store/payroll/payroll-runs/payroll-runs.service.ts | PayrollRunsService | no |
| apps/backend/src/domains/store/payroll/employees/employees-bulk.service.ts | EmployeesBulkService | no |
| apps/backend/src/domains/store/payroll/employees/employees.service.ts | EmployeesService | no |
| apps/backend/src/domains/store/payroll/calculation/payroll-calculation.service.ts | PayrollCalculationService | no |
| apps/backend/src/domains/store/payroll/calculation/payroll-rules.service.ts | PayrollRulesService | no |
| apps/backend/src/domains/store/payroll/bank-export/payroll-bank-export.service.ts | PayrollBankExportService | no |
| apps/backend/src/domains/store/payroll/advances/advances.service.ts | AdvancesService | no |
| apps/backend/src/domains/store/payments/payments.service.ts | PaymentsService | no |
| apps/backend/src/domains/store/payments/services/organization-payment-policies.service.ts | OrganizationPaymentPoliciesService | no |
| apps/backend/src/domains/store/payments/services/payment-encryption.service.ts | PaymentEncryptionService | no |
| apps/backend/src/domains/store/payments/services/payment-gateway.service.ts | PaymentGatewayService | no |
| apps/backend/src/domains/store/payments/services/payment-validator.service.ts | PaymentValidatorService | no |
| apps/backend/src/domains/store/payments/services/store-payment-methods.service.ts | StorePaymentMethodsService | no |
| apps/backend/src/domains/store/payments/services/system-payment-methods.service.ts | SystemPaymentMethodsService | no |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | WebhookHandlerService | no |
| apps/backend/src/domains/store/payments/services/wompi-reconciliation.service.ts | WompiReconciliationService | no |
| apps/backend/src/domains/store/payments/services/wompi-webhook-validator.service.ts | WompiWebhookValidatorService | no |
| apps/backend/src/domains/store/payment-links/payment-links.service.ts | PaymentLinksService | no |
| apps/backend/src/domains/store/orders/orders.service.ts | OrdersService | no |
| apps/backend/src/domains/store/orders/services/order-eta.service.ts | OrderEtaService | no |
| apps/backend/src/domains/store/orders/sales-orders/sales-orders.service.ts | SalesOrdersService | no |
| apps/backend/src/domains/store/orders/return-orders/return-orders.service.ts | ReturnOrdersService | no |
| apps/backend/src/domains/store/orders/purchase-orders/invoice-scanner.service.ts | InvoiceScannerService | no |
| apps/backend/src/domains/store/orders/purchase-orders/purchase-orders.service.ts | PurchaseOrdersService | no |
| apps/backend/src/domains/store/orders/order-flow/order-flow.service.ts | OrderFlowService | no |
| apps/backend/src/domains/store/orders/order-flow/services/refund-calculation.service.ts | RefundCalculationService | no |
| apps/backend/src/domains/store/orders/order-flow/services/refund-flow.service.ts | RefundFlowService | no |
| apps/backend/src/domains/store/notifications/notifications-push.service.ts | NotificationsPushService | no |
| apps/backend/src/domains/store/notifications/notifications-sse.service.ts | NotificationsSseService | no |
| apps/backend/src/domains/store/notifications/notifications.service.ts | NotificationsService | no |
| apps/backend/src/domains/store/metadata/metadata-fields.service.ts | MetadataFieldsService | no |
| apps/backend/src/domains/store/metadata/metadata-values.service.ts | MetadataValuesService | no |
| apps/backend/src/domains/store/mcp/mcp-audit.service.ts | McpAuditService | no |
| apps/backend/src/domains/store/mcp/mcp-auth.service.ts | McpAuthService | no |
| apps/backend/src/domains/store/legal-documents/services/store-legal-documents.service.ts | StoreLegalDocumentsService | no |
| apps/backend/src/domains/store/layaway/layaway.service.ts | LayawayService | no |
| apps/backend/src/domains/store/invoicing/invoicing.service.ts | InvoicingService | no |
| apps/backend/src/domains/store/invoicing/services/invoice-pdf.service.ts | InvoicePdfService | no |
| apps/backend/src/domains/store/invoicing/services/invoice-retry-queue.service.ts | InvoiceRetryQueueService | no |
| apps/backend/src/domains/store/invoicing/resolutions/resolutions.service.ts | ResolutionsService | no |
| apps/backend/src/domains/store/invoicing/providers/invoice-provider-resolver.service.ts | invoice-provider-resolver.service.ts | no |
| apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-response-parser.service.ts | DianResponseParserService | no |
| apps/backend/src/domains/store/invoicing/providers/dian-direct/dian-xml-signer.service.ts | DianXmlSignerService | no |
| apps/backend/src/domains/store/invoicing/invoice-flow/invoice-flow.service.ts | InvoiceFlowService | no |
| apps/backend/src/domains/store/invoicing/invoice-data-requests/invoice-data-requests.service.ts | InvoiceDataRequestsService | no |
| apps/backend/src/domains/store/invoicing/dian-config/dian-config.service.ts | DianConfigService | no |
| apps/backend/src/domains/store/invoicing/dian-config/dian-test.service.ts | DianTestService | no |
| apps/backend/src/domains/store/invoicing/credit-notes/credit-notes.service.ts | CreditNotesService | no |
| apps/backend/src/domains/store/inventory/transactions/inventory-transactions.service.ts | InventoryTransactionsService | no |
| apps/backend/src/domains/store/inventory/stock-levels/stock-levels.service.ts | StockLevelsService | no |
| apps/backend/src/domains/store/inventory/shared/services/costing.service.ts | CostingService | no |
| apps/backend/src/domains/store/inventory/shared/services/inventory-integration.service.ts | InventoryIntegrationService | no |
| apps/backend/src/domains/store/inventory/shared/services/stock-validator.service.ts | StockValidatorService | no |
| apps/backend/src/domains/store/inventory/services/inventory-validation.service.ts | InventoryValidationService | no |
| apps/backend/src/domains/store/inventory/serial-numbers/inventory-serial-numbers.service.ts | InventorySerialNumbersService | no |
| apps/backend/src/domains/store/inventory/movements/movements.service.ts | MovementsService | no |
| apps/backend/src/domains/store/inventory/locations/locations.service.ts | LocationsService | no |
| apps/backend/src/domains/store/inventory/batches/inventory-batches.service.ts | InventoryBatchesService | no |
| apps/backend/src/domains/store/inventory/adjustments/inventory-adjustments-bulk.service.ts | InventoryAdjustmentsBulkService | no |
| apps/backend/src/domains/store/inventory/adjustments/inventory-adjustments.service.ts | InventoryAdjustmentsService | no |
| apps/backend/src/domains/store/expenses/expenses.service.ts | ExpensesService | no |
| apps/backend/src/domains/store/expenses/expense-flow/expense-flow.service.ts | ExpenseFlowService | no |
| apps/backend/src/domains/store/exogenous/exogenous-file-builder.service.ts | ExogenousFileBuilderService | no |
| apps/backend/src/domains/store/exogenous/exogenous-generator.service.ts | ExogenousGeneratorService | no |
| apps/backend/src/domains/store/exogenous/exogenous-validator.service.ts | ExogenousValidatorService | no |
| apps/backend/src/domains/store/exogenous/exogenous.service.ts | ExogenousService | no |
| apps/backend/src/domains/store/ecommerce/ecommerce.service.ts | EcommerceService | no |
| apps/backend/src/domains/store/domains/domains.service.ts | StoreDomainsService | no |
| apps/backend/src/domains/store/dispatch-notes/dispatch-notes.service.ts | DispatchNotesService | no |
| apps/backend/src/domains/store/dispatch-notes/dispatch-note-flow/dispatch-note-flow.service.ts | DispatchNoteFlowService | no |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | SubmissionsService | no |
| apps/backend/src/domains/store/data-collection/templates.service.ts | TemplatesService | no |
| apps/backend/src/domains/store/customers/customer-lookup.service.ts | CustomerLookupService | no |
| apps/backend/src/domains/store/customers/customers-bulk.service.ts | CustomersBulkService | no |
| apps/backend/src/domains/store/customers/customers.service.ts | CustomersService | no |
| apps/backend/src/domains/store/customers/history/customer-history.service.ts | CustomerHistoryService | no |
| apps/backend/src/domains/store/customer-queue/customer-queue.service.ts | CustomerQueueService | no |
| apps/backend/src/domains/store/coupons/coupons.service.ts | CouponsService | no |
| apps/backend/src/domains/store/consultations/consultations.service.ts | ConsultationsService | no |
| apps/backend/src/domains/store/commissions/commissions.service.ts | CommissionsService | no |
| apps/backend/src/domains/store/commissions/services/commission-calculator.service.ts | CommissionCalculatorService | no |
| apps/backend/src/domains/store/categories/categories.service.ts | CategoriesService | no |
| apps/backend/src/domains/store/cash-registers/cash-registers.service.ts | CashRegistersService | no |
| apps/backend/src/domains/store/cash-registers/sessions/sessions.service.ts | SessionsService | no |
| apps/backend/src/domains/store/cash-registers/movements/movements.service.ts | MovementsService | no |
| apps/backend/src/domains/store/brands/brands.service.ts | BrandsService | no |
| apps/backend/src/domains/store/analytics/services/customers-analytics.service.ts | CustomersAnalyticsService | no |
| apps/backend/src/domains/store/analytics/services/financial-analytics.service.ts | FinancialAnalyticsService | no |
| apps/backend/src/domains/store/analytics/services/overview-analytics.service.ts | OverviewAnalyticsService | no |
| apps/backend/src/domains/store/analytics/services/products-analytics.service.ts | ProductsAnalyticsService | no |
| apps/backend/src/domains/store/analytics/services/sales-analytics.service.ts | SalesAnalyticsService | no |
| apps/backend/src/domains/store/ai-chat/ai-chat.service.ts | AIChatService | no |
| apps/backend/src/domains/store/addresses/addresses.service.ts | AddressesService | no |
| apps/backend/src/domains/store/accounts-receivable/accounts-receivable.service.ts | AccountsReceivableService | no |
| apps/backend/src/domains/store/accounts-receivable/services/ar-aging.service.ts | ArAgingService | no |
| apps/backend/src/domains/store/accounts-receivable/services/ar-collection.service.ts | ArCollectionService | no |
| apps/backend/src/domains/store/accounts-receivable/services/payment-agreement.service.ts | PaymentAgreementService | no |
| apps/backend/src/domains/store/accounts-payable/accounts-payable.service.ts | AccountsPayableService | no |
| apps/backend/src/domains/store/accounts-payable/services/ap-aging.service.ts | ApAgingService | no |
| apps/backend/src/domains/store/accounts-payable/services/ap-bank-export.service.ts | ApBankExportService | no |
| apps/backend/src/domains/store/accounts-payable/services/ap-scheduling.service.ts | ApSchedulingService | no |
| apps/backend/src/domains/store/accounting/reports/accounting-reports.service.ts | AccountingReportsService | no |
| apps/backend/src/domains/store/accounting/journal-entries/journal-entries.service.ts | JournalEntriesService | no |
| apps/backend/src/domains/store/accounting/journal-entries/journal-entry-flow.service.ts | JournalEntryFlowService | no |
| apps/backend/src/domains/store/accounting/fixed-assets/depreciation-calculator.service.ts | DepreciationCalculatorService | no |
| apps/backend/src/domains/store/accounting/fixed-assets/fixed-asset-categories.service.ts | FixedAssetCategoriesService | no |
| apps/backend/src/domains/store/accounting/fixed-assets/fixed-assets.service.ts | FixedAssetsService | no |
| apps/backend/src/domains/store/accounting/consolidation/consolidated-reports.service.ts | ConsolidatedReportsService | no |
| apps/backend/src/domains/store/accounting/consolidation/consolidation.service.ts | ConsolidationService | no |
| apps/backend/src/domains/store/accounting/consolidation/intercompany-detection.service.ts | IntercompanyDetectionService | no |
| apps/backend/src/domains/store/accounting/budgets/budget-variance.service.ts | BudgetVarianceService | no |
| apps/backend/src/domains/store/accounting/budgets/budgets.service.ts | BudgetsService | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/bank-accounts.service.ts | BankAccountsService | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/bank-transactions.service.ts | BankTransactionsService | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/digital-payment-matcher.service.ts | DigitalPaymentMatcherService | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/reconciliation-matching.service.ts | ReconciliationMatchingService | no |
| apps/backend/src/domains/store/accounting/bank-reconciliation/reconciliation.service.ts | ReconciliationService | no |
| apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts | AccountMappingService | no |
| apps/backend/src/domains/organization/users/users.service.ts | UsersService | no |
| apps/backend/src/domains/organization/stores/stores.service.ts | StoresService | no |
| apps/backend/src/domains/organization/settings/settings.service.ts | SettingsService | no |
| apps/backend/src/domains/organization/sessions/sessions.service.ts | SessionsService | no |
| apps/backend/src/domains/organization/roles/roles.service.ts | RolesService | no |
| apps/backend/src/domains/organization/reseller/partner-plans/partner-plans.service.ts | PartnerPlansService | no |
| apps/backend/src/domains/organization/reseller/partner-commissions/partner-commissions.service.ts | PartnerCommissionsService | no |
| apps/backend/src/domains/organization/reseller/partner-branding/partner-branding.service.ts | PartnerBrandingService | no |
| apps/backend/src/domains/organization/payment-policies/payment-policies.service.ts | PaymentPoliciesService | no |
| apps/backend/src/domains/organization/organizations/organizations.service.ts | OrganizationsService | no |
| apps/backend/src/domains/organization/orders/organization-orders.service.ts | OrganizationOrdersService | no |
| apps/backend/src/domains/organization/onboarding/onboarding-wizard.service.ts | OnboardingWizardService | no |
| apps/backend/src/domains/organization/onboarding/onboarding.service.ts | OnboardingService | no |
| apps/backend/src/domains/organization/login-attempts/login-attempts.service.ts | LoginAttemptsService | no |
| apps/backend/src/domains/organization/domains/domains.service.ts | DomainsService | no |
| apps/backend/src/domains/organization/audit/audit.service.ts | OrganizationAuditService | no |
| apps/backend/src/domains/organization/addresses/addresses.service.ts | AddressesService | no |

### 2.2 Sí inyectan (referencia consistente)

| File | Service | Injects |
|------|---------|---------|
| apps/backend/src/domains/store/orders/stock-transfers/stock-transfers.service.ts | StockTransfersService | yes |
| apps/backend/src/domains/store/inventory/suppliers/suppliers.service.ts | SuppliersService | yes |
| apps/backend/src/domains/store/inventory/shared/services/stock-level-manager.service.ts | stock-level-manager.service.ts | yes |
| apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts | InventoryAnalyticsService | yes |
| apps/backend/src/domains/store/accounting/fiscal-periods/fiscal-periods.service.ts | FiscalPeriodsService | yes |
| apps/backend/src/domains/store/accounting/chart-of-accounts/chart-of-accounts.service.ts | ChartOfAccountsService | yes |
| apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts | AutoEntryService | yes |

## 3. `prisma.withoutScope()` usages

| File | Line | Snippet |
|------|------|---------|
| apps/backend/src/jobs/email-notifications.processor.ts | 31 | `*     store, organization, plan) using `withoutScope()` since this worker has` |
| apps/backend/src/jobs/email-notifications.processor.ts | 183 | `.withoutScope()` |
| apps/backend/src/jobs/email-notifications.processor.ts | 196 | `const store = await this.prisma.withoutScope().stores.findUnique({` |
| apps/backend/src/jobs/email-notifications.processor.ts | 406 | `const store = await this.prisma.withoutScope().stores.findUnique({` |
| apps/backend/src/jobs/email-notifications.processor.ts | 425 | `? await this.prisma.withoutScope().store_subscriptions.findUnique({` |
| apps/backend/src/jobs/email-notifications.processor.ts | 429 | `: await this.prisma.withoutScope().store_subscriptions.findFirst({` |
| apps/backend/src/jobs/payment-method-expiry-notifier.job.ts | 83 | `.withoutScope()` |
| apps/backend/src/jobs/payment-method-expiry-notifier.job.ts | 135 | `.withoutScope()` |
| apps/backend/src/jobs/payment-method-expiry-notifier.job.ts | 181 | `await this.prisma.withoutScope().subscription_events.create({` |
| apps/backend/src/jobs/payment-method-expiry-notifier.job.ts | 254 | `.withoutScope()` |
| apps/backend/src/jobs/payment-method-expiry-notifier.job.ts | 299 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 46 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 56 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 93 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 106 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 118 | `const newSubs = await this.prisma.withoutScope().subscription_events.count({` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 130 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 146 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 161 | `.withoutScope()` |
| apps/backend/src/jobs/saas-metrics-snapshot.job.ts | 175 | `await this.prisma.withoutScope().saas_metrics_snapshot.upsert({` |
| apps/backend/src/jobs/subscription-draft-cleanup.job.ts | 43 | `.withoutScope()` |
| apps/backend/src/jobs/subscription-trial-notifier.job.ts | 60 | `const subs = await this.prisma.withoutScope().store_subscriptions.findMany({` |
| apps/backend/src/jobs/subscription-trial-notifier.job.ts | 87 | `.withoutScope()` |
| apps/backend/src/jobs/subscription-trial-notifier.job.ts | 124 | `await this.prisma.withoutScope().subscription_events.create({` |
| apps/backend/src/jobs/subscription-webhook-reconciler.job.ts | 116 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/services/subscription-fraud.service.ts | 34 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/services/subscription-payment.service.ts | 394 | `await this.prisma.withoutScope().$transaction(` |
| apps/backend/src/domains/store/subscriptions/services/subscription-webhook.service.ts | 122 | `const txResult = await this.prisma.withoutScope().$transaction(` |
| apps/backend/src/domains/store/subscriptions/services/subscription-webhook.service.ts | 364 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/services/subscription-webhook.service.ts | 386 | `const dedupResult = await this.prisma.withoutScope().$transaction(` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-accounting.listener.ts | 57 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-accounting.listener.ts | 81 | `const store = await this.prisma.withoutScope().stores.findUnique({` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-accounting.listener.ts | 175 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-state.listener.ts | 134 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-state.listener.ts | 155 | `await this.prisma.withoutScope().store_subscriptions.update({` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-state.listener.ts | 191 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-state.listener.ts | 216 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/listeners/subscription-state.listener.ts | 495 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/jobs/reconcile-stuck-pending.job.ts | 80 | `.withoutScope()` |
| apps/backend/src/domains/store/subscriptions/jobs/reconcile-stuck-pending.job.ts | 138 | `await this.prisma.withoutScope().$transaction(` |
| apps/backend/src/domains/store/subscriptions/jobs/reconcile-stuck-pending.job.ts | 279 | `.withoutScope()` |
| apps/backend/src/domains/store/shipping/services/store-shipping-methods.service.ts | 34 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-methods.service.ts | 119 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-methods.service.ts | 382 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 23 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 43 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 109 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 232 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 343 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 419 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 494 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 532 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 631 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/shipping/services/store-shipping-zones.service.ts | 670 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/settings/email-templates.controller.ts | 40 | `.withoutScope()` |
| apps/backend/src/domains/store/reservations/booking-confirmation.service.ts | 75 | `.withoutScope()` |
| apps/backend/src/domains/store/reservations/booking-confirmation.service.ts | 88 | `await this.prisma.withoutScope().booking_confirmation_tokens.update({` |
| apps/backend/src/domains/store/reservations/booking-confirmation.service.ts | 94 | `await this.prisma.withoutScope().bookings.update({` |
| apps/backend/src/domains/store/reservations/booking-confirmation.service.ts | 100 | `await this.prisma.withoutScope().bookings.update({` |
| apps/backend/src/domains/store/products/services/product-variant.service.ts | 508 | `const unscopedPrisma = this.prisma.withoutScope() as any;` |
| apps/backend/src/domains/store/payroll/employees/employees-bulk.service.ts | 407 | `const unscoped = this.prisma.withoutScope() as any;` |
| apps/backend/src/domains/store/payroll/employees/employees-bulk.service.ts | 838 | `const unscopedUpload = this.prisma.withoutScope() as any;` |
| apps/backend/src/domains/store/payroll/employees/employees.service.ts | 120 | `const unscoped = this.prisma.withoutScope() as any;` |
| apps/backend/src/domains/store/payroll/employees/employees.service.ts | 166 | `const is_customer = await this.prisma.withoutScope().users.findFirst({` |
| apps/backend/src/domains/store/payroll/employees/employees.service.ts | 291 | `.withoutScope()` |
| apps/backend/src/domains/store/payroll/employees/employees.service.ts | 495 | `const unscoped = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payroll/employees/employees.service.ts | 512 | `const unscoped = this.prisma.withoutScope() as any;` |
| apps/backend/src/domains/store/payments/services/store-payment-methods.service.ts | 160 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 51 | `const inserted = await this.prisma.withoutScope().$executeRaw<number>(` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 193 | `*    in a single `prisma.withoutScope().$transaction()` so two concurrent` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 220 | `.withoutScope()` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 359 | `const client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 404 | `const client = tx ?? this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 463 | `const client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 579 | `const client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payments/services/webhook-handler.service.ts | 666 | `const client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payments/services/wompi-reconciliation.service.ts | 35 | `*  - Uses `prisma.withoutScope()` (no tenant context in cron — webhook` |
| apps/backend/src/domains/store/payments/services/wompi-reconciliation.service.ts | 126 | `// Cron has no tenant context: use withoutScope() to bypass scope` |
| apps/backend/src/domains/store/payments/services/wompi-reconciliation.service.ts | 128 | `const stalePayments = await this.prisma.withoutScope().payments.findMany({` |
| apps/backend/src/domains/store/payments/services/wompi-webhook-validator.service.ts | 61 | `const baseClient = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/payment-links/payment-links.service.ts | 181 | `this.prisma.withoutScope() as any` |
| apps/backend/src/domains/store/payment-links/payment-links.service.ts | 193 | `await (this.prisma.withoutScope() as any).payment_links.update({` |
| apps/backend/src/domains/store/metadata/metadata-values.service.ts | 73 | `const unscoped = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/metadata/metadata-values.service.ts | 151 | `return this.prisma.withoutScope().entity_metadata_values.findMany({` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 143 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 185 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 229 | `await this.prisma.withoutScope().data_collection_submissions.update({` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 243 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 268 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 321 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 443 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 449 | `await this.prisma.withoutScope().data_collection_submissions.update({` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 635 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/submissions.service.ts | 650 | `.withoutScope()` |
| apps/backend/src/domains/store/data-collection/listeners/booking-data-collection.listener.ts | 26 | `const product = await this.prisma.withoutScope().products.findUnique({` |
| apps/backend/src/domains/store/cash-registers/movements/movements.service.ts | 85 | `return this.prisma.withoutScope().cash_register_movements.create({` |
| apps/backend/src/domains/store/cash-registers/movements/movements.service.ts | 114 | `return this.prisma.withoutScope().cash_register_movements.create({` |
| apps/backend/src/domains/store/analytics/services/customers-analytics.service.ts | 140 | `const results = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/analytics/services/customers-analytics.service.ts | 158 | `const cumulativeBefore = await (this.prisma.withoutScope() as any)` |
| apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts | 392 | `const baseClient = this.prisma.withoutScope() as any;` |
| apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts | 607 | `// withoutScope() needed: $queryRaw is not available on the scoped client.` |
| apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts | 609 | `const results = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts | 652 | `// withoutScope() needed: $queryRaw is not available on the scoped client.` |
| apps/backend/src/domains/store/analytics/services/inventory-analytics.service.ts | 654 | `const results = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/analytics/services/overview-analytics.service.ts | 121 | `const salesResults = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/analytics/services/overview-analytics.service.ts | 145 | `const expenseResults = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/analytics/services/products-analytics.service.ts | 419 | `const results = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/analytics/services/sales-analytics.service.ts | 529 | `// withoutScope() needed: $queryRaw is not available on the scoped client.` |
| apps/backend/src/domains/store/analytics/services/sales-analytics.service.ts | 531 | `const results = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/store/accounting/budgets/budget-variance.service.ts | 229 | `const rows = await this.prisma.withoutScope().$queryRaw<ActualRow[]>`` |
| apps/backend/src/domains/store/accounting/auto-entries/accounting-events.listener.ts | 61 | `.withoutScope()` |
| apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts | 90 | `? await this.prisma.withoutScope().accounting_entities.findFirst({` |
| apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts | 496 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts | 586 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts | 713 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts | 785 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/store/accounting/account-mappings/account-mapping.service.ts | 835 | `const base_client = this.prisma.withoutScope();` |
| apps/backend/src/domains/organization/organizations/organizations.service.ts | 463 | `(this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/organization/organizations/organizations.service.ts | 507 | `(this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/domains/organization/organizations/organizations.service.ts | 614 | `const rows = await (this.prisma.withoutScope() as any).$queryRaw<` |
| apps/backend/src/common/guards/module-flow.guard.ts | 54 | `.withoutScope()` |

## 4. Violaciones regla cero ORG_ADMIN → `/store/*`

Servicios/archivos bajo `apps/frontend/src/app/private/modules/organization/**` que contienen string literals con `/store/`.

| File | Line | URL detectada |
|------|------|---------------|
| apps/frontend/src/app/private/modules/organization/users/components/user-config-modal.component.ts | 21 | `../../../../../core/store/auth/auth.facade` |
| apps/frontend/src/app/private/modules/organization/subscriptions/services/org-subscriptions.service.ts | 32 | `${environment.apiUrl}/store/subscriptions/current/invoices` |
| apps/frontend/src/app/private/modules/organization/subscriptions/services/org-subscriptions.service.ts | 36 | `${environment.apiUrl}/store/subscriptions/current/invoices/${invoiceId}` |
| apps/frontend/src/app/private/modules/organization/subscriptions/services/org-subscriptions.service.ts | 45 | `${environment.apiUrl}/store/subscriptions/current/invoices/${invoiceId}/pdf` |
| apps/frontend/src/app/private/modules/organization/subscriptions/services/org-subscriptions.service.ts | 51 | `${environment.apiUrl}/store/subscriptions/plans` |
| apps/frontend/src/app/private/modules/organization/subscriptions/services/org-subscriptions.service.ts | 55 | `${environment.apiUrl}/store/subscriptions/checkout/preview` |
| apps/frontend/src/app/private/modules/organization/subscriptions/services/org-subscriptions.service.ts | 59 | `${environment.apiUrl}/store/subscriptions/checkout/commit` |
| apps/frontend/src/app/private/modules/organization/subscriptions/pages/payment-methods/subscription-payment-methods.component.ts | 12 | `../../../../store/settings/payments/services/payment-methods.service` |
| apps/frontend/src/app/private/modules/organization/subscriptions/pages/payment-methods/subscription-payment-methods.component.ts | 13 | `../../../../store/settings/payments/interfaces/payment-methods.interface` |
| apps/frontend/src/app/private/modules/organization/subscriptions/pages/overview/org-subscriptions-overview.component.ts | 16 | `../../../../../../core/store/tenant/tenant.facade` |
| apps/frontend/src/app/private/modules/organization/subscriptions/components/usage-tracker/usage-tracker.component.ts | 116 | `${environment.apiUrl}/store/subscriptions/usage` |
| apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts | 18 | `../../../../../../private/modules/store/settings/general/components/general-settings-form/general-settings-form.component` |
| apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts | 19 | `../../../../../../private/modules/store/settings/general/components/app-settings-form/app-settings-form.component` |
| apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts | 20 | `../../../../../../private/modules/store/settings/general/components/inventory-settings-form/inventory-settings-form.component` |
| apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts | 21 | `../../../../../../private/modules/store/settings/general/components/notifications-settings-form/notifications-settings-form.component` |
| apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts | 22 | `../../../../../../private/modules/store/settings/general/components/pos-settings-form/pos-settings-form.component` |
| apps/frontend/src/app/private/modules/organization/stores/components/store-configuration-modal/store-configuration-modal.component.ts | 23 | `../../../../../../private/modules/store/settings/general/components/receipts-settings-form/receipts-settings-form.component` |
| apps/frontend/src/app/private/modules/organization/orders/orders.routes.ts | 21 | `../../store/orders/purchase-orders/purchase-orders.component` |
| apps/frontend/src/app/private/modules/organization/orders/components/order-create-modal.component.ts | 1002 | `/private/store/inventory/transfers` |
| apps/frontend/src/app/private/modules/organization/orders/components/order-create-modal.component.ts | 1023 | `${environment.apiUrl}/store/orders` |
| apps/frontend/src/app/private/modules/organization/orders/components/order-create-modal.component.ts | 1025 | `${environment.apiUrl}/store/orders/sales-orders` |
| apps/frontend/src/app/private/modules/organization/orders/components/order-create-modal.component.ts | 1027 | `${environment.apiUrl}/store/orders/purchase-orders` |
| apps/frontend/src/app/private/modules/organization/orders/components/order-create-modal.component.ts | 1029 | `${environment.apiUrl}/store/orders/return-orders` |
| apps/frontend/src/app/private/modules/organization/domains/services/organization-domains.service.ts | 144 | `${this.apiUrl}/organization/domains/store/${storeId}` |
| apps/frontend/src/app/private/modules/organization/dashboard/dashboard.component.ts | 14 | `../../../../core/store/global.facade` |
| apps/frontend/src/app/private/modules/organization/config/payment-methods/services/payment-methods.service.ts | 46 | `${environment.apiUrl}/store/payment-methods` |

## 5. Violaciones regla cero STORE_ADMIN → `/organization/*`

Servicios/archivos bajo `apps/frontend/src/app/private/modules/store/**` que contienen string literals con `/organization/`.

| File | Line | URL detectada |
|------|------|---------------|
| apps/frontend/src/app/private/modules/store/accounting/components/account-mappings/account-mappings.component.ts | 387 | `/organization/settings` |

## Limitaciones

- La detección de `store_id` en DTOs usa una regex sobre la línea del campo. DTOs que declaren el tipo en formato no estándar (multi-línea, generics, alias de tipo) pueden no ser detectados.
- La auditoría de inyección de `OperatingScopeService` busca su nombre en el archivo y un patrón de constructor; servicios que lo usen indirectamente vía otro service helper aparecerán como "no inyecta". Verificación manual recomendada.
- El escaneo de `withoutScope()` excluye los servicios prisma base (donde la implementación vive). Cualquier nuevo helper que envuelva `withoutScope` quedará fuera del alcance.
- La detección de URLs cruzadas analiza solo string literals en una línea; concatenaciones multilinea (template strings con interpolaciones partidas) pueden quedar fuera.
- Los DTOs tipo Response (sufijo `Response` o `ResponseDto`) son excluidos para evitar falsos positivos sobre payloads de respuesta.
- El allowlist de DTOs legítimos (`CreateStoreDto`, `UpdateStoreDto`) es manual; ampliar según se descubran más casos legítimos en revisión.
