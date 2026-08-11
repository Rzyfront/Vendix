import type { Routes } from '@angular/router';

import {
  DIAN_DEFAULT_TAB,
  TenantDianHostComponent,
} from '../tenant-dian-host.component';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

/**
 * Rutas de la sección Documentos electrónicos del perfil de tenant.
 *
 * ## Cinco RUTAS, no cinco paneles apilados
 *
 * Antes las cinco vistas eran tres `<section>` dentro de un componente de 2.400
 * líneas: el operador tenía que reconocer dónde acababa el certificado y
 * empezaba el set de pruebas, y no había forma de mandarle a un compañero el
 * enlace de «la numeración de este tenant».
 *
 * La separación por RUTAS —y no por `[hidden]`— no es estética. `app-table`
 * envuelve su cuerpo en `@defer (on viewport)` (`table.component.html:83`) y el
 * `IntersectionObserver` jamás dispara bajo un ancestro con `display:none`: una
 * sección oculta que contenga una tabla se queda con el skeleton PARA SIEMPRE.
 * Numeración y Bitácora son tablas. Con rutas, la vista inactiva ni existe.
 *
 * ## El store de la sección vive aquí
 *
 * `TenantDianConsoleStore` se provee en el shell para que las cinco hojas
 * compartan los cuatro ejes, las configuraciones y —sobre todo— la habilitación
 * elegida: saltar de Certificado a Numeración no puede cambiar de eje en
 * silencio. El router NO destruye el injector de esta rama al salir, así que el
 * store limpia y vuelve a pedir en cada `reload()` con un token de secuencia.
 *
 * ## `provideSuperadminDianApi()` NO se repite aquí
 *
 * Ya lo provee el shell de Configuración un nivel más arriba, y este árbol
 * cuelga de él. Re-declararlo crearía una segunda instancia de
 * `DianConfigApiService` en esta rama: los componentes compartidos leerían las
 * capacidades de un token y escribirían por el otro, que es exactamente el
 * defecto que el factory documenta.
 */
export const TENANT_DIAN_ROUTES: Routes = [
  {
    path: '',
    component: TenantDianHostComponent,
    providers: [TenantDianConsoleStore],
    // Cada hoja declara su propio `title` (formato «Sección - Ámbito»). Sin él,
    // `BreadcrumbService` no encuentra entrada para una URL de seis segmentos,
    // su efecto de título se abstiene y la pestaña del navegador se queda con el
    // rótulo de la pantalla anterior sin importar en qué sub-vista esté soporte.
    children: [
      { path: '', pathMatch: 'full', redirectTo: DIAN_DEFAULT_TAB },
      {
        path: 'habilitaciones',
        title: 'Habilitaciones DIAN - Documentos electrónicos del tenant',
        loadComponent: () =>
          import('./tenant-dian-enablements.component').then(
            (c) => c.TenantDianEnablementsComponent,
          ),
      },
      {
        path: 'certificado',
        title: 'Certificado digital - Documentos electrónicos del tenant',
        loadComponent: () =>
          import('./tenant-dian-certificate.component').then(
            (c) => c.TenantDianCertificateComponent,
          ),
      },
      {
        path: 'numeracion',
        title: 'Numeración - Documentos electrónicos del tenant',
        loadComponent: () =>
          import('./tenant-dian-numbering.component').then(
            (c) => c.TenantDianNumberingComponent,
          ),
      },
      {
        path: 'pruebas',
        title: 'Set de pruebas - Documentos electrónicos del tenant',
        loadComponent: () =>
          import('./tenant-dian-test-set.component').then(
            (c) => c.TenantDianTestSetComponent,
          ),
      },
      {
        path: 'bitacora',
        title: 'Bitácora DIAN - Documentos electrónicos del tenant',
        loadComponent: () =>
          import('./tenant-dian-audit.component').then(
            (c) => c.TenantDianAuditComponent,
          ),
      },
      { path: '**', redirectTo: DIAN_DEFAULT_TAB },
    ],
  },
];
