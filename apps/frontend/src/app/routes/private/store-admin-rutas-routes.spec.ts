import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Route, Router, Routes, provideRouter } from '@angular/router';
import { storeAdminRoutes } from './store_admin.routes';
import { reportsRoutes } from '../../private/modules/store/reports/reports.routes';
import { REPORT_DEFINITIONS } from '../../private/modules/store/reports/config/report-registry';
import { MODULE_ROUTES } from '../../shared/constants/store-module-catalog.constant';
import { STORE_ADMIN_MENU_ITEMS } from '../../private/layouts/store-admin/store-admin-menu-items';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';

/**
 * QUI-1024: the "Rutas" module lives at `/admin/orders/rutas`. The old
 * `/admin/orders/planillas` URLs keep working through redirects that preserve
 * `:id` and query params, and every one of them is declared before the orders
 * `:id` route, which would otherwise swallow `rutas` as an order id ("No se
 * pudo cargar la informacion de la orden").
 *
 * The real route arrays are used with the real Router; only each page is
 * swapped for a stub, so the order of the entries and the redirects are the
 * ones shipped, without lazy chunks, guards or feature stores.
 */
@Component({ standalone: true, template: '' })
class StubPageComponent {}

function childrenOf(routes: Routes, path: string): Routes {
  const node = (routes as Route[]).find((route) => route.path === path && route.children);
  if (!node?.children) throw new Error(`Route node "${path}" not found`);
  return node.children;
}

function stubbed(routes: Routes): Routes {
  return (routes as Route[]).map((route) =>
    route.redirectTo !== undefined
      ? { path: route.path, pathMatch: route.pathMatch, redirectTo: route.redirectTo }
      : { path: route.path, pathMatch: route.pathMatch, component: StubPageComponent },
  );
}

function leaf(router: Router): ActivatedRouteSnapshot {
  let snapshot = router.routerState.snapshot.root;
  while (snapshot.firstChild) snapshot = snapshot.firstChild;
  return snapshot;
}

function menuRoutes(items: readonly MenuItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.route ? [item.route] : []),
    ...menuRoutes(item.children ?? []),
  ]);
}

const ordersChildren = childrenOf(childrenOf(storeAdminRoutes, 'admin'), 'orders');
const dispatchReportsChildren = childrenOf(childrenOf(reportsRoutes, ''), 'dispatch');

describe('QUI-1024: URLs del módulo Rutas', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'admin/orders', children: stubbed(ordersChildren) },
          { path: 'admin/reports/dispatch', children: stubbed(dispatchReportsChildren) },
        ]),
      ],
    });
    router = TestBed.inject(Router);
  });

  it('/admin/orders/rutas abre el listado de rutas, no el detalle de una orden', async () => {
    await router.navigateByUrl('/admin/orders/rutas');
    expect(router.url).toBe('/admin/orders/rutas');
    expect(leaf(router).routeConfig?.path).toBe('rutas');
  });

  it('/admin/orders/rutas/:id y /admin/orders/rutas/:id/recorrido abren sus páginas con el id', async () => {
    await router.navigateByUrl('/admin/orders/rutas/42');
    expect(leaf(router).routeConfig?.path).toBe('rutas/:id');
    expect(leaf(router).paramMap.get('id')).toBe('42');

    await router.navigateByUrl('/admin/orders/rutas/42/recorrido');
    expect(leaf(router).routeConfig?.path).toBe('rutas/:id/recorrido');
    expect(leaf(router).paramMap.get('id')).toBe('42');
  });

  it('las URLs viejas de planillas redirigen a rutas conservando el id y los query params', async () => {
    await router.navigateByUrl('/admin/orders/planillas?prefillNotes=7,8');
    expect(router.url).toBe('/admin/orders/rutas?prefillNotes=7,8');
    expect(leaf(router).routeConfig?.path).toBe('rutas');

    await router.navigateByUrl('/admin/orders/planillas/42');
    expect(router.url).toBe('/admin/orders/rutas/42');
    expect(leaf(router).paramMap.get('id')).toBe('42');

    await router.navigateByUrl('/admin/orders/planillas/42/recorrido');
    expect(router.url).toBe('/admin/orders/rutas/42/recorrido');
    expect(leaf(router).routeConfig?.path).toBe('rutas/:id/recorrido');
  });

  it('el detalle de orden sigue resolviendo por :id', async () => {
    await router.navigateByUrl('/admin/orders/1234');
    expect(leaf(router).routeConfig?.path).toBe(':id');
    expect(leaf(router).paramMap.get('id')).toBe('1234');
  });

  it('el reporte de rutas vive en dispatch-rutas y la URL vieja redirige', async () => {
    await router.navigateByUrl('/admin/reports/dispatch/dispatch-planillas');
    expect(router.url).toBe('/admin/reports/dispatch/dispatch-rutas');
    // El reportId se conserva: lo comparte el catálogo de reportes de Vexi.
    expect(leaf(router).data['reportId']).toBe('dispatch-planillas');

    const report = REPORT_DEFINITIONS.find((definition) => definition.id === 'dispatch-planillas');
    expect(report?.route).toBe('/admin/reports/dispatch/dispatch-rutas');
  });

  it('el menú y el catálogo de módulos apuntan a la URL nueva sin cambiar la key', () => {
    expect(MODULE_ROUTES['orders_dispatch_routes']).toBe('/admin/orders/rutas');

    const routes = menuRoutes(STORE_ADMIN_MENU_ITEMS);
    expect(routes).toContain('/admin/orders/rutas');
    expect(routes.filter((route) => route.includes('planillas'))).toEqual([]);
  });
});
