import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { invoicingReducer } from './state/reducers/invoicing.reducer';
import { InvoicingEffects } from './state/effects/invoicing.effects';
import { ModuleTabsShellComponent } from '../../../../shared/components/module-tabs-shell/module-tabs-shell.component';

export const invoicingRoutes: Routes = [
    {
        path: '',
        component: ModuleTabsShellComponent,
        // Centralized module: sub-sections render as internal sticky-header
        // tabs inside the shell, not as sidebar grandchildren.
        data: {
            moduleTitle: 'Facturación',
            moduleIcon: 'file-text',
            moduleBackRoute: '/admin/fiscal',
            moduleTabs: [
                {
                    id: 'invoices',
                    label: 'Facturas',
                    icon: 'receipt',
                    route: '/admin/invoicing/invoices',
                },
                {
                    id: 'resolutions',
                    label: 'Resoluciones',
                    icon: 'file-check',
                    route: '/admin/invoicing/resolutions',
                },
                {
                    id: 'dian-config',
                    label: 'Configuración DIAN',
                    shortLabel: 'DIAN',
                    icon: 'shield',
                    route: '/admin/invoicing/dian-config',
                },
            ],
        },
        providers: [
            provideState({ name: 'invoicing', reducer: invoicingReducer }),
            provideEffects(InvoicingEffects),
        ],
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'invoices',
            },
            {
                path: 'invoices',
                loadComponent: () =>
                    import('./invoicing.component').then((c) => c.InvoicingComponent),
            },
            {
                path: 'resolutions',
                loadComponent: () =>
                    import('./components/resolutions/resolutions-page.component').then((c) => c.ResolutionsPageComponent),
            },
            {
                path: 'dian-config',
                loadComponent: () =>
                    import('./components/dian-config/dian-config.component').then((m) => m.DianConfigComponent),
            },
        ],
    },
];
