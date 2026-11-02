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

  it('Landing sin publicar lleva a su pantalla actual para configurarla', () => {
    const card = toAppCard(app({ key: 'landing', name: 'Landing page' }), 'hybrid');

    expect(card.statusLabel).toBe('No instalada');
    expect(card.action).toEqual({ kind: 'route', label: 'Configurar', route: '/admin/customers/crm' });
  });

  it('Booking fuera de hotelería: no aplica a la industria', () => {
    const card = toAppCard(
      app({ key: 'booking', name: 'Booking', applies_to_store_industries: false }),
      'hybrid',
    );

    expect(card.action).toEqual({ kind: 'disabled', label: 'No aplica a tu industria' });
  });

  it('las apps sin pantalla todavía se muestran como próximamente', () => {
    for (const key of ['store_home', 'product_page', 'service_page', 'booking'] as const) {
      expect(toAppCard(app({ key }), 'hybrid').action)
        .withContext(key)
        .toEqual({ kind: 'disabled', label: 'Próximamente' });
    }
  });

  it('traduce cada estado', () => {
    expect(toAppCard(app({ status: 'draft' }), 'hybrid').statusLabel).toBe('Borrador');
    expect(toAppCard(app({ status: 'disabled' }), 'hybrid').statusLabel).toBe('Desactivada');
  });
});
