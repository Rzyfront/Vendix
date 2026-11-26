import { collectToolCatalog } from './tool-catalog.test-helper';
import {
  buildCapabilityCorpus,
  capabilityStems,
  findExistingCapabilities,
  toolCorpusEntry,
} from './capability-gap';

/**
 * T6 — the sweep runs against the REAL release catalog (same factories the
 * registry loads), so a renamed tool or a new one changes these answers.
 */
describe('capability-gap · barrido del catálogo antes de un ticket', () => {
  const corpus = collectToolCatalog()
    .map((entry) => toolCorpusEntry(entry.tool, true))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

  it('individual y masivo buscan los mismos sustantivos', () => {
    expect(capabilityStems('aplícale la tarifa Manaure a todos mis productos')).toEqual([
      'tarif',
      'manau',
      'produ',
    ]);
    expect(capabilityStems('aplicar tarifa a un producto')).toEqual(['tarif', 'produ']);
  });

  it('«aplicar tarifa a un producto» existe (set_product_tier_override): no hay ticket', () => {
    const names = findExistingCapabilities('aplicar tarifa a un producto', corpus, 50).map(
      (m) => m.name,
    );
    expect(names).toContain('set_product_tier_override');
    expect(names).toContain('manage_product_price_tiers');
  });

  it('la variante masiva también existe (manage_product_price_tiers)', () => {
    const [best] = findExistingCapabilities(
      'aplícale la tarifa Manaure a todos mis productos',
      corpus,
    );
    expect(['manage_product_price_tiers', 'preview_product_price_tiers']).toContain(
      best.name,
    );
  });

  it('«cámbiame el color del botón del carrito» no existe como herramienta', () => {
    expect(
      findExistingCapabilities('cámbiame el color del botón del carrito', corpus),
    ).toEqual([]);
  });

  it('una petición sin sustantivos no valida nada (no hay ticket a ciegas)', () => {
    expect(findExistingCapabilities('hazlo ya por favor', corpus)).toEqual([]);
    expect(capabilityStems('hazlo ya por favor')).toEqual([]);
  });

  it('una ruta del puente también cuenta y marca si la persona la alcanza', () => {
    const routes = buildCapabilityCorpus({
      tools: () => [],
      permittedToolNames: () => new Set(),
      routes: () => [
        {
          method: 'POST',
          path: 'store/loyalty/points/redeem',
          domain: 'loyalty',
          summary: 'Canjear puntos de fidelización de un cliente',
        },
      ],
      permittedRouteKeys: () => new Set(),
    });
    const [match] = findExistingCapabilities('canjear los puntos de fidelización', routes);
    expect(match).toMatchObject({
      kind: 'route',
      name: 'POST store/loyalty/points/redeem',
      permitted: false,
    });
  });
});
