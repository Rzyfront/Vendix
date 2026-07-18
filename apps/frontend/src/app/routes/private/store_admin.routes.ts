import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { AuthGuard } from '../../core/guards/auth.guard';
import { fiscalManagementGuard } from '../../core/guards/fiscal-management.guard';
import { onboardingGuard } from '../../core/guards/onboarding.guard';
import { subscriptionManagementGuard } from '../../core/guards/subscription-management.guard';
import { manageUsersGuard } from '../../core/guards/manage-users.guard';
import { invoicingReducer } from '../../private/modules/store/invoicing/state/reducers/invoicing.reducer';
import { InvoicingEffects } from '../../private/modules/store/invoicing/state/effects/invoicing.effects';
import { couponReducer } from '../../private/modules/store/marketing/coupons/state/reducers/coupon.reducer';
import { CouponEffects } from '../../private/modules/store/marketing/coupons/state/effects/coupon.effects';
import { storeUsersReducer } from '../../private/modules/store/settings/users/state/reducers/store-users.reducer';
import { StoreUsersEffects } from '../../private/modules/store/settings/users/state/effects/store-users.effects';
import { layawayReducer } from '../../private/modules/store/layaway/state/reducers/layaway.reducer';
import { LayawayEffects } from '../../private/modules/store/layaway/state/effects/layaway.effects';

