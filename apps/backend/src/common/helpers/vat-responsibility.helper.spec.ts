import { Test, TestingModule } from '@nestjs/testing';
import { VendixHttpException } from '../errors/vendix-http.exception';
import { ErrorCodes } from '../errors/error-codes';
import {
  isVatResponsible,
  isExplicitlyNotVatResponsible,
  assertCanChargeVat,
  VatResponsibilityService,
  VAT_RESPONSIBLE_CODE,
  VAT_NOT_RESPONSIBLE_CODE,
} from './vat-responsibility.helper';

/**
 * P0.1 — consolidación del helper `isVatResponsible`.
 *
 * Estos specs fijan:
 *  - las seis ramas del predicado puro (responsabilidad explícita +
 *    fallback por régimen + indeterminado),
 *  - la rama anti-regresión pre-F4 (`true` cuando no hay datos fiscales),
 *  - el enforcement `assertCanChargeVat` (no-op cuando responsable o
 *    indeterminado, lanza `FISCAL_VAT_NOT_RESPONSIBLE_001` cuando NO
 *    responsable explícito),
 *  - el contrato del servicio DI (`VatResponsibilityService.resolve`)
 *    como delegación 1:1 al helper puro.
 *
 * Cambiar el default pre-F4 (`return true` en la rama indeterminada) es
 * Paso 0.1, fuera de P0.1. Estos tests lo fijan a propósito.
 */
describe('isVatResponsible', () => {
  describe('responsabilidad explícita (RUT casilla 53)', () => {
    it('devuelve true cuando tax_responsibilities incluye O-48', () => {
      expect(
        isVatResponsible({ tax_responsibilities: [VAT_RESPONSIBLE_CODE] }),
      ).toBe(true);
    });

    it('devuelve false cuando tax_responsibilities incluye O-49 sin O-48', () => {
      expect(
        isVatResponsible({ tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] }),
      ).toBe(false);
    });

    it('O-48 gana cuando coexiste con O-49 en el mismo array', () => {
      // O-48 + O-49: el comercio es responsable de IVA (O-49 sólo aplica
      // si no hay O-48 presente).
      expect(
        isVatResponsible({
          tax_responsibilities: [VAT_RESPONSIBLE_CODE, VAT_NOT_RESPONSIBLE_CODE],
        }),
      ).toBe(true);
    });

    it('ignora entradas no-string dentro del array (defensiva)', () => {
      // El contrato tipa VatFiscalDataInput como unknown; el helper filtra
      // a string para no caer en `responsibilities.includes(123) === true`
      // accidentalmente.
      expect(
        isVatResponsible({
          tax_responsibilities: [123, null, VAT_RESPONSIBLE_CODE, undefined] as unknown as string[],
        }),
      ).toBe(true);
    });
  });

  describe('fallback por tax_regime', () => {
    it('COMUN con responsabilidades vacías ⇒ true (responsable)', () => {
      expect(
        isVatResponsible({ tax_responsibilities: [], tax_regime: 'COMUN' }),
      ).toBe(true);
    });

    it('GRAN_CONTRIBUYENTE con responsabilidades vacías ⇒ true (responsable)', () => {
      expect(
        isVatResponsible({
          tax_responsibilities: [],
          tax_regime: 'GRAN_CONTRIBUYENTE',
        }),
      ).toBe(true);
    });

    it('SIMPLIFICADO con responsabilidades vacías ⇒ false (NO responsable)', () => {
      expect(
        isVatResponsible({
          tax_responsibilities: [],
          tax_regime: 'SIMPLIFICADO',
        }),
      ).toBe(false);
    });

    it('tax_regime desconocido con responsabilidades vacías ⇒ cae al default pre-F4 (true)', () => {
      // Único caso donde el helper devuelve `true` para un régimen no
      // listado pero con responsabilidades vacías: la rama "indeterminado".
      // El cambio de default es Paso 0.1 — fuera de P0.1.
      expect(
        isVatResponsible({ tax_responsibilities: [], tax_regime: 'OTRO' }),
      ).toBe(true);
    });

    it('responsabilidades explícitas ganan al régimen', () => {
      // O-48 declarado ⇒ siempre responsable, ignorando SIMPLIFICADO.
      expect(
        isVatResponsible({
          tax_responsibilities: [VAT_RESPONSIBLE_CODE],
          tax_regime: 'SIMPLIFICADO',
        }),
      ).toBe(true);
      // O-49 sin O-48 ⇒ siempre NO responsable, ignorando COMUN.
      expect(
        isVatResponsible({
          tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE],
          tax_regime: 'COMUN',
        }),
      ).toBe(false);
    });
  });

  describe('rama indeterminada (anti-regresión pre-F4)', () => {
    it('responsabilidades vacías + sin tax_regime ⇒ true (default pre-F4)', () => {
      expect(isVatResponsible({})).toBe(true);
    });

    it('responsabilidades vacías + tax_regime no-string ⇒ true', () => {
      expect(
        isVatResponsible({ tax_responsibilities: [], tax_regime: 42 }),
      ).toBe(true);
    });

    it('fiscalData null ⇒ true (no lanza, default pre-F4)', () => {
      expect(isVatResponsible(null)).toBe(true);
    });

    it('fiscalData undefined ⇒ true (no lanza, default pre-F4)', () => {
      expect(isVatResponsible(undefined)).toBe(true);
    });

    it('tax_responsibilities que no es array ⇒ true (indeterminado)', () => {
      // Malformed data no debe tirar al servicio a un false por accidente.
      expect(
        isVatResponsible({ tax_responsibilities: 'O-48' as unknown as string[] }),
      ).toBe(true);
    });
  });
});

