import { APP_SLUGS, APPS_WITH_VIEW, appKindFromSlug, appViewRoute } from './app-routes.util';

describe('app-routes.util (apps-vistas-f1 S3/S5)', () => {
  it('cada app con vista tiene una ruta recargable /admin/apps/:slug', () => {
    expect(APPS_WITH_VIEW.map((kind) => appViewRoute(kind))).toEqual([
      '/admin/apps/store-home',
      '/admin/apps/landing',
      '/admin/apps/product-page',
      '/admin/apps/service-page',
      '/admin/apps/booking',
    ]);
  });

  it('la tienda en línea sigue en /admin/ecommerce', () => {
    expect(appViewRoute('ecommerce')).toBe('/admin/ecommerce');
    expect(appKindFromSlug('ecommerce')).toBeNull();
  });

  it('traduce el slug de la URL al kind de la API y rechaza lo desconocido', () => {
    for (const kind of APPS_WITH_VIEW) {
      expect(appKindFromSlug(APP_SLUGS[kind])).toBe(kind);
    }
    expect(appKindFromSlug('product_page')).toBeNull();
    expect(appKindFromSlug('menu')).toBeNull();
    expect(appKindFromSlug(null)).toBeNull();
  });
});
