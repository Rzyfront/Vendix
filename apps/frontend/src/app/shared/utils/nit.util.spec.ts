/**
 * Spec de `nit.util.ts` — el MÓDULO 11 de la DIAN compartido.
 *
 * A.8 la convierte en contrato con casos frontera porque hoy de ella cuelgan,
 * al menos, el checkout de suscripciones (`billingDvDisplay`), la validación
 * del modal de clientes, el wizard DIAN y la sección Adquiriente de la
 * factura (`computedCustomerDv`): un cambio silencioso en el algoritmo sería
 * un rechazo DIAN masivo con consecutivos quemados.
 *
 * Sobre «DV=K»: el módulo 11 GENÉRICO produce 10 y lo escribe como `K`. La
 * variante NIT de la DIAN NO: resto 0 o 1 se quedan igual y el resto se
 * reporta como `11 - resto`, que nunca pasa de 9. Los casos frontera lo
 * fijan como propiedad, no como accidente.
 */
import { computeNitDv, isValidNitDv, nitDvGroupValidator } from './nit.util';

/**
 * Doble mínimo de `AbstractControl` para el validador de grupo.
 *
 * El validador sólo lee `control.get(clave)?.value`, así que un objeto con
 * esa forma ejercita SU lógica real (guarda de vacío, recorte del sufijo
 * `-dv`, comparación módulo 11) sin arrastrar el runtime de `@angular/forms`
 * a este archivo. La forma tipada del parámetro es la misma firma pública.
 */
function groupOf(values: Record<string, unknown>): any {
  return {
    get: (key: string) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? { value: values[key] }
        : null,
  };
}

describe('computeNitDv (módulo 11 DIAN)', () => {
  it('calcula el DV de NITs reales', () => {
    expect(computeNitDv('900123456')).toBe('8');
    expect(computeNitDv('800987654')).toBe('4');
  });

  it('frontera DV=0: resto 11 ⇒ el mismo 0, nunca 11 ni K', () => {
    // 15: 5·3 + 1·7 = 22 → 22 % 11 = 0.
    expect(computeNitDv('15')).toBe('0');
    expect(Number(computeNitDv('15'))).toBe(0);
  });

  it('frontera DV=1: resto 1 ⇒ 1, no 10', () => {
    // 4: 4·3 = 12 → 12 % 11 = 1. La rama `mod === 1` devuelve el MISMO 1;
    // aplicarle `11 - mod` daría 10 («K»), que es justo el error clásico.
    expect(computeNitDv('4')).toBe('1');
  });

  it('recorta un DV pegado con guion antes de calcular (900123456-8)', () => {
    expect(computeNitDv('900123456-8')).toBe('8');
    expect(computeNitDv('800.987.654-4')).toBe('4');
  });

  it('NIT dígito a dígito: un solo dígito usa el primer peso (3)', () => {
    // 5·3 = 15 → 15 % 11 = 4 → 11 - 4 = 7.
    expect(computeNitDv('5')).toBe('7');
  });

  it('vacío, sin dígitos, null o undefined ⇒ null (no "0")', () => {
    expect(computeNitDv('')).toBeNull();
    expect(computeNitDv('   ')).toBeNull();
    expect(computeNitDv('abc')).toBeNull();
    expect(computeNitDv(null)).toBeNull();
    expect(computeNitDv(undefined)).toBeNull();
  });

  it('el resultado es SIEMPRE un dígito 0-9: la variante DIAN no produce K', () => {
    // Barrido amplio incluyendo números con muchos dígitos (pesos altos) y
    // con ceros a la izquierda conservados como string.
    const samples: string[] = [];
    for (let n = 1; n <= 20000; n++) samples.push(String(n));
    for (const big of ['999999999999999', '1000000000000001', '901', '9']) {
      samples.push(big);
    }
    for (const sample of samples) {
      const dv = computeNitDv(sample);
      expect(dv).not.toBeNull();
      expect(dv!).toMatch(/^[0-9]$/);
      expect(dv!.length).toBe(1);
    }
  });
});

describe('isValidNitDv', () => {
  it('acepta el par coherente y rechaza el incoherente', () => {
    expect(isValidNitDv('900123456', '8')).toBeTrue();
    expect(isValidNitDv('900123456', '7')).toBeFalse();
  });

  it('acepta el DV como número y tolera separadores en el NIT', () => {
    expect(isValidNitDv('800.987.654', 4)).toBeTrue();
  });

  it('sin NIT no hay validez que declarar', () => {
    expect(isValidNitDv('', '8')).toBeFalse();
  });
});

describe('nitDvGroupValidator', () => {
  it('con las claves por defecto (nit/nit_dv) pasa el par bueno y marca el malo con el esperado', () => {
    expect(
      nitDvGroupValidator()(groupOf({ nit: '900123456', nit_dv: '8' })),
    ).toBeNull();

    expect(
      nitDvGroupValidator()(groupOf({ nit: '900123456', nit_dv: '7' })),
    ).toEqual({ nitDv: { expected: '8' } });
  });

  it('con claves personalizadas cubre el formulario de clientes (document_number/verification_digit)', () => {
    const validator = nitDvGroupValidator(
      'document_number',
      'verification_digit',
    );
    expect(
      validator(groupOf({ document_number: '800987654', verification_digit: '4' })),
    ).toBeNull();

    expect(
      validator(groupOf({ document_number: '800987654', verification_digit: '9' })),
    ).toEqual({ nitDv: { expected: '4' } });
  });

  it('DV vacío o ausente pasa por la guarda: exigir presencia es trabajo de Validators.required', () => {
    expect(nitDvGroupValidator()(groupOf({ nit: '900123456', nit_dv: '' }))).toBeNull();
    expect(nitDvGroupValidator()(groupOf({ nit: '900123456' }))).toBeNull();
  });

  it('claves con nombres equivocados NO validan en silencio (comportamiento documentado de la fábrica)', () => {
    // La razón de ser de los parámetros: engancharla con otros nombres es un
    // no-op silencioso. El spec lo fija para que nadie confíe en el default.
    expect(
      nitDvGroupValidator()(groupOf({ document_number: '900123456', verification_digit: '7' })),
    ).toBeNull();
  });

  it('un NIT escrito con el DV pegado no dispara error falso: recorta el sufijo', () => {
    expect(
      nitDvGroupValidator()(groupOf({ nit: '900123456-8', nit_dv: '8' })),
    ).toBeNull();
    expect(
      nitDvGroupValidator()(groupOf({ nit: '900123456-8', nit_dv: '7' })),
    ).toEqual({ nitDv: { expected: '8' } });
  });
});
