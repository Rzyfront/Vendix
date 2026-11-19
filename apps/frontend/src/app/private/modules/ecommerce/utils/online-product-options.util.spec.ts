import { allowsOnlineProductOptions } from './online-product-options.util';

/** QUI-1005 — «Permitir adiciones en la tienda en línea» (default permitidas). */
describe('allowsOnlineProductOptions', () => {
  it('sin config o sin sección product_options deja las adiciones como hoy', () => {
    expect(allowsOnlineProductOptions(undefined)).toBeTrue();
    expect(allowsOnlineProductOptions(null)).toBeTrue();
    expect(allowsOnlineProductOptions({})).toBeTrue();
    expect(allowsOnlineProductOptions({ product_options: null })).toBeTrue();
  });

  it('una tienda que guardó la sección antes del flag sigue permitiéndolas', () => {
    expect(allowsOnlineProductOptions({ product_options: { enabled: true } })).toBeTrue();
    expect(
      allowsOnlineProductOptions({ product_options: { enabled: true, allow_online: true } }),
    ).toBeTrue();
  });

  it('solo un false explícito las apaga en la tienda en línea', () => {
    expect(
      allowsOnlineProductOptions({ product_options: { enabled: true, allow_online: false } }),
    ).toBeFalse();
  });
});
