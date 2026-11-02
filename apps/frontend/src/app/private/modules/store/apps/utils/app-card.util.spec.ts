import { StoreApp } from '../interfaces/store-app.interface';
import { toAppCard } from './app-card.util';

const app = (over: Partial<StoreApp> = {}): StoreApp => ({
  key: 'ecommerce',
  name: 'Tienda en línea',
  description: 'Venta completa',
  applies_to_store_industries: true,
  status: 'not_installed',
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
    expect(card.action).toEqual({ kind: 'route', label: 'Administrar', route: '/admin/ecommerce' });
  });

  it('Tienda en línea en una tienda física: no disponible para el tipo de tienda', () => {
    const card = toAppCard(app(), 'physical');

    expect(card.action).toEqual({
      kind: 'disabled',
      label: 'No disponible para tu tipo de tienda',
    });
  });

  it('Landing sin publicar se configura desde /admin/apps (oferta y dominio, Fase 6)', () => {
    const card = toAppCard(app({ key: 'landing', name: 'Landing page' }), 'hybrid');

    expect(card.statusLabel).toBe('No instalada');
    expect(card.action).toEqual({ kind: 'configure', label: 'Configurar' });
  });

  it('Booking fuera de hotelería: no aplica a la industria', () => {
    const card = toAppCard(
      app({ key: 'booking', name: 'Booking', applies_to_store_industries: false }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'disabled', label: 'No aplica a tu industria' });
  });

  it('Inicio de tienda se configura desde la misma pantalla de Apps', () => {
    const card = toAppCard(app({ key: 'store_home', name: 'Inicio de tienda' }), 'physical');

    expect(card.action).toEqual({ kind: 'configure', label: 'Configurar' });
  });

  it('Página de producto se configura desde la misma pantalla de Apps', () => {
    const card = toAppCard(
      app({ key: 'product_page', name: 'Página de producto', status: 'draft' }),
      'hybrid',
    );

    expect(card.statusLabel).toBe('Borrador');
    expect(card.action).toEqual({ kind: 'configure', label: 'Configurar' });
  });

  it('Service page se configura desde la misma pantalla de Apps', () => {
    const card = toAppCard(
      app({ key: 'service_page', name: 'Service page', status: 'not_installed' }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'configure', label: 'Configurar' });
  });

  it('Booking en un hotel se configura desde la misma pantalla de Apps', () => {
    const card = toAppCard(
      app({ key: 'booking', name: 'Booking', applies_to_store_industries: true }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'configure', label: 'Configurar' });
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
    expect(toAppCard(app({ status: 'disabled' }), 'hybrid').statusLabel).toBe('Desactivada');
  });
});
