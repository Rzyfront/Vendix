import { Test, TestingModule } from '@nestjs/testing';
import { VendixHttpException } from '../errors/vendix-http.exception';
import { ErrorCodes } from '../errors/error-codes';
import {
  isVatResponsible,
  isExplicitlyNotVatResponsible,
  assertCanChargeVat,
  resolveVatResponsibility,
  vatResponsibilityReadFailure,
  VatResponsibilityService,
  VAT_RESPONSIBLE_CODE,
  VAT_NOT_RESPONSIBLE_CODE,
  resolveVatTreatment,
  vatTreatmentFromResult,
  FISCAL_WIZARD_ROUTE,
} from './vat-responsibility.helper';
import { purchaseEffectFor } from '../../domains/fiscal-operations/constants/fiscal-responsibilities.catalog';

/**
 * P0.1 — consolidación del helper `isVatResponsible`.
 *
 * Estos specs fijan:
 *  - las seis ramas del predicado puro (responsabilidad explícita +
 *    fallback por régimen + indeterminado),
 *  - la rama fail-closed (`false` cuando no hay datos fiscales —
 *    cambio de default del 2026-08-21),
 *  - el enforcement `assertCanChargeVat` (no-op sólo cuando hay
 *    declaración POSITIVA de responsabilidad; lanza
 *    `FISCAL_VAT_NOT_RESPONSIBLE_001` en cualquier otro caso,
 *    incluido el indeterminado),
 *  - el contrato del servicio DI (`VatResponsibilityService.resolve`)
 *    como delegación 1:1 al helper puro.
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

    it('tax_regime desconocido con responsabilidades vacías ⇒ cae al default fail-closed (false)', () => {
      // Único caso donde el helper devuelve `false` para un régimen no
      // listado pero con responsabilidades vacías: la rama "indeterminado".
      // Default fail-closed desde 2026-08-21.
      expect(
        isVatResponsible({ tax_responsibilities: [], tax_regime: 'OTRO' }),
      ).toBe(false);
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

  describe('rama indeterminada (fail-closed)', () => {
    it('responsabilidades vacías + sin tax_regime ⇒ false (default fail-closed)', () => {
      expect(isVatResponsible({})).toBe(false);
    });

    it('responsabilidades vacías + tax_regime no-string ⇒ false', () => {
      expect(
        isVatResponsible({ tax_responsibilities: [], tax_regime: 42 }),
      ).toBe(false);
    });

    it('fiscalData null ⇒ false (no lanza, default fail-closed)', () => {
      expect(isVatResponsible(null)).toBe(false);
    });

    it('fiscalData undefined ⇒ false (no lanza, default fail-closed)', () => {
      expect(isVatResponsible(undefined)).toBe(false);
    });

    it('tax_responsibilities que no es array ⇒ false (indeterminado)', () => {
      // Malformed data cae a indeterminado ⇒ fail-closed (no responsable).
      expect(
        isVatResponsible({ tax_responsibilities: 'O-48' as unknown as string[] }),
      ).toBe(false);
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

  it('indeterminado BLOQUEA (devuelve true — fail-closed)', () => {
    // Desde 2026-08-21 el default es fail-closed: sin declaración de
    // responsabilidad, el helper castiga al comercio considerándolo NO
    // responsable y, por tanto, bloquea la operación.
    expect(isExplicitlyNotVatResponsible({})).toBe(true);
    expect(isExplicitlyNotVatResponsible(null)).toBe(true);
    expect(isExplicitlyNotVatResponsible(undefined)).toBe(true);
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

  it('LANZA cuando el estado es indeterminado (fail-closed)', () => {
    // Desde 2026-08-21 el default es fail-closed: sin declaración de
    // responsabilidad POSITIVA, assertCanChargeVat lanza
    // FISCAL_VAT_NOT_RESPONSIBLE_001 para empujar al tenant al wizard.
    let caught: unknown;
    try {
      assertCanChargeVat(null, 'sale');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VendixHttpException);
    expect((caught as VendixHttpException).errorCode).toBe(
      ErrorCodes.FISCAL_VAT_NOT_RESPONSIBLE_001.code,
    );
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
      { fiscalData: {}, expected: false },
      { fiscalData: null, expected: false },
      { fiscalData: undefined, expected: false },
    ];

    for (const { fiscalData, expected } of cases) {
      expect(service.resolve(fiscalData)).toBe(expected);
    }
  });
});

/**
 * CP-PURCHASE-TRANSPARENCY B.0 — el resultado de TRES estados.
 *
 * `boolean` no distingue «declaró que NO es responsable» de «no sabemos si lo
 * es», y el flujo de compras necesita esa diferencia para explicarle al
 * usuario por qué el IVA se capitaliza. Estos specs fijan:
 *  - que `indeterminate` sólo es `true` cuando NO hubo señal fiscal;
 *  - que un fallo de LECTURA (`read_error`) es indeterminado pero distinto de
 *    la ausencia de datos (`absent`), porque una se reintenta y la otra se
 *    resuelve en el wizard fiscal;
 *  - que `isVatResponsible` es exactamente la proyección de `responsible`, de
 *    modo que las dos respuestas no puedan divergir.
 */
