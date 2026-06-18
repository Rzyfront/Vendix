import { TestBed } from '@angular/core/testing';
import { Router, NavigationEnd, Event } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { BreadcrumbService } from './breadcrumb.service';

describe('BreadcrumbService', () => {
  let service: BreadcrumbService;
  let titleSetSpy: jasmine.Spy;
  let routerEvents$: Subject<Event>;
  let routerStub: Partial<Router>;

  beforeEach(() => {
    routerEvents$ = new Subject<Event>();
    routerStub = {
      url: '/dashboard',
      events: routerEvents$.asObservable(),
    };
    titleSetSpy = spyOn(Title.prototype, 'setTitle');

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: routerStub },
        BreadcrumbService,
      ],
    });

    service = TestBed.inject(BreadcrumbService);
  });

  describe('analytics 8 shells + sub-tabs (ISSUE-08)', () => {
    const analyticsExpectations: Array<{
      url: string;
      expectedTitle: string;
      expectedParent?: string;
    }> = [
      // Overview shell
      { url: '/admin/analytics/overview', expectedTitle: 'Resumen General' },

      // Sales shell (6 sub-tabs)
      { url: '/admin/analytics/sales', expectedTitle: 'Ventas', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/sales/summary', expectedTitle: 'Resumen de Ventas', expectedParent: 'Ventas' },
      { url: '/admin/analytics/sales/by-product', expectedTitle: 'Por Producto', expectedParent: 'Ventas' },
      { url: '/admin/analytics/sales/by-category', expectedTitle: 'Por Categoria', expectedParent: 'Ventas' },
      { url: '/admin/analytics/sales/trends', expectedTitle: 'Tendencias', expectedParent: 'Ventas' },
      { url: '/admin/analytics/sales/by-customer', expectedTitle: 'Por Cliente', expectedParent: 'Ventas' },
      { url: '/admin/analytics/sales/by-payment', expectedTitle: 'Por Metodo de Pago', expectedParent: 'Ventas' },

      // Inventory shell (5 sub-tabs)
      { url: '/admin/analytics/inventory', expectedTitle: 'Inventario', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/inventory/overview', expectedTitle: 'Resumen de Inventario', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/inventory/stock-info', expectedTitle: 'Info de Stock', expectedParent: 'Inventario' },
      { url: '/admin/analytics/inventory/movements', expectedTitle: 'Movimientos de Inventario', expectedParent: 'Inventario' },
      { url: '/admin/analytics/inventory/valuation', expectedTitle: 'Valoracion', expectedParent: 'Inventario' },
      { url: '/admin/analytics/inventory/movement-analysis', expectedTitle: 'Analisis de Movimientos', expectedParent: 'Inventario' },

      // Products shell (3 sub-tabs)
      { url: '/admin/analytics/products', expectedTitle: 'Productos', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/products/performance', expectedTitle: 'Rendimiento', expectedParent: 'Productos' },
      { url: '/admin/analytics/products/top-sellers', expectedTitle: 'Top Ventas', expectedParent: 'Productos' },
      { url: '/admin/analytics/products/profitability', expectedTitle: 'Rentabilidad', expectedParent: 'Productos' },

      // Purchases shell (2 sub-tabs)
      { url: '/admin/analytics/purchases', expectedTitle: 'Compras', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/purchases/summary', expectedTitle: 'Resumen de Compras', expectedParent: 'Compras' },
      { url: '/admin/analytics/purchases/by-supplier', expectedTitle: 'Compras por Proveedor', expectedParent: 'Compras' },

      // Customers shell (3 sub-tabs)
      { url: '/admin/analytics/customers', expectedTitle: 'Clientes', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/customers/summary', expectedTitle: 'Resumen de Clientes', expectedParent: 'Clientes' },
      { url: '/admin/analytics/customers/acquisition', expectedTitle: 'Adquisición de Clientes', expectedParent: 'Clientes' },
      { url: '/admin/analytics/customers/abandoned-carts', expectedTitle: 'Carritos Abandonados', expectedParent: 'Clientes' },

      // Reviews shell (1 sub-tab)
      { url: '/admin/analytics/reviews', expectedTitle: 'Reseñas', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/reviews/summary', expectedTitle: 'Resumen de Reseñas', expectedParent: 'Reseñas' },

      // Financial shell (3 sub-tabs)
      { url: '/admin/analytics/financial', expectedTitle: 'Financiero', expectedParent: 'Analíticas' },
      { url: '/admin/analytics/financial/profit-loss', expectedTitle: 'Ganancias y Pérdidas', expectedParent: 'Financiero' },
      { url: '/admin/analytics/financial/tax-summary', expectedTitle: 'Resumen de Impuestos', expectedParent: 'Financiero' },
      { url: '/admin/analytics/financial/refunds', expectedTitle: 'Reembolsos', expectedParent: 'Financiero' },
    ];

    analyticsExpectations.forEach(({ url, expectedTitle, expectedParent }) => {
      it(`resolves ${url} → title="${expectedTitle}"`, () => {
        // Re-create the service so the static table is populated for this test
        // (the seeded registry entries are async; the static table has the same paths)
        routerEvents$.next(new NavigationEnd(1, url, url));
        const crumb = service.breadcrumb();
        expect(crumb.current.label).toBe(expectedTitle);
        if (expectedParent) {
          expect(crumb.parent?.label).toBe(expectedParent);
        }
      });
    });
  });

  describe('document.title sync (effect)', () => {
    it('sets title with "Padre > Hijo | Vendix" format on admin route', () => {
      // Reset spy (constructor's effect ran once at boot for the default url)
      titleSetSpy.calls.reset();

      routerEvents$.next(
        new NavigationEnd(
          2,
          '/admin/analytics/sales/by-product',
          '/admin/analytics/sales/by-product',
        ),
      );
      TestBed.tick();

      expect(titleSetSpy).toHaveBeenCalledWith('Ventas > Por Producto | Vendix');
    });

    it('uses just the tab name when there is no parent', () => {
      titleSetSpy.calls.reset();

      routerEvents$.next(new NavigationEnd(3, '/dashboard', '/dashboard'));
      TestBed.tick();

      // /dashboard has no parent in the table → "Dashboard | Vendix"
      expect(titleSetSpy).toHaveBeenCalledWith('Dashboard | Vendix');
    });

    it('does NOT call setTitle when the breadcrumb is the default fallback (no match)', () => {
      titleSetSpy.calls.reset();

      routerEvents$.next(new NavigationEnd(4, '/unknown/route', '/unknown/route'));
      TestBed.tick();

      // Guard: avoids clobbering the public store-ecommerce layout's title
      expect(titleSetSpy).not.toHaveBeenCalled();
    });
  });
});
