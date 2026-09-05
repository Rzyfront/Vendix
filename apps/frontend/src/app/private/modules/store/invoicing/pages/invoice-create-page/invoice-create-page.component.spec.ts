import { AIU_TAXABLE_BUCKETS_BY_BASIS } from '../../../../../../core/utils/invoice-profile-config.contract';
import { computeLineMath } from '../../utils/invoice-line-math';
import type {
  TaxOption,
  TaxSelection,
} from '../../../../../../shared/components/tax-selector';
import {
  deriveAiuTotals,
  isAiuOperation,
  resolveAiuBucketTaxes,
  resolveSubmitHint,
  type SubmitHintState,
} from './invoice-create-page.component';

/**
 * Paso 1 del plan AIU — `deriveAiuTotals`, probado donde es PURO.
 *
 * La propiedad custodiada: la lectura reagrupa la MISMA `lineMath` por
 * cubeta con la tabla ÚNICA `AIU_TAXABLE_BUCKETS_BY_BASIS`, sin recalcular
 * nada. El caso real (contrato $2.587.556 bajo base utilidad, IVA 19 % sólo
 * en la utilidad) fija `taxableBase`, `contractAmount` y `taxAmount`; las
 * otras dos bases fijan qué cubetas entran.
 *
 * Lo que este spec NO cubre, a propósito: la puerta `isAiu()` del computed
 * `aiuTotals` (fuera de operación 09 devuelve `null` y la barra queda
 * idéntica) y el `submitHint()` viven en el componente de página, cuya
 * instanciación exige el harness completo del store (Store, Router, una
 * decena de servicios) que no existe como spec hermano. Probarlos con mocks
 * afirmaría contra los mocks, no contra el comportamiento.
 */
describe('invoice-create-page · deriveAiuTotals (paso 1 AIU)', () => {
  const iva19 = (overrides: Partial<TaxSelection> = {}): TaxSelection => ({
    tax_rate_id: 1,
    rate: 19,
    name: 'IVA 19 %',
    tax_type: 'iva',
    is_inclusive: false,
    ...overrides,
  });

  const line = (
    unitPrice: number,
    aiuComponent: string | null,
    taxes: TaxSelection[] = [],
  ) => ({
    item: { aiu_component: aiuComponent },
    input: {
      quantity: 1,
      unit_price: unitPrice,
      discount_amount: 0,
      taxes,
    },
  });

  /** Caso real del plan: costo + A + I + U bajo base utilidad. */
  const casoReal = () => {
    const rows = [
      line(2328800, null),
      line(129378, 'administracion'),
      line(51751, 'imprevistos'),
      line(77627, 'utilidad', [iva19()]),
    ];
    return {
      items: rows.map((row) => row.item),
      math: rows.map((row) => computeLineMath(row.input)),
    };
  };

  it('caso real bajo base utilidad: taxableBase 77627, contrato 2587556, impuesto 14749.13', () => {
    const { items, math } = casoReal();
    const out = deriveAiuTotals(
      items,
      math,
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
    );
    expect(out.taxableBase).toBe(77627);
    expect(out.contractAmount).toBe(2587556);
    expect(out.aiuAmount).toBe(129378 + 51751 + 77627);
    expect(out.taxAmount).toBeCloseTo(14749.13, 2);
  });

  it("bajo base 'aiu' gravan A+I+U pero el costo queda fuera", () => {
    const { items, math } = casoReal();
    const out = deriveAiuTotals(items, math, AIU_TAXABLE_BUCKETS_BY_BASIS['aiu']);
    expect(out.taxableBase).toBe(129378 + 51751 + 77627);
    expect(out.contractAmount).toBe(2587556);
    expect(out.taxAmount).toBeCloseTo(14749.13, 2);
  });

  it("bajo base 'subtotal' grava el contrato entero, costo incluido", () => {
    const { items, math } = casoReal();
    const out = deriveAiuTotals(
      items,
      math,
      AIU_TAXABLE_BUCKETS_BY_BASIS['subtotal'],
    );
    expect(out.taxableBase).toBe(2587556);
    expect(out.taxableBase).toBe(out.contractAmount);
  });

  it('sin líneas devuelve ceros, no NaN ni null', () => {
    expect(deriveAiuTotals([], [], AIU_TAXABLE_BUCKETS_BY_BASIS['aiu'])).toEqual({
      contractAmount: 0,
      aiuAmount: 0,
      taxableBase: 0,
      taxAmount: 0,
    });
  });

  it('un componente desconocido suma al contrato y al AIU pero no a la base: declara de más, nunca de menos', () => {
    const rows = [line(100000, 'contrato', [iva19()])];
    const out = deriveAiuTotals(
      rows.map((row) => row.item),
      rows.map((row) => computeLineMath(row.input)),
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
    );
    expect(out.contractAmount).toBe(100000);
    expect(out.aiuAmount).toBe(100000);
    expect(out.taxableBase).toBe(0);
    expect(out.taxAmount).toBe(0);
  });

  it('el descuento reduce el contrato igual que en totals(): la lectura es la misma cifra, reagrupada', () => {
    const rows = [
      {
        item: { aiu_component: null },
        input: { quantity: 1, unit_price: 100000, discount_amount: 20000, taxes: [] as TaxSelection[] },
      },
    ];
    const out = deriveAiuTotals(
      rows.map((row) => row.item),
      rows.map((row) => computeLineMath(row.input)),
      AIU_TAXABLE_BUCKETS_BY_BASIS['subtotal'],
    );
    expect(out.contractAmount).toBe(80000);
  });
});

