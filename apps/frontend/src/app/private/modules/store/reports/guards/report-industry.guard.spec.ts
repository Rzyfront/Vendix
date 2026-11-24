import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { reportIndustryGuard, REPORTS_FALLBACK_URL } from './report-industry.guard';
import {
  HOSPITALITY_REPORTS_URL,
  hospitalityLegacyReportUrl,
  hospitalityLegacyTabRedirect,
  hospitalityReportsLegacyRedirect,
} from '../hospitality-legacy-redirect';

@Component({ standalone: true, template: '' })
class BlankComponent {}

/**
 * Rutas de prueba con la misma forma que `reports.routes.ts` (shell por
 * categoría con `data.categoryId` + guard) y las redirecciones viejas de
 * Hotelería como quedarán en `store_admin.routes.ts`.
 */
const ROUTES: Routes = [
  {
    path: 'admin/hospitality',
    children: [
      { path: 'reports', pathMatch: 'full', redirectTo: hospitalityReportsLegacyRedirect },
      { path: 'night-audit', pathMatch: 'full', redirectTo: hospitalityLegacyTabRedirect('night-audit') },
    ],
  },
  {
    path: 'admin/reports',
    children: [
      { path: 'overview', component: BlankComponent },
      {
        path: 'hospitality',
        data: { categoryId: 'hospitality' },
        canActivate: [reportIndustryGuard],
        children: [
          { path: '', component: BlankComponent },
          { path: ':slug', component: BlankComponent },
        ],
      },
      {
        path: 'sales',
        data: { categoryId: 'sales' },
        canActivate: [reportIndustryGuard],
        children: [
          { path: '', component: BlankComponent },
          {
            path: 'sales-tips-by-waiter',
            data: { reportId: 'sales-tips-by-waiter' },
            canActivate: [reportIndustryGuard],
            component: BlankComponent,
          },
        ],
      },
    ],
  },
];

describe('Reportes por industria — guard y ruta vieja de hotel (agenda unificada F4)', () => {
  // Panel de un gerente con Reportes y hotelería; los casos de rol lo cambian.
  const MANAGER_PANEL = ['reports', 'hospitality', 'hospitality_reservations', 'reports_dispatch'];
  const authStub = {
    storeIndustries: signal<string[]>(['retail']),
    storeSettings: signal<unknown>({ general: {} }),
    visibleModules: signal<string[]>(MANAGER_PANEL),
    isOwner: signal(false),
  };
  let router: Router;

  beforeEach(() => {
    authStub.storeIndustries.set(['retail']);
    authStub.storeSettings.set({ general: {} });
    authStub.visibleModules.set(MANAGER_PANEL);
    authStub.isOwner.set(false);
    TestBed.configureTestingModule({
      providers: [provideRouter(ROUTES), { provide: AuthFacade, useValue: authStub }],
    });
    router = TestBed.inject(Router);
  });

  it('una tienda solo retail que abre Hotelería vuelve al Resumen de Reportes', async () => {
    await router.navigateByUrl('/admin/reports/hospitality/hotel-performance');
    expect(router.url).toBe(REPORTS_FALLBACK_URL);
  });

  it('una tienda con hotelería abre los reportes de hotel en Reportes', async () => {
    authStub.storeIndustries.set(['hospitality']);
    await router.navigateByUrl('/admin/reports/hospitality/hotel-performance');
    expect(router.url).toBe('/admin/reports/hospitality/hotel-performance');
  });

  it('los reportes transversales abren con cualquier industria', async () => {
    authStub.storeIndustries.set(['hospitality']);
    await router.navigateByUrl('/admin/reports/sales');
    expect(router.url).toBe('/admin/reports/sales');
  });

  it('un reporte de otra industria (propinas por mesero en retail) vuelve al Resumen', async () => {
    await router.navigateByUrl('/admin/reports/sales/sales-tips-by-waiter');
    expect(router.url).toBe(REPORTS_FALLBACK_URL);
  });

  it('sin ajustes de tienda ni industrias del login aún cargados deja pasar (el backend autoriza)', async () => {
    authStub.storeIndustries.set([]);
    authStub.storeSettings.set(null);
    await router.navigateByUrl('/admin/reports/hospitality');
    expect(router.url).toBe(HOSPITALITY_REPORTS_URL);
  });

  it('con los ajustes cargados, una tienda sin industrias se lee como retail y no abre Hotelería', async () => {
    authStub.storeIndustries.set([]);
    await router.navigateByUrl('/admin/reports/hospitality');
    expect(router.url).toBe(REPORTS_FALLBACK_URL);
  });

  it('un rol con Reportes pero sin hotelería (sin hospitality_reservations) no abre Hotelería', async () => {
    authStub.storeIndustries.set(['hospitality']);
    authStub.visibleModules.set(['reports', 'pos']);
    await router.navigateByUrl('/admin/reports/hospitality/hotel-performance');
    expect(router.url).toBe(REPORTS_FALLBACK_URL);
  });

  it('la recepcionista (hotelería sin la key reports) abre Cierre del día', async () => {
    authStub.storeIndustries.set(['hospitality']);
    // Preset `receptionist` de lodging-roles: sin `reports`.
    authStub.visibleModules.set(['hospitality', 'hospitality_rooms', 'hospitality_reservations', 'pos', 'orders']);
    await router.navigateByUrl('/admin/reports/hospitality/hotel-night-audit');
    expect(router.url).toBe('/admin/reports/hospitality/hotel-night-audit');
  });

  it('el owner abre Hotelería aunque su panel no liste la key', async () => {
    authStub.storeIndustries.set(['hospitality']);
    authStub.visibleModules.set(['reports']);
    authStub.isOwner.set(true);
    await router.navigateByUrl('/admin/reports/hospitality');
    expect(router.url).toBe(HOSPITALITY_REPORTS_URL);
  });

  it('la ruta vieja con ?tab= redirige al reporte en Reportes y conserva los demás params', async () => {
    authStub.storeIndustries.set(['hospitality']);
    await router.navigateByUrl('/admin/hospitality/reports?tab=pickup&from=2026-11-01');
    expect(router.url).toBe('/admin/reports/hospitality/hotel-pickup?from=2026-11-01');
  });

  it('la ruta vieja sin pestaña (o desconocida) abre el catálogo de Hotelería', async () => {
    authStub.storeIndustries.set(['hospitality']);
    await router.navigateByUrl('/admin/hospitality/reports');
    expect(router.url).toBe(HOSPITALITY_REPORTS_URL);
    expect(hospitalityLegacyReportUrl('nope')).toBe(HOSPITALITY_REPORTS_URL);
  });

  it('las URLs sueltas previas a R4 llegan directo a su reporte', async () => {
    authStub.storeIndustries.set(['hospitality']);
    await router.navigateByUrl('/admin/hospitality/night-audit');
    expect(router.url).toBe('/admin/reports/hospitality/hotel-night-audit');
  });

  it('cada pestaña vieja tiene su reporte nuevo', () => {
    expect(hospitalityLegacyReportUrl('night-audit')).toBe('/admin/reports/hospitality/hotel-night-audit');
    expect(hospitalityLegacyReportUrl('performance')).toBe('/admin/reports/hospitality/hotel-performance');
    expect(hospitalityLegacyReportUrl('pickup')).toBe('/admin/reports/hospitality/hotel-pickup');
    expect(hospitalityLegacyReportUrl('cancellations')).toBe('/admin/reports/hospitality/hotel-cancellations');
    expect(hospitalityLegacyReportUrl('fontur')).toBe('/admin/reports/hospitality/hotel-fontur');
  });
});
