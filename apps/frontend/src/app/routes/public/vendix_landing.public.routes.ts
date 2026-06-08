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