describe('resolveVatResponsibility (tres estados)', () => {
  it('O-48 declarado ⇒ responsable, concluyente, fuente tax_responsibilities', () => {
    const result = resolveVatResponsibility({
      tax_responsibilities: [VAT_RESPONSIBLE_CODE],
    });
    expect(result.responsible).toBe(true);
    expect(result.indeterminate).toBe(false);
    expect(result.reason).toBe('declared_responsible');
    expect(result.source).toBe('tax_responsibilities');
  });

  it('O-49 sin O-48 ⇒ NO responsable pero CONCLUYENTE (no es indeterminado)', () => {
    const result = resolveVatResponsibility({
      tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE],
    });
    expect(result.responsible).toBe(false);
    expect(result.indeterminate).toBe(false);
    expect(result.reason).toBe('declared_not_responsible');
  });

  it('fallback por régimen COMUN ⇒ responsable, fuente tax_regime', () => {
    const result = resolveVatResponsibility({
      tax_responsibilities: [],
      tax_regime: 'COMUN',
    });
    expect(result.responsible).toBe(true);
    expect(result.indeterminate).toBe(false);
    expect(result.source).toBe('tax_regime');
    expect(result.reason).toBe('regime_responsible');
  });

  it('fallback por régimen SIMPLIFICADO ⇒ NO responsable y concluyente', () => {
    const result = resolveVatResponsibility({
      tax_responsibilities: [],
      tax_regime: 'SIMPLIFICADO',
    });
    expect(result.responsible).toBe(false);
    expect(result.indeterminate).toBe(false);
    expect(result.reason).toBe('regime_not_responsible');
  });

  it.each([
    ['objeto vacío', {}],
    ['null', null],
    ['undefined', undefined],
    ['régimen desconocido', { tax_responsibilities: [], tax_regime: 'OTRO' }],
  ])('sin señal fiscal (%s) ⇒ indeterminado y fail-closed', (_label, input) => {
    const result = resolveVatResponsibility(input as any);
    expect(result.responsible).toBe(false);
    expect(result.indeterminate).toBe(true);
    expect(result.reason).toBe('no_fiscal_signal');
    expect(result.source).toBe('absent');
  });

  it('siempre trae un message no vacío para explicarle la decisión al usuario', () => {
    const inputs = [
      { tax_responsibilities: [VAT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [], tax_regime: 'COMUN' },
      { tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' },
      {},
    ];
    for (const input of inputs) {
      expect(resolveVatResponsibility(input).message.length).toBeGreaterThan(0);
    }
  });

  it('isVatResponsible es exactamente la proyección de `responsible`', () => {
    // Blinda contra «mismo predicado, dos implementaciones»: si alguien
    // reescribe una de las dos funciones, esta tabla lo delata.
    const inputs = [
      { tax_responsibilities: [VAT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [VAT_RESPONSIBLE_CODE, VAT_NOT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [], tax_regime: 'COMUN' },
      { tax_responsibilities: [], tax_regime: 'GRAN_CONTRIBUYENTE' },
      { tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' },
      { tax_responsibilities: [], tax_regime: 'OTRO' },
      {},
      null,
      undefined,
    ];
    for (const input of inputs) {
      expect(isVatResponsible(input as any)).toBe(
        resolveVatResponsibility(input as any).responsible,
      );
    }
  });
});

describe('vatResponsibilityReadFailure', () => {
  it('es indeterminado y fail-closed: nunca declara responsabilidad', () => {
    const result = vatResponsibilityReadFailure();
    expect(result.responsible).toBe(false);
    expect(result.indeterminate).toBe(true);
  });

  it('se distingue de la ausencia de datos por su `source`', () => {
    // La distinción no es cosmética: `absent` manda al wizard fiscal,
    // `read_error` invita a reintentar.
    expect(vatResponsibilityReadFailure().source).toBe('read_error');
    expect(resolveVatResponsibility({}).source).toBe('absent');
    expect(vatResponsibilityReadFailure().reason).toBe('fiscal_read_failed');
  });
});

describe('VatResponsibilityService — variante de tres estados', () => {
  let service: VatResponsibilityService;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [VatResponsibilityService],
    }).compile();
    service = mod.get(VatResponsibilityService);
  });

  it('resolveDetailed delega 1:1 en el helper puro', () => {
    const inputs = [
      { tax_responsibilities: [VAT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' },
      {},
      null,
      undefined,
    ];
    for (const input of inputs) {
      expect(service.resolveDetailed(input as any)).toEqual(
        resolveVatResponsibility(input as any),
      );
    }
  });

  it('resolve sigue siendo la proyección booleana de resolveDetailed', () => {
    const inputs = [
      { tax_responsibilities: [VAT_RESPONSIBLE_CODE] },
      { tax_responsibilities: [], tax_regime: 'COMUN' },
      {},
      null,
    ];
    for (const input of inputs) {
      expect(service.resolve(input as any)).toBe(
        service.resolveDetailed(input as any).responsible,
      );
    }
  });

  it('readFailure expone el resultado canónico de fallo de lectura', () => {
    expect(service.readFailure()).toEqual(vatResponsibilityReadFailure());
  });
});

/**
 * CP-PURCHASE-TRANSPARENCY B.3 — el texto que ve el operador tiene que
 * describir EL MISMO tratamiento que aplica el motor de costeo. Si el catálogo
 * dijera «se descuenta» mientras el motor capitaliza, la interfaz estaría
 * explicando al revés lo que el sistema hace: peor que no explicar nada.
 */
describe('resolveVatTreatment — las cinco combinaciones de motivo (B.3)', () => {
  const cases: Array<{
    name: string;
    input: any;
    reason: string;
    source: string;
    treatment: 'deductible' | 'capitalized';
    indeterminate: boolean;
  }> = [
    {
      name: 'O-48 declarado',
      input: { tax_responsibilities: [VAT_RESPONSIBLE_CODE] },
      reason: 'declared_responsible',
      source: 'tax_responsibilities',
      treatment: 'deductible',
      indeterminate: false,
    },
    {
      name: 'O-49 declarado',
      input: { tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] },
      reason: 'declared_not_responsible',
      source: 'tax_responsibilities',
      treatment: 'capitalized',
      indeterminate: false,
    },
    {
      name: 'inferencia por régimen COMUN',
      input: { tax_regime: 'COMUN' },
      reason: 'regime_responsible',
      source: 'tax_regime',
      treatment: 'deductible',
      indeterminate: false,
    },
    {
      name: 'inferencia por régimen SIMPLIFICADO',
      input: { tax_regime: 'SIMPLIFICADO' },
      reason: 'regime_not_responsible',
      source: 'tax_regime',
      treatment: 'capitalized',
      indeterminate: false,
    },
    {
      name: 'sin ninguna señal fiscal',
      input: {},
      reason: 'no_fiscal_signal',
      source: 'absent',
      treatment: 'capitalized',
      indeterminate: true,
    },
  ];

  it.each(cases)(
    '$name → reason=$reason source=$source treatment=$treatment',
    ({ input, reason, source, treatment, indeterminate }) => {
      const out = resolveVatTreatment(input);
      expect(out.reason).toBe(reason);
      expect(out.source).toBe(source);
      expect(out.treatment).toBe(treatment);
      expect(out.indeterminate).toBe(indeterminate);
      expect(out.message.length).toBeGreaterThan(0);
      expect(out.legal_basis.length).toBeGreaterThan(0);
    },
  );

  it('el tratamiento NUNCA contradice el booleano que aplica el motor de costeo', () => {
    for (const { input } of cases) {
      const out = resolveVatTreatment(input);
      expect(out.vat_responsible).toBe(isVatResponsible(input));
      expect(out.treatment).toBe(
        out.vat_responsible ? 'deductible' : 'capitalized',
      );
    }
  });

  it('el fallo de lectura es indeterminado, capitaliza y NO se confunde con la ausencia de datos', () => {
    const out = vatTreatmentFromResult(vatResponsibilityReadFailure());
    expect(out.reason).toBe('fiscal_read_failed');
    expect(out.source).toBe('read_error');
    expect(out.indeterminate).toBe(true);
    expect(out.treatment).toBe('capitalized');
    expect(out.message).not.toBe(resolveVatTreatment({}).message);
  });

  it('solo los estados indeterminados traen llamada a la acción, y apunta al asistente fiscal', () => {
    expect(resolveVatTreatment({}).cta).toEqual({
      label: expect.any(String),
      route: FISCAL_WIZARD_ROUTE,
    });
    expect(
      vatTreatmentFromResult(vatResponsibilityReadFailure()).cta?.route,
    ).toBe(FISCAL_WIZARD_ROUTE);
    expect(
      resolveVatTreatment({ tax_responsibilities: [VAT_RESPONSIBLE_CODE] }).cta,
    ).toBeUndefined();
    expect(
      resolveVatTreatment({ tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] })
        .cta,
    ).toBeUndefined();
    expect(resolveVatTreatment({ tax_regime: 'COMUN' }).cta).toBeUndefined();
  });

  it('el texto y la base legal de O-48 / O-49 salen del CATÁLOGO oficial, no de una cadena local', () => {
    expect(
      resolveVatTreatment({ tax_responsibilities: [VAT_RESPONSIBLE_CODE] }),
    ).toEqual(
      expect.objectContaining({
        message: purchaseEffectFor(VAT_RESPONSIBLE_CODE)!.message,
        legal_basis: purchaseEffectFor(VAT_RESPONSIBLE_CODE)!.legal_basis,
      }),
    );
    expect(
      resolveVatTreatment({ tax_responsibilities: [VAT_NOT_RESPONSIBLE_CODE] }),
    ).toEqual(
      expect.objectContaining({
        message: purchaseEffectFor(VAT_NOT_RESPONSIBLE_CODE)!.message,
        legal_basis: purchaseEffectFor(VAT_NOT_RESPONSIBLE_CODE)!.legal_basis,
      }),
    );
  });

  it('la cascada por régimen se declara como INFERENCIA, no como declaración del contribuyente', () => {
    expect(resolveVatTreatment({ tax_regime: 'COMUN' }).message).toMatch(
      /no lo declaraste/i,
    );
    expect(resolveVatTreatment({ tax_regime: 'SIMPLIFICADO' }).message).toMatch(
      /inferencia/i,
    );
  });

  it('no cita artículos que no sostienen la afirmación (491 ET es de activos fijos; el 2650/1993 no funda el IVA)', () => {
    const all = [
      ...cases.map((c) => resolveVatTreatment(c.input)),
      vatTreatmentFromResult(vatResponsibilityReadFailure()),
    ].flatMap((o) => o.legal_basis);
    for (const cite of all) {
      expect(cite).not.toMatch(/\b491\b/);
      expect(cite).not.toMatch(/\b86\b/);
      expect(cite).not.toMatch(/2650/);
    }
  });
});
