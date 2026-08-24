import { VendixHttpException } from 'src/common/errors';

import {
  AIU_BUCKETS,
  AIU_TAXABLE_BUCKETS_BY_BASIS,
  AiuTaxableBasis,
  buildDefaultAiuProfileConfig,
  resolveAiuTaxableBasis,
} from './invoice-profile-config.contract';
import {
  assertValidInvoiceProfileConfig,
  normalizeAndAssertProfileConfig,
} from './invoice-profile-config.validator';

describe('assertValidInvoiceProfileConfig', () => {
  const valid = () =>
    JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Vigilancia sede sur')),
    );

  it('una configuración válida no lanza', () => {
    expect(() =>
      assertValidInvoiceProfileConfig(valid(), { operation_type: '09' }),
    ).not.toThrow();
  });

  it('lanza INVOICING_PROFILE_005 con 422 y la lista completa de problemas', () => {
    const config = valid();
    // `components_basis` tiene que ser 'aiu' para que la suma se mida contra
    // 100: bajo la unidad por omisión ('contract') los tres componentes son
    // porcentajes DEL VALOR DEL CONTRATO, y 50+10+10 = 70 % es un reparto
    // perfectamente legal —el 30 % restante es costo—. Sin esta línea el
    // fixture sólo produce UN problema y el test dejaba de comprobar lo que
    // dice comprobar: que la excepción lista TODOS los problemas juntos.
    config.aiu.components_basis = 'aiu';
    config.aiu.components = {
      administracion: '50.00',
      imprevistos: '10.00',
      utilidad: '10.00',
    };
    config.aiu.minimum_base_percent = '4.00';

    let error: any;
    try {
      assertValidInvoiceProfileConfig(config, {
        operation_type: '09',
        profile_id: 42,
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    // `details` viaja DENTRO del cuerpo de la respuesta, no como campo de la
    // instancia: se afirma lo que el cliente recibe.
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        error_code: 'INVOICING_PROFILE_005',
        details: expect.objectContaining({
          profile_id: 42,
          operation_type: '09',
          issue_count: 2,
          issues: expect.arrayContaining([
            expect.objectContaining({
              field: 'aiu.components',
              code: 'AIU_PERCENT_SUM',
            }),
            expect.objectContaining({
              field: 'aiu.minimum_base_percent',
              code: 'AIU_FLOOR_BELOW_LEGAL',
            }),
          ]),
        }),
      }),
    );
  });

  it('el mensaje dice cuántos problemas más hay, para no esconderlos', () => {
    const config = valid();
    config.aiu.components = {
      administracion: '1.00',
      imprevistos: '1.00',
      utilidad: '1.00',
    };
    config.aiu.contract_object = '';
    config.format.display_decimals = 99;

    try {
      assertValidInvoiceProfileConfig(config, { operation_type: '09' });
      fail('debía lanzar');
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.details.issue_count).toBe(3);
      expect(body.message).toContain('2 problemas más');
    }
  });

  it('con un solo problema el mensaje es el del problema, sin sufijo', () => {
    const config = valid();
    config.format.display_decimals = 12;
    try {
      assertValidInvoiceProfileConfig(config, { operation_type: '09' });
      fail('debía lanzar');
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.details.issue_count).toBe(1);
      expect(body.message).not.toContain('más');
    }
  });

  it('omite profile_id cuando el perfil todavía no existe (creación)', () => {
    const config = valid();
    config.aiu.regime = 'et_999';
    try {
      assertValidInvoiceProfileConfig(config, { operation_type: '09' });
      fail('debía lanzar');
    } catch (e: any) {
      expect(e.getResponse().details).not.toHaveProperty('profile_id');
    }
  });
});

/**
 * Estos tests entran por `normalizeAndAssertProfileConfig` —la puerta que
 * `ProfilesService` usa de verdad (`profiles.service.ts:420`, `:502`, `:511`,
 * `:598`)— y NO por `validateInvoiceProfileConfig`.
 *
 * La distinción es la que dejó `taxable_basis` inerte al introducirlo: el
 * validador puro aprobaba el campo, pero la puerta real normaliza ANTES de
 * validar, y `pickKnownKeys` borraba toda clave ausente de la allowlist
 * `AIU_KEYS` emitiendo `UNKNOWN_KEY`, que bloquea. Nueve tests verdes contra un
 * objeto que el sistema rechazaba con 422 en las cuatro rutas de escritura.
 *
 * Regla que estos tests fijan: una config sólo está probada si atravesó la
 * puerta y salió con el campo puesto.
 */
