import { StoreApp } from '../interfaces/store-app.interface';
import { toAppCard } from './app-card.util';

const app = (over: Partial<StoreApp> = {}): StoreApp => ({
  key: 'ecommerce',
  name: 'Tienda en línea',
  description: 'Venta completa',
  applies_to_store_industries: true,
  status: 'not_installed',
  enabled: false,
  domain: null,
  public_url: null,
  published_at: null,
  ...over,
});

describe('toAppCard (apps-module T6)', () => {
  it('Tienda en línea publicada: estado, dominio, URL y botón a la pantalla de hoy', () => {
    const card = toAppCard(
      app({
        status: 'published',
        domain: { id: 1, hostname: 'roku-shop.vendix.online', status: 'active' },
        public_url: 'https://roku-shop.vendix.online',
      }),
      'hybrid',
    );

    expect(card.statusLabel).toBe('Publicada');
    expect(card.statusVariant).toBe('success');
    expect(card.hostname).toBe('roku-shop.vendix.online');
    expect(card.publicUrl).toBe('https://roku-shop.vendix.online');
    expect(card.action).toEqual({ kind: 'route', label: 'Administrar', route: '/admin/apps/ecommerce' });
  });

  it('Tienda en línea en una tienda física: no disponible para el tipo de tienda', () => {
    const card = toAppCard(app(), 'physical');

    expect(card.action).toEqual({
      kind: 'disabled',
      label: 'No disponible para tu tipo de tienda',
    });
  });

  it('Landing abre su propia vista /admin/apps/landing (apps-vistas-f1 S4)', () => {
    const card = toAppCard(app({ key: 'landing', name: 'Landing page' }), 'hybrid');

    expect(card.statusLabel).toBe('No instalada');
    expect(card.action).toEqual({ kind: 'route', label: 'Abrir', route: '/admin/apps/landing' });
  });

  it('Booking fuera de hotelería: no aplica a la industria', () => {
    const card = toAppCard(
      app({ key: 'booking', name: 'Booking', applies_to_store_industries: false }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'disabled', label: 'No aplica a tu industria' });
  });

  it('Inicio de tienda abre su vista /admin/apps/store-home', () => {
    const card = toAppCard(app({ key: 'store_home', name: 'Inicio de tienda' }), 'physical');

    expect(card.action).toEqual({ kind: 'route', label: 'Abrir', route: '/admin/apps/store-home' });
  });

  it('Página de producto abre su vista /admin/apps/product-page, sin modal', () => {
    const card = toAppCard(
      app({ key: 'product_page', name: 'Página de producto', status: 'draft' }),
      'hybrid',
    );

    expect(card.statusLabel).toBe('Borrador');
    expect(card.action).toEqual({ kind: 'route', label: 'Abrir', route: '/admin/apps/product-page' });
  });

  it('Service page abre su vista /admin/apps/service-page', () => {
    const card = toAppCard(
      app({ key: 'service_page', name: 'Service page', status: 'not_installed' }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'route', label: 'Abrir', route: '/admin/apps/service-page' });
  });

  it('Booking en un hotel abre su vista /admin/apps/booking', () => {
    const card = toAppCard(
      app({ key: 'booking', name: 'Booking', applies_to_store_industries: true }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'route', label: 'Abrir', route: '/admin/apps/booking' });
  });

  it('Página de producto fuera de las industrias que aplica sigue bloqueada', () => {
    const card = toAppCard(
      app({ key: 'product_page', applies_to_store_industries: false }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'disabled', label: 'No aplica a tu industria' });
  });

  it('traduce cada estado', () => {
    expect(toAppCard(app({ status: 'draft' }), 'hybrid').statusLabel).toBe('Borrador');
    expect(toAppCard(app({ status: 'disabled' }), 'hybrid').statusLabel).toBe('Apagada');
  });

  it('expone si la app está encendida (apps-vistas-f1 S2)', () => {
    expect(toAppCard(app({ status: 'draft', enabled: true }), 'hybrid').enabled).toBeTrue();
    expect(toAppCard(app({ status: 'disabled', enabled: false }), 'hybrid').enabled).toBeFalse();
  });

  it('ninguna tarjeta abre un modal: toda acción habilitada es una ruta (apps-vistas-f1 S6)', () => {
    const kinds = ['ecommerce', 'store_home', 'landing', 'product_page', 'service_page', 'booking'] as const;
    for (const key of kinds) {
      expect(toAppCard(app({ key }), 'hybrid').action.kind).toBe('route');
    }
  });
});
