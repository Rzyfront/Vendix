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
                    id: 'support-documents',
                    label: 'Documentos soporte',
                    icon: 'file-text',
                    route: '/admin/invoicing/support-documents',
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
                // QUI-682: pestaña dedicada a documentos soporte. Lazy
                // standalone: no se monta con el shell ni con el componente
                // padre de facturas de venta, así que añadir `cufe`/`cuds` al
                // query o crear un item en esta pestaña no rompe el árbol de
                // NgRx ni las guards de InvoicingComponent.
                path: 'support-documents',
                loadComponent: () =>
                    import('./components/support-documents/support-documents-page.component').then(
                        (m) => m.SupportDocumentsPageComponent,
                    ),
            },
            {
                path: 'resolutions',
                loadComponent: () =>
                    import('./components/resolutions/resolutions-page.component').then((c) => c.ResolutionsPageComponent),
            },
            {
                // Las cuatro habilitaciones DIAN y, colgando de cada una, su
                // detalle. El detalle es una RUTA y no un panel escondido:
                // `app-table` envuelve su cuerpo en `@defer (on viewport)` y el
                // IntersectionObserver no dispara bajo un ancestro con
                // `display:none`, así que una sub-sección oculta se queda con el
                // esqueleto para siempre. Además hace enlazable el estado de un
                // eje concreto.
                path: 'dian-config',
                children: [
                    {
                        path: '',
                        pathMatch: 'full',
                        // `axisDetailRoute` le dice a la vista de ejes que aquí
                        // SÍ existe detalle por eje. No se asume: este mismo
                        // componente lo monta la consola de super admin bajo su
                        // propio árbol de rutas, donde ese hijo no existe.
                        data: { axisDetailRoute: true },
                        loadComponent: () =>
                            import('./components/dian-config/dian-config.component').then((m) => m.DianConfigComponent),
                    },
                    {
                        path: ':configurationType',
                        loadComponent: () =>
                            import('./components/dian-config/dian-axis-detail.component').then((m) => m.DianAxisDetailComponent),
                    },
                ],
            },
        ],
    },
];
