/**
 * Tiquete POS — dirección con fallback fiscal + leyenda no fiscal.
 *
 * El ticket omitía la dirección cuando la tienda no tenía fila en `addresses`
 * (el compositor no emite fila con `undefined`: invariante 1), mientras la FE
 * sí la mostraba vía identidad fiscal. Ahora `store.address` cae a
 * `resolveFiscalIssuerForPrint(..., strict=false)` — un ticket nunca falla 422
 * por datos fiscales ausentes — y el modelo publica
 * `document.non_fiscal_disclaimer` con el texto único (real + muestra).
 */
import { PosSaleTicketDataProvider } from '../pos-sale-ticket.provider';

const DISCLAIMER = 'Este documento no es factura electrónica de venta.';

function baseOrder(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    order_number: 'POS-1',
    status: 'finished',
    discount_amount: 0,
    tax_amount: 0,
    shipping_cost: 0,
    grand_total: 10000,
    subtotal_amount: 10000,
    created_at: new Date('2026-09-24T10:00:00Z'),
    users: null,
    table_sessions: [],
    order_items: [],
    payments: [],
    stores: {
      id: 1,
      name: 'Tienda Demo',
      legal_name: null,
      tax_id: null,
      phone: null,
      email: null,
      addresses: [],
      store_settings: { settings: {} },
      organizations: {
        id: 1,
        fiscal_scope: 'STORE',
        tax_id: '900123456',
        legal_name: 'Org Demo S.A.S.',
        addresses: [],
        organization_settings: { settings: {} },
      },
    },
    ...overrides,
  };
}

describe('pos-sale-ticket: store.address con fallback fiscal', () => {
  const provider = new PosSaleTicketDataProvider({} as any);
  const map = (order: any) =>
    (provider as any).mapOrderToStandardModel(order) as any;

  it('con fila en `addresses` usa el formato existente (línea1 + línea2)', () => {
    const order = baseOrder();
    order.stores.addresses = [
      { address_line1: 'Calle 45 # 12-30', address_line2: 'Local 101' },
    ];
    expect(map(order).store.address).toBe('Calle 45 # 12-30 Local 101');
  });

  it('sin fila en tienda + alcance ORGANIZATION cae a la dirección de la org', () => {
    const order = baseOrder();
    order.stores.addresses = [];
    order.stores.organizations.fiscal_scope = 'ORGANIZATION';
    order.stores.organizations.addresses = [
      { address_line1: 'Carrera 15 # 88-64', city: 'Bogotá D.C.' },
    ];
    const address = map(order).store.address;
    expect(address).toBeDefined();
    expect(address).toContain('Carrera 15 # 88-64');
  });

  it('sin dirección en ningún lado queda `undefined` (fila omitida, sin 422)', () => {
    const order = baseOrder();
    order.stores.addresses = [];
    order.stores.organizations.addresses = [];
    expect(() => map(order)).not.toThrow();
    expect(map(order).store.address).toBeUndefined();
  });
});

describe('pos-sale-ticket: leyenda no fiscal', () => {
  const provider = new PosSaleTicketDataProvider({} as any);

  it('el carril real publica el texto único', () => {
    const model = (provider as any).mapOrderToStandardModel(baseOrder());
    expect(model.document.non_fiscal_disclaimer).toBe(DISCLAIMER);
  });

  it('la muestra publica el mismo texto (paridad ADR-2)', async () => {
    const sample = await provider.getSampleData(1);
    expect(sample.document.non_fiscal_disclaimer).toBe(DISCLAIMER);
  });

  it('el token queda disponible para customs', () => {
    const paths = provider.getAvailableTokens().map((t: any) => t.path);
    expect(paths).toContain('document.non_fiscal_disclaimer');
  });
});