export const storeAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () =>
      import('../../private/layouts/store-admin/store-admin-layout.component').then(
        (c) => c.StoreAdminLayoutComponent,
      ),
    canActivate: [AuthGuard, onboardingGuard],
    // canActivateChild re-runs onboardingGuard on EVERY child navigation
    // (including sibling→sibling SPA nav where the parent `admin` stays
    // mounted and its canActivate would NOT re-fire). This is what makes the
    // owner onboarding truly unavoidable, not just on hard reload.
    canActivateChild: [onboardingGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      // Owner onboarding host — gated by `onboardingGuard` on the `admin`
      // root. Only an OWNER with `organizations.onboarding !== true` ever
      // resolves here; everyone else is bounced to the dashboard.
      {
        path: 'onboarding',
        loadComponent: () =>
          import('../../private/pages/onboarding/onboarding-page.component').then(
            (m) => m.OnboardingPageComponent,
          ),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('../../private/modules/store/dashboard/dashboard.component').then(
            (c) => c.DashboardComponent,
          ),
      },
      // POS Routes
      {
        path: 'pos',
        providers: [
          provideState({ name: 'invoicing', reducer: invoicingReducer }),
          provideEffects(InvoicingEffects),
        ],
        loadComponent: () =>
          import('../../private/modules/store/pos/pos.component').then(
            (c) => c.PosComponent,
          ),
      },
      // Products Routes
      {
        path: 'products',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('../../private/modules/store/products/products.component').then(
                (c) => c.ProductsComponent,
              ),
          },
          {
            path: 'create',
            loadComponent: () =>
              import('../../private/modules/store/products/pages/product-create-page/product-create-page.component').then(
                (c) => c.ProductCreatePageComponent,
              ),
          },
          {
            path: 'edit/:id',
            loadComponent: () =>
              import('../../private/modules/store/products/pages/product-create-page/product-create-page.component').then(
                (c) => c.ProductCreatePageComponent,
              ),
          },
          {
            path: 'categories',
            loadComponent: () =>
              import('../../private/modules/store/products/pages/categories-page/categories-page.component').then(
                (c) => c.CategoriesPageComponent,
              ),
          },
          {
            path: 'brands',
            loadComponent: () =>
              import('../../private/modules/store/products/pages/brands-page/brands-page.component').then(
                (c) => c.BrandsPageComponent,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('../../private/modules/store/products/components/product-details/product-details.component').then(
                (c) => c.ProductDetailsComponent,
              ),
          },
        ],
      },
      // Inventory Routes
      {
        path: 'inventory',
        loadComponent: () =>
          import('../../private/modules/store/inventory/inventory.component').then(
            (c) => c.InventoryComponent,
          ),
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'pop',
          },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('../../private/modules/store/inventory/inventory-dashboard.component').then(
                (c) => c.InventoryDashboardComponent,
              ),
          },
          // Punto de Compra (POP) - Creating purchase orders
          {
            path: 'pop',
            loadComponent: () => {
              return import('../../private/modules/store/inventory/pop/pop.component').then(
                (c) => c.PopComponent,
              );
            },
          },
          {
            path: 'pop/:id',
            loadComponent: () => {
              return import('../../private/modules/store/inventory/pop/pop.component').then(
                (c) => c.PopComponent,
              );
            },
          },
          {
            path: 'suppliers',
            loadComponent: () =>
              import('../../private/modules/store/inventory/suppliers/suppliers.component').then(
                (c) => c.SuppliersComponent,
              ),
          },
          /* Orders removed (moved to Orders module) */
          {
            path: 'locations',
            loadComponent: () =>
              import('../../private/modules/store/inventory/locations/locations.component').then(
                (c) => c.LocationsComponent,
              ),
          },
          {
            path: 'adjustments',
            loadComponent: () =>
              import('../../private/modules/store/inventory/operations/stock-adjustments.component').then(
                (c) => c.StockAdjustmentsComponent,
              ),
          },
          {
            path: 'transfers',
            loadComponent: () =>
              import('../../private/modules/store/inventory/transfers/transfers.component').then(
                (c) => c.TransfersComponent,
              ),
          },
          {
            path: 'movements',
            loadComponent: () =>
              import('../../private/modules/store/inventory/movements/movements.component').then(
                (c) => c.MovementsComponent,
              ),
          },
        ],
      },
      // Serial Numbers (Números de Serie) — self-contained module, sibling of
      // the inventory route block so it stays decoupled from InventoryComponent.
      {
        path: 'inventory/serials',
        loadChildren: () =>
          import(
            '../../private/modules/store/serial-numbers/routes/serial-numbers.routes'
          ).then((m) => m.serialNumbersRoutes),
      },
      // Orders Routes
      {
        path: 'orders',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'sales',
          },
          {
            path: 'sales',
            loadComponent: () =>
              import('../../private/modules/store/orders/orders/orders.component').then(
                (c) => c.OrdersComponent,
              ),
          },
          {
            path: 'purchase-orders',
            loadComponent: () =>
              import('../../private/modules/store/orders/purchase-orders/purchase-orders.component').then(
                (c) => c.PurchaseOrdersComponent,
              ),
          },
          {
            path: 'purchase-orders/:id',
            loadComponent: () =>
              import('../../private/modules/store/orders/purchase-orders/pages/detail/purchase-order-detail.component').then(
                (c) => c.StorePurchaseOrderDetailComponent,
              ),
          },
          {
            path: 'quotations',
            loadComponent: () =>
              import('../../private/modules/store/quotations/quotations.component').then(
                (c) => c.QuotationsComponent,
              ),
          },
          {
            path: 'quotations/:id',
            loadComponent: () =>
              import('../../private/modules/store/quotations/pages/quotation-detail/quotation-detail.component').then(
                (c) => c.QuotationDetailComponent,
              ),
          },
          {
            path: 'layaway',
            loadComponent: () =>
              import('../../private/modules/store/layaway/layaway.component').then(
                (c) => c.LayawayComponent,
              ),
            providers: [
              provideState('layaway', layawayReducer),
              provideEffects(LayawayEffects),
            ],
          },
          {
            path: 'layaway/:id',
            loadComponent: () =>
              import('../../private/modules/store/layaway/pages/layaway-detail-page/layaway-detail-page.component').then(
                (c) => c.LayawayDetailPageComponent,
              ),
            providers: [
              provideState('layaway', layawayReducer),
              provideEffects(LayawayEffects),
            ],
          },
          {
            path: 'dispatch-notes',
            loadComponent: () =>
              import('../../private/modules/store/dispatch-notes/dispatch-notes.component').then(
                (c) => c.DispatchNotesComponent,
              ),
          },
          {
            path: 'dispatch-notes/:id',
            loadComponent: () =>
              import('../../private/modules/store/dispatch-notes/pages/dispatch-note-detail-page/dispatch-note-detail-page.component').then(
                (c) => c.DispatchNoteDetailPageComponent,
              ),
          },
          {
            path: 'planillas',
            loadComponent: () =>
              import('../../private/modules/store/planillas-rutas/planillas-rutas.component').then(
                (c) => c.PlanillasRutasComponent,
              ),
          },
          {
            path: 'planillas/:id',
            loadComponent: () =>
              import('../../private/modules/store/planillas-rutas/pages/planilla-detail-page/planilla-detail-page.component').then(
                (c) => c.PlanillaDetailPageComponent,
              ),
          },
          {
            path: 'fleet',
            loadComponent: () =>
              import('../../private/modules/store/fleet/fleet.component').then(
                (c) => c.FleetComponent,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('../../private/modules/store/orders/pages/order-details/order-details-page.component').then(
                (c) => c.OrderDetailsPageComponent,
              ),
          },
        ],
      },
      // Reservations Routes
      {
        path: 'reservations',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('../../private/modules/store/reservations/reservations.component').then(
                (c) => c.ReservationsComponent,
              ),
          },
          {
            path: 'schedules',
            loadComponent: () =>
              import('../../private/modules/store/reservations/components/schedule-management/schedule-management.component').then(
                (c) => c.ScheduleManagementComponent,
              ),
          },
          {
            path: 'availability',
            loadComponent: () =>
              import(
                '../../private/modules/store/reservations/components/provider-availability/provider-availability.component'
              ).then((c) => c.ProviderAvailabilityComponent),
          },
          {
            path: 'queue',
            loadComponent: () =>
              import(
                '../../private/modules/store/reservations/components/appointment-queue-panel/appointment-queue-panel.component'
              ).then((c) => c.AppointmentQueuePanelComponent),
          },
          {
            path: 'business-hours',
            loadComponent: () =>
              import(
                '../../private/modules/store/reservations/components/business-hours/business-hours.component'
              ).then((c) => c.BusinessHoursComponent),
          },
        ],
      },
      // Consultations Routes
      {
        path: 'consultations',
        loadChildren: () =>
          import('../../private/modules/store/consultations/consultations.routes').then(
            (r) => r.CONSULTATIONS_ROUTES,
          ),
      },
      // Data Collection Routes
      {
        path: 'data-collection',
        loadChildren: () =>
          import('../../private/modules/store/data-collection/data-collection.routes').then(
            (r) => r.DATA_COLLECTION_ROUTES,
          ),
      },
      // Customers Routes
      {
        path: 'customers',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'all',
          },
          {
            path: 'all',
            loadComponent: () =>
              import('../../private/modules/store/customers/customers.component').then(
                (c) => c.CustomersComponent,
              ),
          },
          {
            path: 'reviews',
            loadComponent: () =>
              import('../../private/modules/store/customers/reviews/reviews.component').then(
                (c) => c.ReviewsComponent,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('../../private/modules/store/customers/details/customer-details.component').then(
                (c) => c.CustomerDetailsComponent,
              ),
          },
        ],
      },
      // PQR Routes (Peticiones, Quejas y Reclamos) — store_admin only
      {
        path: 'pqrs',
        loadChildren: () =>
          import(
            '../../private/modules/store/pqr/pqr.routes'
          ).then((m) => m.pqrRoutes),
      },
      // Marketing Routes
      {
        path: 'marketing',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'promotions',
          },
          {
            path: 'promotions',
            loadChildren: () =>
              import('../../private/modules/store/marketing/promotions/promotions.routes').then(
                (m) => m.promotionsRoutes,
              ),
          },
          {
            path: 'coupons',
            loadComponent: () =>
              import('../../private/modules/store/marketing/coupons/coupons.component').then(
                (c) => c.CouponsComponent,
              ),
            providers: [
              provideState('coupons', couponReducer),
              provideEffects(CouponEffects),
            ],
          },
          {
            path: 'anuncios',
            loadChildren: () =>
              import('../../private/modules/store/marketing/anuncios/anuncios.routes').then(
                (m) => m.anunciosRoutes,
              ),
          },
          {
            path: 'social-sales',
            loadComponent: () =>
              import('../../private/modules/store/marketing/social-sales/social-sales.component').then(
                (c) => c.SocialSalesComponent,
              ),
          },
        ],
      },
      // Analytics Routes
      {
        path: 'analytics',
        loadChildren: () =>
          import('../../private/modules/store/analytics/analytics.routes').then(
            (m) => m.analyticsRoutes,
          ),
      },
      // Reports Routes
      {
        path: 'reports',
        loadChildren: () =>
          import('../../private/modules/store/reports/reports.routes').then(
            (m) => m.reportsRoutes,
          ),
      },
      {
        path: 'fiscal',
        data: { fiscalApiScope: 'store' },
        loadChildren: () =>
          import('../../private/modules/fiscal-operations/fiscal-operations.routes').then(
            (m) => m.fiscalOperationsRoutes,
          ),
      },
      // E-commerce Routes
      {
        path: 'ecommerce',
        loadComponent: () =>
          import('../../private/modules/store/ecommerce/ecommerce.component').then(
            (c) => c.EcommerceComponent,
          ),
      },
      // Settings Routes
      {
        path: 'settings',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'general',
          },
          {
            path: 'general',
            loadComponent: () =>
              import('../../private/modules/store/settings/general/general-settings.component').then(
                (c) => c.GeneralSettingsComponent,
              ),
          },
          {
            path: 'payments',
            loadComponent: () =>
              import('../../private/modules/store/settings/payments/payments-settings.component').then(
                (c) => c.PaymentsSettingsComponent,
              ),
          },
          {
            path: 'shipping',
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('../../private/modules/store/settings/shipping/pages/shipping-dashboard/shipping-dashboard.component').then(
                    (c) => c.ShippingDashboardComponent,
                  ),
              },
              {
                path: ':methodId',
                loadComponent: () =>
                  import('../../private/modules/store/settings/shipping/pages/method-detail/method-detail.component').then(
                    (c) => c.MethodDetailComponent,
                  ),
              },
            ],
          },
          {
            path: 'appearance',
            loadComponent: () =>
              import('../../private/modules/store/settings/appearance/appearance-settings.component').then(
                (c) => c.AppearanceSettingsComponent,
              ),
          },
          {
            path: 'security',
            loadComponent: () =>
              import('../../private/modules/store/settings/security/security-settings.component').then(
                (c) => c.SecuritySettingsComponent,
              ),
          },
          {
            path: 'domains/:id/setup',
            loadComponent: () =>
              import('../../private/modules/store/settings/domains/domain-setup-page.component').then(
                (c) => c.DomainSetupPageComponent,
              ),
          },
          {
            path: 'domains',
            loadComponent: () =>
              import('../../private/modules/store/settings/domains/store-domains.component').then(
                (c) => c.StoreDomainsComponent,
              ),
          },

          {
            path: 'legal-documents',
            loadComponent: () =>
              import('../../private/modules/store/settings/legal-documents/legal-documents.component').then(
                (c) => c.LegalDocumentsComponent,
              ),
          },
          {
            path: 'users',
            canActivate: [manageUsersGuard],
            loadComponent: () =>
              import('../../private/modules/store/settings/users/store-users-settings.component').then(
                (c) => c.StoreUsersSettingsComponent,
              ),
            providers: [
              provideState('storeUsers', storeUsersReducer),
              provideEffects(StoreUsersEffects),
            ],
          },
          {
            path: 'roles',
            loadComponent: () =>
              import('../../private/modules/store/settings/roles/store-roles-settings.component').then(
                (c) => c.StoreRolesSettingsComponent,
              ),
          },
          {
            path: 'fiscal/wizard',
            redirectTo: '/admin/fiscal/wizard',
            pathMatch: 'full',
          },
          {
            path: 'fiscal',
            redirectTo: '/admin/fiscal',
            pathMatch: 'full',
          },
          {
            path: 'support',
            redirectTo: '/admin/help/support',
            pathMatch: 'full',
          },
        ],
      },
      // Help Routes
      {
        path: 'help',
        children: [
          {
            path: '',
            redirectTo: 'support',
            pathMatch: 'full',
          },
          {
            path: 'support',
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('../../private/modules/store/settings/support/support-settings.component').then(
                    (c) => c.SupportSettingsComponent,
                  ),
              },
              {
                path: ':id',
                loadComponent: () =>
                  import('../../private/modules/store/settings/support/components/ticket-detail/ticket-detail.component').then(
                    (c) => c.TicketDetailComponent,
                  ),
              },
            ],
          },
          {
            path: 'center',
            loadComponent: () =>
              import('../../private/modules/store/help/help-center/help-center.component').then(
                (c) => c.HelpCenterComponent,
              ),
          },
          {
            path: 'center/:slug',
            loadComponent: () =>
              import('../../private/modules/store/help/help-center/help-center.component').then(
                (c) => c.HelpCenterComponent,
              ),
          },
        ],
      },
      // Expenses Routes
      {
        path: 'expenses',
        loadChildren: () =>
          import('../../private/modules/store/expenses/expenses.routes').then(
            (m) => m.expensesRoutes,
          ),
      },
      // Cash Registers Routes
      {
        path: 'cash-registers',
        loadComponent: () =>
          import('../../private/modules/store/cash-registers/cash-registers.component').then(
            (c) => c.CashRegistersComponent,
          ),
      },
      // Invoicing Routes
      {
        path: 'invoicing',
        loadChildren: () =>
          import('../../private/modules/store/invoicing/invoicing.routes').then(
            (m) => m.invoicingRoutes,
          ),
      },
      // Accounting Routes
      {
        path: 'accounting',
        loadChildren: () =>
          import('../../private/modules/store/accounting/accounting.routes').then(
            (m) => m.accountingRoutes,
          ),
      },
      // Payroll Routes
      {
        path: 'payroll',
        loadChildren: () =>
          import('../../private/modules/store/payroll/payroll.routes').then(
            (m) => m.payrollRoutes,
          ),
      },
      // Legal / Tax Routes — withholding-tax, exogenous and ica are now nested
      // under the accounting module (see accounting.routes.ts) so they share
      // its persistent sticky-header. Old /admin/taxes/ica deep-links redirect
      // to the new canonical /admin/accounting/taxes/ica path.
      {
        path: 'taxes/ica',
        redirectTo: 'accounting/taxes/ica',
        pathMatch: 'full',
      },
      // Price Tiers (Precios y Tarifas)
      {
        path: 'price-tiers',
        loadChildren: () =>
          import(
            '../../private/modules/store/price-tiers/routes/price-tiers.routes'
          ).then((m) => m.priceTiersRoutes),
      },
      // Restaurant Ops (Phase B — Recipes, Phase C — Production,
      // Phase F — KDS). The root /admin/restaurant-ops keeps Recipes as
      // the default child so the existing deep-links still work.
      {
        path: 'restaurant-ops',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'recipes',
          },
          {
            path: 'recipes',
            loadChildren: () =>
              import(
                '../../private/modules/store/restaurant-ops/recipes/routes/recipes.routes'
              ).then((m) => m.recipesRoutes),
          },
          {
            path: 'production',
            loadChildren: () =>
              import(
                '../../private/modules/store/restaurant-ops/production/routes/production.routes'
              ).then((m) => m.productionOrdersRoutes),
          },
          {
            path: 'kds',
            loadChildren: () =>
              import(
                '../../private/modules/store/restaurant-ops/kds/routes/kds.routes'
              ).then((m) => m.kdsRoutes),
          },
          {
            path: 'tables',
            loadChildren: () =>
              import(
                '../../private/modules/store/restaurant-ops/tables/routes/tables.routes'
              ).then((m) => m.tablesRoutes),
          },
          {
            path: 'menus',
            loadChildren: () =>
              import(
                '../../private/modules/store/restaurant-ops/menus/routes/menus.routes'
              ).then((m) => m.menusRoutes),
          },
        ],
      },
      // Memberships (Membership Suite: Planes, Socios/Membresías, Accesos). The
      // whole group is hidden by INDUSTRY_HIDDEN_MODULES for every industry
      // except `gym` and `service`; visible only when the store's industry
      // includes `gym` or `service`. Panel_ui keys: memberships (parent) ·
      // memberships_plans · memberships_members · memberships_access. The root
      // /admin/memberships defaults to Planes.
      {
        path: 'memberships',
        children: [
          {
            path: '',
            pathMatch: 'full',
            redirectTo: 'plans',
          },
          {
            path: 'plans',
            loadChildren: () =>
              import(
                '../../private/modules/store/memberships/plans/routes/membership-plans.routes'
              ).then((m) => m.membershipPlansRoutes),
          },
          {
            path: 'members',
            loadChildren: () =>
              import(
                '../../private/modules/store/memberships/members/routes/membership-members.routes'
              ).then((m) => m.membershipMembersRoutes),
          },
          {
            path: 'access',
            loadChildren: () =>
              import(
                '../../private/modules/store/memberships/access/routes/membership-access.routes'
              ).then((m) => m.membershipAccessRoutes),
          },
        ],
      },
      // Subscription Routes
      {
        path: 'subscription',
        canActivate: [subscriptionManagementGuard],
        loadChildren: () =>
          import('../../private/modules/store/subscription/subscription.routes').then(
            (m) => m.default,
          ),
      },
    ],
  },
];
