import {
  buildProductPageHostname,
  cleanHostnameSlug,
} from './product-page-hostname';

const free = () => false;

describe('buildProductPageHostname', () => {
  it('joins store and product slugs on the base domain', () => {
    expect(
      buildProductPageHostname('Roku', 'Leche UHT Entera', 'vendix.online', free),
    ).toBe('roku-leche-uht-entera.vendix.online');
  });

  it('never ends on a suffix another app owns', () => {
    for (const reserved of ['shop', 'mi-store', 'landing', 'booking', 'service', 'org', 'admin']) {
      const host = buildProductPageHostname('roku', reserved, 'vendix.online', free);
      expect(host).toBe(`roku-${reserved}-producto.vendix.online`);
    }
  });

  it('keeps a reserved word that is not the last segment', () => {
    expect(
      buildProductPageHostname('roku', 'shop-bolso', 'vendix.online', free),
    ).toBe('roku-shop-bolso.vendix.online');
  });

  it('adds -2, -3 on collisions', () => {
    const taken = new Set([
      'roku-bolso.vendix.online',
      'roku-bolso-2.vendix.online',
    ]);
    expect(
      buildProductPageHostname('roku', 'bolso', 'vendix.online', (h) => taken.has(h)),
    ).toBe('roku-bolso-3.vendix.online');
  });

  it('returns null when every attempt is taken', () => {
    expect(buildProductPageHostname('roku', 'bolso', 'vendix.online', () => true)).toBeNull();
  });

  it('keeps the DNS label within 63 characters, suffix included', () => {
    const long = 'a'.repeat(80);
    const first = buildProductPageHostname('roku', long, 'vendix.online', free)!;
    expect(first.split('.')[0].length).toBe(63);

    const second = buildProductPageHostname(
      'roku',
      long,
      'vendix.online',
      (h) => h === first,
    )!;
    const label = second.split('.')[0];
    expect(label.length).toBeLessThanOrEqual(63);
    expect(label.endsWith('-2')).toBe(true);
  });

  it('falls back to "producto" when the product slug cleans to nothing', () => {
    expect(buildProductPageHostname('roku', '¡¡¡', 'vendix.online', free)).toBe(
      'roku-producto.vendix.online',
    );
  });
});

describe('cleanHostnameSlug', () => {
  it('strips accents, symbols and repeated hyphens', () => {
    expect(cleanHostnameSlug('  Café -- Ñandú! ')).toBe('cafe-nandu');
  });
});
