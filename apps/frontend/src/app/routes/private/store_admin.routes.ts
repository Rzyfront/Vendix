import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { AuthGuard } from '../../core/guards/auth.guard';
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
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
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
            path: 'purchase-orders',
            loadComponent: () =>
              import('../../private/modules/store/orders/purchase-orders/purchase-orders.component').then(
                (c) => c.PurchaseOrdersComponent,
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
              import(
                '../../private/modules/store/dispatch-notes/dispatch-notes.component'
              ).then((c) => c.DispatchNotesComponent),
          },
          {
            path: 'dispatch-notes/:id',
            loadComponent: () =>
              import(
                '../../private/modules/store/dispatch-notes/pages/dispatch-note-detail-page/dispatch-note-detail-page.component'
              ).then((c) => c.DispatchNoteDetailPageComponent),
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
              import(
                '../../private/modules/store/reservations/components/schedule-management/schedule-management.component'
              ).then((c) => c.ScheduleManagementComponent),
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
                  import(
                    '../../private/modules/store/settings/shipping/pages/shipping-dashboard/shipping-dashboard.component'
                  ).then((c) => c.ShippingDashboardComponent),
              },
              {
                path: ':methodId',
                loadComponent: () =>
                  import(
                    '../../private/modules/store/settings/shipping/pages/method-detail/method-detail.component'
                  ).then((c) => c.MethodDetailComponent),
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
              import(
                '../../private/modules/store/help/help-center/help-center.component'
              ).then((c) => c.HelpCenterComponent),
          },
          {
            path: 'center/:slug',
            loadComponent: () =>
              import(
                '../../private/modules/store/help/help-center/help-center.component'
              ).then((c) => c.HelpCenterComponent),
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
          import(
            '../../private/modules/store/cash-registers/cash-registers.component'
          ).then((c) => c.CashRegistersComponent),
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
      // Legal / Tax Routes
      {
        path: 'accounting/withholding-tax',
        loadChildren: () =>
          import('../../private/modules/store/withholding-tax/withholding-tax.routes').then(
            (m) => m.withholdingTaxRoutes,
          ),
      },
      {
        path: 'accounting/exogenous',
        loadChildren: () =>
          import('../../private/modules/store/exogenous/exogenous.routes').then(
            (m) => m.exogenousRoutes,
          ),
      },
      {
        path: 'taxes/ica',
        loadChildren: () =>
          import('../../private/modules/store/taxes/ica/ica.routes').then(
            (m) => m.icaRoutes,
          ),
      },
    ],
  },
];
