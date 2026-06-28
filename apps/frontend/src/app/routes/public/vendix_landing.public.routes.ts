import { Routes } from '@angular/router';
import { pricingRoutes } from '../../public/pricing/pricing.routes';

export const vendixLandingPublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/landing/vendix-landing/vendix-landing.component'
      ).then((c) => c.VendixLandingComponent),
  },
  // PQR (Peticiones, Quejas y Reclamos) — canal público centralizado
  // para atención al cliente. El link en el footer del landing apunta
  // a /pqr; las rutas thank-you y track también son públicas (sin
  // auth) para que el cliente pueda consultar el estado con su número
  // de ticket. Reutilizamos los componentes del ecommerces porque
  // son standalone y la lógica es idéntica (form + redirect).
  {
    path: 'pqr',
    loadComponent: () =>
      import(
        '../../public/ecommerce/pages/pqr/pqr-submit.component'
      ).then((c) => c.PqrSubmitComponent),
  },
  {
    path: 'pqr/gracias/:ticket_number',
    loadComponent: () =>
      import(
        '../../public/ecommerce/pages/pqr/pqr-thank-you.component'
      ).then((c) => c.PqrThankYouComponent),
  },
  {
    path: 'pqr/consultar/:ticket_number',
    loadComponent: () =>
      import(
        '../../public/ecommerce/pages/pqr/pqr-track.component'
      ).then((c) => c.PqrTrackComponent),
  },
  // Páginas legales públicas enlazadas desde el footer del landing.
  // Un único visor genérico renderiza la versión activa del documento según
  // data.documentType. El checkout linkea a /legal/terminos#pagos-y-reembolsos.
  {
    path: 'legal/terminos',
    loadComponent: () =>
      import(
        '../../public/legal/document-viewer/legal-document-viewer.component'
      ).then((m) => m.LegalDocumentViewerComponent),
    data: { documentType: 'TERMS_OF_SERVICE' },
  },
  {
    path: 'legal/privacidad',
    loadComponent: () =>
      import(
        '../../public/legal/document-viewer/legal-document-viewer.component'
      ).then((m) => m.LegalDocumentViewerComponent),
    data: { documentType: 'PRIVACY_POLICY' },
  },
  {
    path: 'legal/cookies',
    loadComponent: () =>
      import(
        '../../public/legal/document-viewer/legal-document-viewer.component'
      ).then((m) => m.LegalDocumentViewerComponent),
    data: { documentType: 'COOKIES_POLICY' },
  },
  ...pricingRoutes,
];