describe('isExplicitlyNotVatResponsible', () => {
  it('es la negación de isVatResponsible — responsable ⇒ false', () => {
    expect(
      isExplicitlyNotVatResponsible({ tax_responsibilities: [VAT_RESPONSIBLE_CODE] }),
    ).toBe(false);
  });

  it('NO responsable explícito ⇒ true', () => {
    expect(
      isExplicitlyNotVatResponsible({
        tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE],
      }),
    ).toBe(true);
  });

  it('indeterminado NO bloquea (devuelve false)', () => {
    // Consistente con la rama anti-regresión: el helper no castiga a un
    // comercio sin datos fiscales.
    expect(isExplicitlyNotVatResponsible({})).toBe(false);
    expect(isExplicitlyNotVatResponsible(null)).toBe(false);
    expect(isExplicitlyNotVatResponsible(undefined)).toBe(false);
  });
});

describe('assertCanChargeVat', () => {
  it('no lanza cuando el comercio es responsable (O-48)', () => {
    expect(() =>
      assertCanChargeVat(
        { tax_responsibilities: [VAT_RESPONSIBLE_CODE] },
        'product',
      ),
    ).not.toThrow();
  });

  it('no lanza cuando el estado es indeterminado (no bloquea)', () => {
    expect(() => assertCanChargeVat({}, 'product')).not.toThrow();
    expect(() => assertCanChargeVat(null, 'sale')).not.toThrow();
    expect(() => assertCanChargeVat(undefined, 'sale')).not.toThrow();
  });

  it('lanza VendixHttpException con FISCAL_VAT_NOT_RESPONSIBLE_001 cuando NO responsable', () => {
    let caught: unknown;
    try {
      assertCanChargeVat(
        {
          tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE],
        },
        'product',
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.FISCAL_VAT_NOT_RESPONSIBLE_001.code,
    );
  });

  it('el context del error viaja en details.context y el CTA apunta al wizard fiscal', () => {
    let caught: unknown;
    try {
      assertCanChargeVat(
        {
          tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE],
        },
        'sale',
      );
    } catch (err) {
      caught = err;
    }
    const response = (caught as VendixHttpException).getResponse() as {
      details?: Record<string, unknown>;
    };
    expect(response.details?.context).toBe('sale');
    expect(response.details?.cta).toBe('/admin/fiscal/wizard');
  });

  it('también bloquea cuando el régimen es SIMPLIFICADO con responsabilidades vacías', () => {
    expect(() =>
      assertCanChargeVat(
        { tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' },
        'product',
      ),
    ).toThrow(VendixHttpException);
  });
});

describe('VatResponsibilityService (DI)', () => {
  /**
   * El servicio DI es una delegación 1:1 al helper puro. Estos tests
   * existen para fijar:
   *  - que es inyectable (compila y se puede tomar del TestingModule);
   *  - que NO introduce divergencia con la lógica pura
   *    (cada rama del helper pasa el service.resolve con el mismo
   *    resultado);
   *  - que NO se vuelve async (devuelve boolean sin Promise), para
   *    preservar la firma del servicio original en PO y Scanner.
   */
  let service: VatResponsibilityService;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [VatResponsibilityService],
    }).compile();
    service = mod.get(VatResponsibilityService);
  });

  it('es inyectable', () => {
    expect(service).toBeDefined();
    expect(typeof service.resolve).toBe('function');
  });

  it('resolve es síncrono (devuelve boolean, no Promise)', () => {
    const result = service.resolve({ tax_responsibilities: [VAT_RESPONSIBLE_CODE] });
    expect(result).toBe(true);
    // Si fuera Promise, este check sería `expect(Promise.resolve(result)).toBe(result)`.
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('delega correctamente cada rama del helper', () => {
    // Recorre las mismas ramas que el spec de isVatResponsible y verifica
    // que pasan idénticas por el servicio.
    const cases: Array<{
      fiscalData: Parameters<VatResponsibilityService['resolve']>[0];
      expected: boolean;
    }> = [
      { fiscalData: { tax_responsibilities: [VAT_RESPONSIBLE_CODE] }, expected: true },
      { fiscalData: { tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] }, expected: false },
      {
        fiscalData: {
          tax_responsibilities: [VAT_RESPONSIBLE_CODE, VAT_NOT_RESPONSIBLE_CODE],
        },
        expected: true,
      },
      { fiscalData: { tax_responsibilities: [], tax_regime: 'COMUN' }, expected: true },
      {
        fiscalData: { tax_responsibilities: [], tax_regime: 'GRAN_CONTRIBUYENTE' },
        expected: true,
      },
      { fiscalData: { tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' }, expected: false },
      { fiscalData: {}, expected: true },
      { fiscalData: null, expected: true },
      { fiscalData: undefined, expected: true },
    ];

    for (const { fiscalData, expected } of cases) {
      expect(service.resolve(fiscalData)).toBe(expected);
    }
  });
});
