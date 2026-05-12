import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { invoicingReducer } from './state/reducers/invoicing.reducer';
import { InvoicingEffects } from './state/effects/invoicing.effects';

export const invoicingRoutes: Routes = [
    {
        path: '',
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