/**
 * Puerta de la operación AIU (paso 1, caso `operation_type='10'`).
 *
 * La barra sólo existe en `09`: con cualquier otro tipo `aiuTotals()` es
 * `null` y el template pinta la rama histórica byte a byte. Esta puerta es
 * esa condición, probada donde es pura.
 */
describe('invoice-create-page · isAiuOperation (paso 1, puerta 09/10)', () => {
  it("la operación '09' es AIU", () => {
    expect(isAiuOperation('09')).toBe(true);
  });

  it("la operación '10' NO es AIU: la barra queda idéntica a la histórica", () => {
    expect(isAiuOperation('10')).toBe(false);
  });

  it('cualquier otro valor (vacío, nulo, otra operación) NO es AIU', () => {
    expect(isAiuOperation('')).toBe(false);
    expect(isAiuOperation(null)).toBe(false);
    expect(isAiuOperation(undefined)).toBe(false);
    expect(isAiuOperation('01')).toBe(false);
  });
});

/**
 * Frase de estado de la cabecera (paso 3), probada donde es pura.
 *
 * La propiedad custodiada: con operación `09`, líneas de costo y ninguna
 * línea con componente, la frase NO es «Todo listo para emitir.»; tras
 * aplicar (o fuera de AIU) vuelve al estado listo.
 */
describe('invoice-create-page · resolveSubmitHint (paso 3)', () => {
  const listo: SubmitHintState = {
    checkingEmitReadiness: false,
    createdInvoiceId: null,
    mode: 'manual',
    orderIdValue: null,
    itemCount: 2,
    hasActiveResolution: true,
    isCredit: false,
    hasDueDate: false,
    incompleteWithholdingRow: 0,
    formStatus: 'VALID',
    isAiu: false,
    aiuWithoutComponent: false,
  };

  it('documento válido no AIU: «Todo listo para emitir.»', () => {
    expect(resolveSubmitHint(listo)).toBe('Todo listo para emitir.');
  });

  it("documento válido en operación '10': también listo (no es AIU)", () => {
    expect(resolveSubmitHint({ ...listo })).toBe('Todo listo para emitir.');
  });

  it('09 con costo y sin componente: NO dice «Todo listo para emitir.»', () => {
    expect(
      resolveSubmitHint({ ...listo, isAiu: true, aiuWithoutComponent: true }),
    ).toBe('Falta aplicar la base AIU a las líneas.');
  });

  it('09 con el AIU ya aplicado: vuelve al estado listo', () => {
    expect(
      resolveSubmitHint({ ...listo, isAiu: true, aiuWithoutComponent: false }),
    ).toBe('Todo listo para emitir.');
  });

  it('las ramas previas mandan antes que la AIU: sin líneas y con retención incompleta', () => {
    expect(resolveSubmitHint({ ...listo, itemCount: 0 })).toBe(
      'Agrega al menos una línea.',
    );
    expect(
      resolveSubmitHint({ ...listo, incompleteWithholdingRow: 2 }),
    ).toBe(
      'La retención #2 está incompleta: elige concepto, tarifa y base.',
    );
  });
});

