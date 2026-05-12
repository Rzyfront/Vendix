import { Routes } from '@angular/router';
import { pricingRoutes } from '../../public/pricing/pricing.routes';

export const storeLandingPublicRoutes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import(
                '../../public/dynamic-landing/components/store-landing/store-landing.component'
            ).then((c) => c.StoreLandingComponent),
    },
    ...pricingRoutes,
];
