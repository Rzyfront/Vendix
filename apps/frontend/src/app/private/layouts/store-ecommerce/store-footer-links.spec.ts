import { canonicalStoreLinkUrl } from './store-footer-links';

describe('canonicalStoreLinkUrl', () => {
  it('cambia los alias del pie por la URL canónica', () => {
    expect(canonicalStoreLinkUrl('/products', false)).toBe('/catalog');
    expect(canonicalStoreLinkUrl('/new', false)).toBe('/novedades');
    expect(canonicalStoreLinkUrl('/sale', false)).toBe('/ofertas');
  });

  it('conserva la query y tolera la barra final', () => {
    expect(canonicalStoreLinkUrl('/products/?category=bebidas', false)).toBe('/catalog?category=bebidas');
  });

  it('no toca rutas canónicas, fichas de producto ni enlaces externos', () => {
    expect(canonicalStoreLinkUrl('/catalog', false)).toBe('/catalog');
    expect(canonicalStoreLinkUrl('/products/pollo-asado', false)).toBe('/products/pollo-asado');
    expect(canonicalStoreLinkUrl('https://example.com/products', true)).toBe('https://example.com/products');
    expect(canonicalStoreLinkUrl('/', false)).toBe('/');
  });
});
