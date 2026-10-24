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
    // Estaciones de servicio: el enlace de seguimiento y el QR de la estación deben
    // abrir también en tiendas que solo tienen landing (sin tienda en línea).
    {
        path: 'estacion/:publicId',
        loadComponent: () =>
            import('../../public/ecommerce/pages/service-station-status/service-station-status.component').then(
                (c) => c.ServiceStationStatusComponent,
            ),
    },
    {
        path: 'seguimiento-servicio/:token',
        loadComponent: () =>
            import('../../public/ecommerce/pages/service-session-progress/service-session-progress.component').then(
                (c) => c.ServiceSessionProgressComponent,
            ),
    },
    ...pricingRoutes,
];
