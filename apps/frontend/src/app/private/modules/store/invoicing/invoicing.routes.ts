import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { invoicingReducer } from './state/reducers/invoicing.reducer';
import { InvoicingEffects } from './state/effects/invoicing.effects';
import { InvoiceProfileEffects } from './state/effects/invoice-profile.effects';
import { ModuleTabsShellComponent } from '../../../../shared/components/module-tabs-shell/module-tabs-shell.component';

export const invoicingRoutes: Routes = [
    {
        // CAPTURA DE FACTURA: ruta propia, y HERMANA del shell — no hija.
        //
        // Va PRIMERO porque Angular resuelve por orden y la ruta del shell
        // capturaría el segmento antes de llegar aquí.
        //
        // Fuera del shell a propósito: `ModuleTabsShellComponent` pinta su
        // propio `app-sticky-header` con las pestañas del módulo y lee
        // `route.data` de SU ruta, no de la hija activa. Un hijo no puede
        // suprimir esa cabecera por `data`, así que anidada aquí dentro
        // quedarían dos cabeceras sticky apiladas. Por eso replica los
        // providers de NgRx — el mismo patrón que ya usa el POS en
        // `store_admin.routes.ts`. La URL no cambia:
        // `/admin/invoicing/invoices/new`.
        path: 'invoices/new',
        providers: [
            provideState({ name: 'invoicing', reducer: invoicingReducer }),
            provideEffects(InvoicingEffects, InvoiceProfileEffects),
        ],
        loadComponent: () =>
            import('./pages/invoice-create-page/invoice-create-page.component').then(
                (m) => m.InvoiceCreatePageComponent,
            ),
    },
    {
        // EDITOR DE PERFIL: ruta propia y HERMANA del shell, por la misma razón
        // que `invoices/new` — el editor pinta su propio `app-sticky-header` y
        // anidado dentro del shell quedarían dos cabeceras sticky apiladas.
        //
        // Va ANTES del shell porque Angular resuelve por orden: la ruta del
        // shell capturaría el segmento antes de llegar aquí.
        //
        // Dos rutas y no una con `:id?` opcional: Angular no tiene parámetros
        // opcionales de ruta, y `profiles/:id/edit` con `id = 'new'` obligaría
        // al componente a distinguir un id de una palabra reservada.
        path: 'profiles/new',
        providers: [
            provideState({ name: 'invoicing', reducer: invoicingReducer }),
            provideEffects(InvoicingEffects, InvoiceProfileEffects),
        ],
        loadComponent: () =>
            import('./pages/invoice-profile-editor/invoice-profile-editor.component').then(
                (m) => m.InvoiceProfileEditorComponent,
            ),
    },
    {
        path: 'profiles/:id/edit',
        providers: [
            provideState({ name: 'invoicing', reducer: invoicingReducer }),
            provideEffects(InvoicingEffects, InvoiceProfileEffects),
        ],
        loadComponent: () =>
            import('./pages/invoice-profile-editor/invoice-profile-editor.component').then(
                (m) => m.InvoiceProfileEditorComponent,
            ),
    },
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
                    description:
                        'Facturas de venta, notas crédito y débito emitidas por la tienda, con su estado ante la DIAN.',
                    icon: 'receipt',
                    route: '/admin/invoicing/invoices',
                },
                {
                    id: 'support-documents',
                    label: 'Documentos soporte',
                    description:
                        'Documentos que respaldan compras a proveedores no obligados a facturar electrónicamente.',
                    icon: 'file-text',
                    route: '/admin/invoicing/support-documents',
                },
                {
                    // La única superficie desde la que se puede ver —y
                    // reintentar— la conversión de una venta a consumidor final
                    // en factura a nombre del cliente. Sin ella, una conversión
                    // fallida es invisible: el listener la deja en `failed` y su
                    // propio log remite a un endpoint que no tenía cliente.
                    id: 'invoice-data-requests',
                    label: 'Solicitudes de factura',
                    shortLabel: 'Solicitudes',
                    description:
                        'Ventas a consumidor final que el cliente pidió convertir en factura a su nombre.',
                    icon: 'user-plus',
                    route: '/admin/invoicing/invoice-data-requests',
                },
                {
                    id: 'resolutions',
                    label: 'Resoluciones',
                    description:
                        'Rangos de numeración autorizados por la DIAN: prefijo, consecutivo disponible y vigencia.',
                    icon: 'file-check',
                    route: '/admin/invoicing/resolutions',
                },
                {
                    // Con qué reglas se timbra: régimen AIU, matriz de
                    // impuestos por componente, cuentas y formato. Va DESPUÉS
                    // de Resoluciones y ANTES de Configuración DIAN porque ese
                    // es el orden en que se configuran: primero la numeración
                    // autorizada, luego las reglas del documento, y al final el
                    // certificado con que se firma.
                    id: 'profiles',
                    label: 'Perfiles',
                    description:
                        'Configuraciones de facturación reutilizables: régimen AIU, impuestos por componente, cuentas contables y formato. Cada edición crea una versión, y cada factura queda apuntando a la que la emitió.',
                    icon: 'layout-template',
                    route: '/admin/invoicing/profiles',
                },
                {
                    id: 'dian-config',
                    label: 'Configuración DIAN',
                    shortLabel: 'DIAN',
                    description:
                        'Certificado de firma, software habilitado y ambiente con el que se transmite cada documento.',
                    icon: 'shield',
                    route: '/admin/invoicing/dian-config',
                },
            ],
        },
        providers: [
            provideState({ name: 'invoicing', reducer: invoicingReducer }),
            provideEffects(InvoicingEffects, InvoiceProfileEffects),
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
                path: 'invoice-data-requests',
                loadComponent: () =>
                    import('./components/invoice-data-requests/invoice-data-requests-page.component').then(
                        (m) => m.InvoiceDataRequestsPageComponent,
                    ),
            },
            {
                path: 'resolutions',
                loadComponent: () =>
                    import('./components/resolutions/resolutions-page.component').then((c) => c.ResolutionsPageComponent),
            },
            {
                // Segmento `profiles` y NO `invoice-profiles`: el shell marca
                // la pestaña activa por prefijo de ruta, así que cualquier
                // segmento que empiece por `invoices` encendería la pestaña de
                // Facturas — el mismo defecto que ya obligó a sacar
                // `invoices/new` fuera del shell.
                path: 'profiles',
                loadComponent: () =>
                    import('./pages/invoice-profiles-page/invoice-profiles-page.component').then(
                        (m) => m.InvoiceProfilesPageComponent,
                    ),
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