describe('normalizeAndAssertProfileConfig — taxable_basis atraviesa la puerta real', () => {
  const opts = { operation_type: '09' as const };
  /**
   * Construye una config con la base pedida Y la matriz de tributos coherente
   * con ella.
   *
   * Las dos cosas van juntas por obligación, no por comodidad del test: la
   * matriz declara qué porciones del contrato se gravan, y bajo `'subtotal'`
   * entra también el costo reembolsable. Dejar la matriz por omisión
   * —`costo.taxable = false`— y sólo mover la base produce un perfil que
   * `validateTaxSection` rechaza, y con razón: `isAiuTaxable` grava toda
   * porción bajo esa base, así que el documento se emitiría gravando un costo
   * que su propio perfil declara exento.
   *
   * Consecuencia para la UI: el control de base gravable no puede escribir sólo
   * `taxable_basis`. Tiene que reproyectar la matriz sobre
   * `AIU_TAXABLE_BUCKETS_BY_BASIS[base]` en el mismo cambio, o el guardado sale
   * 422 sobre una casilla que la persona no tocó.
   */
  const withBasis = (basis: string) => {
    const config: any = JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Vigilancia sede sur')),
    );
    config.aiu.taxable_basis = basis;
    const taxable = AIU_TAXABLE_BUCKETS_BY_BASIS[basis as AiuTaxableBasis];
    // Una base inválida no tiene matriz que proyectar: se deja la de por
    // omisión, que es lo que un cliente mandaría de verdad —basura en la base,
    // matriz normal—, y así el rechazo lo produce la puerta y no este helper.
    if (!taxable) return config;
    config.taxes.rules = AIU_BUCKETS.map((bucket) => {
      const existing = config.taxes.rules.find((r: any) => r.bucket === bucket);
      const shouldBeTaxable = taxable.includes(bucket);
      return {
        bucket,
        tax_code: existing?.tax_code ?? '01',
        rate: shouldBeTaxable ? (existing?.rate ?? '19.00') : '0.00',
        taxable: shouldBeTaxable,
      };
    });
    return config;
  };

  it.each(['aiu', 'utilidad', 'subtotal'])(
    "'%s' sobrevive a la normalización y sale en el snapshot persistible",
    (basis) => {
      const saved = normalizeAndAssertProfileConfig(withBasis(basis), opts);

      // No basta con que no lance: `pickKnownKeys` PROYECTA sobre la allowlist,
      // así que una clave ausente de `AIU_KEYS` se iría en silencio si el
      // `UNKNOWN_KEY` no fuera bloqueante. Se afirma el valor de salida.
      expect(saved.aiu?.taxable_basis).toBe(basis);
      expect(resolveAiuTaxableBasis(saved.aiu)).toBe(basis);
    },
  );

  it('la base declarada gana sobre el `regime` heredado, no al revés', () => {
    // Un perfil migrado trae los dos campos. Si la puerta resolviera por
    // `regime`, `'subtotal'` sería inalcanzable para todo perfil preexistente.
    const config = withBasis('subtotal');
    config.aiu.regime = 'et_462_1';

    const saved = normalizeAndAssertProfileConfig(config, opts);

    expect(resolveAiuTaxableBasis(saved.aiu)).toBe('subtotal');
  });

  it('una base inventada se rechaza en la puerta, no se guarda en silencio', () => {
    let error: any;
    try {
      normalizeAndAssertProfileConfig(withBasis('solo_el_iva'), opts);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ field: 'aiu.taxable_basis' }),
          ]),
        }),
      }),
    );
  });

  it('un `regime` corrupto cae en la base MÁS AMPLIA, no en la más estrecha', () => {
    // Dirección deliberada: declarar de más se corrige con nota crédito;
    // declarar de menos es sanción e intereses. Escrito al revés —preguntando
    // por `et_462_1`— este caso gravaría sólo la utilidad y ningún otro test
    // lo notaría, porque los demás sólo usan los dos valores donde ambas
    // versiones del ternario coinciden.
    expect(resolveAiuTaxableBasis({ regime: 'et_999' as any })).toBe('aiu');
    expect(resolveAiuTaxableBasis({} as any)).toBe('aiu');
    expect(resolveAiuTaxableBasis(null)).toBe('aiu');
    expect(
      resolveAiuTaxableBasis({ regime: 'decreto_1372_1992' } as any),
    ).toBe('utilidad');
  });
});