/**
 * Paso 8 — `resolveAiuBucketTaxes`, probado donde es PURO.
 *
 * La propiedad custodiada: la regla gravable que el catálogo no resuelve
 * viaja con nombre (tributo + tarifa) en vez de perderse en un `continue`.
 * El camino feliz —tarifa exacta en el catálogo— devuelve la selección de
 * siempre y ningún bloqueo.
 */
describe('invoice-create-page · resolveAiuBucketTaxes (paso 8)', () => {
  const iva19: TaxOption = {
    id: 7,
    name: 'IVA 19 %',
    rate: 19,
    tax_type: 'iva',
    default_is_inclusive: false,
  };
  const reglaUtilidad1900 = {
    bucket: 'utilidad',
    taxable: true,
    tax_code: '01',
    rate: '19.00',
  };

  it('tarifa exacta en el catálogo: selección de siempre, sin bloqueos', () => {
    const out = resolveAiuBucketTaxes(
      [reglaUtilidad1900],
      'utilidad',
      'Utilidad',
      [iva19],
    );
    expect(out.unresolved).toEqual([]);
    expect(out.selections).toEqual([
      {
        tax_rate_id: 7,
        rate: 19,
        name: 'IVA 19 %',
        tax_type: 'iva',
        is_inclusive: false,
      },
    ]);
  });

  it('catálogo sin la tarifa exacta: nombra tributo y tarifa', () => {
    const out = resolveAiuBucketTaxes(
      [reglaUtilidad1900],
      'utilidad',
      'Utilidad',
      [{ ...iva19, rate: 5 }],
    );
    expect(out.selections).toEqual([]);
    expect(out.unresolved.length).toBe(1);
    expect(out.unresolved[0].reason).toBe('missing-rate');
    expect(out.unresolved[0].message).toContain('IVA');
    expect(out.unresolved[0].message).toContain('19.00 %');
    expect(out.unresolved[0].message).toContain('Utilidad');
  });

  it('catálogo vacío: lo dice con su propio texto y no rompe', () => {
    const out = resolveAiuBucketTaxes(
      [reglaUtilidad1900],
      'utilidad',
      'Utilidad',
      [],
    );
    expect(out.selections).toEqual([]);
    expect(out.unresolved.length).toBe(1);
    expect(out.unresolved[0].reason).toBe('empty-catalog');
    expect(out.unresolved[0].message).toContain('vacío');
  });

  it('código de tributo desconocido y tarifa ilegible: cada uno con su texto', () => {
    const rara = resolveAiuBucketTaxes(
      [{ bucket: 'utilidad', taxable: true, tax_code: 'ZZ', rate: '19.00' }],
      'utilidad',
      'Utilidad',
      [iva19],
    );
    expect(rara.unresolved[0].reason).toBe('unknown-tax-code');
    expect(rara.unresolved[0].message).toContain('«ZZ»');

    const rota = resolveAiuBucketTaxes(
      [{ bucket: 'utilidad', taxable: true, tax_code: '01', rate: 'diecinueve' }],
      'utilidad',
      'Utilidad',
      [iva19],
    );
    expect(rota.unresolved[0].reason).toBe('unparsable-rate');
  });

  it('la regla no gravable o de otra cubeta sigue muda: es filtro, no fallo', () => {
    const out = resolveAiuBucketTaxes(
      [
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '19.00' },
        { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00' },
      ],
      'utilidad',
      'Utilidad',
      [],
    );
    expect(out).toEqual({ selections: [], unresolved: [] });
  });
});
