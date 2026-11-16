import { Routes } from '@angular/router';
import { pricingRoutes } from '../../public/pricing/pricing.routes';
import { SECTOR_GUIDES_ENABLED } from '../../public/landing/guides/sector-guides.config';
import { SECTOR_PAGES_ENABLED, SECTOR_PAGE_PATHS } from '../../public/sectors/sector-pages.config';
import { IMPLEMENTATION_PAGE_ENABLED } from '../../public/implementation/implementation-page.config';

const sectorGuideRoutes: Routes = SECTOR_GUIDES_ENABLED
  ? [
      'comandas-restaurantes',
      'ventas-mayoristas-al-detal',
      'preparar-demostracion',
      'cierre-de-caja',
      'control-de-inventario',
      'elegir-software-pos',
      'pasar-productos-excel-a-pos',
    ].map((guideKey) => ({
      path: `guias/${guideKey}`,
      loadComponent: () =>
        import('../../public/landing/guides/sector-guide.component').then(
          (c) => c.SectorGuideComponent,
        ),
      data: { guideKey },
    }))
  : [];

// SEO-OPS-17 / SEO-TECH-08: páginas de sector desde la plantilla. Solo existen con el
// interruptor encendido (apagado en producción). Al publicar una, agregarla a MARKETING_PAGES
// de infra/cloudfront/spa-rewrite.js, al sitemap del backend y al smoke SEO.
const sectorPageRoutes: Routes = SECTOR_PAGES_ENABLED
  ? SECTOR_PAGE_PATHS.map((path) => ({
      path,
      loadComponent: () =>
        import('../../public/sectors/sector-page.component').then((c) => c.SectorPageComponent),
      data: { sectorPath: path },
    }))
  : [];

// SEO-OPS-19: la ruta solo existe con el interruptor encendido (apagado en producción).
const implementationRoutes: Routes = IMPLEMENTATION_PAGE_ENABLED
  ? [
      {
        path: 'implementacion',
        loadComponent: () =>
          import('../../public/implementation/implementation-page.component').then(
            (c) => c.ImplementationPageComponent,
          ),
      },
    ]
  : [];

export const vendixLandingPublicRoutes: Routes = [
  ...sectorGuideRoutes,
  ...sectorPageRoutes,
  ...implementationRoutes,
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/landing/vendix-landing/vendix-landing.component'
      ).then((c) => c.VendixLandingComponent),
  },
  // Help Center — public entry point for unauthenticated visitors
  // who need help. The CTA inside links to /pqr which opens the
  // public PQRS submission form. The /pqr routes are mounted
  // further down in this same file.
  {
    path: 'ayuda',
    loadComponent: () =>
      import(
        '../../public/landing/help-center/help-center.component'
      ).then((c) => c.HelpCenterComponent),
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
    path: 'pqr/consultar',
    loadComponent: () =>
      import(
        '../../public/ecommerce/pages/pqr/pqr-track.component'
      ).then((c) => c.PqrTrackComponent),
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
