import { readFileSync } from 'fs';
import { join } from 'path';
import {
  StorefrontCard,
  createStorefrontTools,
  storefrontCardSink,
} from './storefront.tools';

/** Vexi público F2 — storefront tools read the public catalog and never write. */

const SHIRT = {
  id: 5,
  name: 'Camiseta',
  sku: 'CAM',
  final_price: 50000,
  product_type: 'physical',
  is_available: true,
  variants: [
    { id: 51, name: 'Talla M', sku: 'CAM-M', final_price: 52000, is_available: true },
  ],
};
const MUG = { id: 6, name: 'Taza', sku: 'TAZ', final_price: '20000.00', product_type: 'physical', variants: [] };
const MASSAGE = { id: 7, name: 'Masaje', product_type: 'service', requires_booking: true, slug: 'masaje' };

function tools(products: any[] = [SHIRT, MUG, MASSAGE]) {
  const catalog = {
    getProducts: jest.fn().mockImplementation(async (q: any) => ({
      data: q.ids
        ? products.filter((p) => String(q.ids).split(',').map(Number).includes(p.id))
        : products,
    })),
  };
  const list = createStorefrontTools({ catalog });
  const byName = Object.fromEntries(list.map((t) => [t.name, t]));
  return { catalog, byName };
}

async function call(tool: any, args: any) {
  const cards: StorefrontCard[] = [];
  const raw = await storefrontCardSink.run(cards, () => tool.handler(args, {}));
  return { result: JSON.parse(raw), cards };
}

describe('storefront tools', () => {
  it('propose_order validates against the public catalog and emits an order card', async () => {
    const { byName } = tools();
    const { result, cards } = await call(byName.storefront_propose_order, {
      items: [
        { product_id: 5, variant_id: 51, quantity: 2 },
        { product_id: 6, quantity: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(cards).toEqual([
      {
        kind: 'order',
        items: [
          { product_id: 5, variant_id: 51, name: 'Camiseta', variant_name: 'Talla M', sku: 'CAM-M', quantity: 2, unit_price: 52000 },
          { product_id: 6, variant_id: null, name: 'Taza', variant_name: null, sku: 'TAZ', quantity: 1, unit_price: 20000 },
        ],
      },
    ]);
    // No invented total: the checkout calculates it.
    expect(JSON.stringify(result)).not.toMatch(/"total"/);
  });

  it.each([
    [{ items: [{ product_id: 404, quantity: 1 }] }, /no está publicado/],
    [{ items: [{ product_id: 5, quantity: 1 }] }, /tiene variantes/],
    [{ items: [{ product_id: 5, variant_id: 99, quantity: 1 }] }, /no pertenece/],
    [{ items: [{ product_id: 7, quantity: 1 }] }, /servicio con reserva/],
  ])('propose_order refuses %j without emitting a card', async (args, error) => {
    const { byName } = tools();
    const { result, cards } = await call(byName.storefront_propose_order, args);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(error);
    expect(cards).toEqual([]);
  });

  it('propose_booking only accepts a published service', async () => {
    const { byName } = tools();
    const ok = await call(byName.storefront_propose_booking, { product_id: 7 });
    expect(ok.cards).toEqual([{ kind: 'booking', product_id: 7, name: 'Masaje', slug: 'masaje' }]);
    const notService = await call(byName.storefront_propose_booking, { product_id: 6 });
    expect(notService.result.ok).toBe(false);
    expect(notService.cards).toEqual([]);
  });

  it('propose_request builds a PQR card (no radicado until the visitor submits it)', async () => {
    const { byName } = tools();
    const { cards } = await call(byName.storefront_propose_request, {
      pqr_type: 'COMPLAINT',
      subject: 'Pedido tarde',
      description: 'Mi pedido llegó dos días tarde.',
    });
    expect(cards).toEqual([
      { kind: 'request', pqr_type: 'COMPLAINT', subject: 'Pedido tarde', description: 'Mi pedido llegó dos días tarde.' },
    ]);
  });

  it('search returns only public catalog fields', async () => {
    const { byName, catalog } = tools();
    const { result } = await call(byName.storefront_search_products, { query: 'cam' });
    expect(catalog.getProducts).toHaveBeenCalledWith(expect.objectContaining({ search: 'cam' }));
    expect(Object.keys(result.products[0]).sort()).toEqual(['available', 'id', 'name', 'price', 'type', 'variants']);
  });

  it('every tool is read-only, public, in the storefront domain, and the file has no write dependency', () => {
    const { byName } = tools();
    for (const tool of Object.values(byName) as any[]) {
      expect(tool).toMatchObject({ domain: 'storefront', access: 'public', readOnly: true });
      expect(tool.requiresConfirmation).toBeFalsy();
    }
    const imports = (
      readFileSync(join(__dirname, 'storefront.tools.ts'), 'utf8').match(/from '[^']+'/g) ?? []
    ).join('\n');
    // Only the tool contract, the catalog constants and node built-ins.
    expect(imports.split('\n').sort()).toEqual(
      ["from '../agent-tool-catalog'", "from '../interfaces/tool.interface'", "from 'node:async_hooks'"].sort(),
    );
  });
});
