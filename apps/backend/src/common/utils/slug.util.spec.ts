import { generateSlug, isValidSlug } from './slug.util';

describe('generateSlug', () => {
  it('keeps accented letters as their base letter instead of dropping them', () => {
    expect(generateSlug('Alquiler cancha fútbol 5 (1 hora)')).toBe(
      'alquiler-cancha-futbol-5-1-hora',
    );
    expect(generateSlug('Cabaña')).toBe('cabana');
    expect(generateSlug('Jugo de piña')).toBe('jugo-de-pina');
    expect(generateSlug('ÁRBOL Ñandú')).toBe('arbol-nandu');
  });

  it('produces slugs that pass isValidSlug', () => {
    expect(isValidSlug(generateSlug('Habitación Doble Estándar'))).toBe(true);
  });

  it('keeps the previous behavior for plain ASCII names', () => {
    expect(generateSlug('  Hello World_Test--Item!  ')).toBe(
      'hello-world-test-item',
    );
    expect(generateSlug('Product 123')).toBe('product-123');
  });
});
