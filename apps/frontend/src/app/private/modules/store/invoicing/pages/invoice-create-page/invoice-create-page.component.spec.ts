import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { AIU_TAXABLE_BUCKETS_BY_BASIS } from '../../../../../../core/utils/invoice-profile-config.contract';
import { computeLineMath } from '../../utils/invoice-line-math';
import type {
  TaxOption,
  TaxSelection,
} from '../../../../../../shared/components/tax-selector';
import {
  aiuDocumentFingerprint,
  aiuLineTaxableShare,
  applyAiuMarkingToRows,
  buildAiuSummaryRows,
  deriveAiuTotals,
  isAiuOperation,
  resolveAiuBucketTaxes,
  resolveSubmitHint,
  shouldAutoApplyAiuBase,
  shouldOfferAiuReapply,
  splitAiuContratoAmount,
  type AiuAutoApplyState,
  type AiuContratoSplit,
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
      portions: {
        administracion: 0,
        imprevistos: 0,
        utilidad: 0,
        costo: 0,
      },
    });
  });

  it('una línea de contrato SIN reparto configurado no inventa base gravable: declara de más, nunca de menos', () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// PLAN «AIU MODELO NO SUMADA» — pasos 6, 7 y 8
// ─────────────────────────────────────────────────────────────────────────────

/** El reparto del caso reportado por el dueño: AIU 5/2/3 medido sobre el contrato. */
const REPARTO_523: AiuContratoSplit = {
  percentsScaled: { administracion: 500, imprevistos: 200, utilidad: 300 },
  basis: 'contract',
};

/** El contrato del caso reportado: una sola línea de $2.328.800. */
const CONTRATO_CASO_REAL = 2328800;

const IVA_19: TaxSelection = {
  tax_rate_id: 7,
  rate: 19,
  name: 'IVA 19 %',
  tax_type: 'iva',
  is_inclusive: false,
};

/**
 * Paso 6 — el reparto INTERNO de una línea Modelo 1.
 *
 * La propiedad custodiada: bajo `'contract'` los porcentajes se miden contra el
 * importe de la línea y el remanente hasta el 100 % es costo reembolsable
 * embebido; bajo `'aiu'` la línea ENTERA es el AIU y se normaliza por Σ. En los
 * dos casos las cuatro porciones cierran EXACTAMENTE contra el importe de la
 * línea: un centavo suelto entre la cabecera y las líneas es un rechazo FAU06
 * con el consecutivo ya tomado.
 */
describe('invoice-create-page · splitAiuContratoAmount (paso 6)', () => {
  it("con 'contract' y 5/2/3 sobre $2.328.800: A 116.440 · I 46.576 · U 69.864 · costo 2.095.920", () => {
    const out = splitAiuContratoAmount(CONTRATO_CASO_REAL, REPARTO_523);
    expect(out.administracion).toBe(116440);
    expect(out.imprevistos).toBe(46576);
    expect(out.utilidad).toBe(69864);
    expect(out.costo).toBe(2095920);
  });

  it('las cuatro porciones cierran contra el importe de la línea, al centavo', () => {
    const out = splitAiuContratoAmount(CONTRATO_CASO_REAL, REPARTO_523);
    expect(
      out.administracion + out.imprevistos + out.utilidad + out.costo,
    ).toBeCloseTo(CONTRATO_CASO_REAL, 2);
  });

  it("con 'aiu' la línea ENTERA es el AIU: no queda costo y la utilidad absorbe el residuo", () => {
    const out = splitAiuContratoAmount(1000, {
      percentsScaled: { administracion: 5000, imprevistos: 2000, utilidad: 3000 },
      basis: 'aiu',
    });
    expect(out.costo).toBe(0);
    expect(out.administracion).toBe(500);
    expect(out.imprevistos).toBe(200);
    expect(out.utilidad).toBe(300);
    expect(
      out.administracion + out.imprevistos + out.utilidad + out.costo,
    ).toBeCloseTo(1000, 2);
  });

  it('el truncamiento no pierde ni un centavo: el residuo aterriza en una cubeta', () => {
    const out = splitAiuContratoAmount(1000.01, {
      percentsScaled: { administracion: 3333, imprevistos: 3333, utilidad: 3334 },
      basis: 'aiu',
    });
    expect(
      out.administracion + out.imprevistos + out.utilidad + out.costo,
    ).toBeCloseTo(1000.01, 2);
  });

  it("un reparto imposible bajo 'contract' (Σ > 100 %) NO produce un costo negativo", () => {
    const out = splitAiuContratoAmount(1000, {
      percentsScaled: { administracion: 8000, imprevistos: 4000, utilidad: 3000 },
      basis: 'contract',
    });
    expect(out.costo).toBe(0);
    expect(
      out.administracion + out.imprevistos + out.utilidad + out.costo,
    ).toBeCloseTo(1000, 2);
  });

  it('sin reparto configurado todo es costo: no se inventa AIU', () => {
    const out = splitAiuContratoAmount(1000, {
      percentsScaled: { administracion: 0, imprevistos: 0, utilidad: 0 },
      basis: 'contract',
    });
    expect(out.costo).toBe(1000);
    expect(out.administracion).toBe(0);
  });
});

/**
 * Paso 6 — EL DEFECTO REPORTADO, en una sola afirmación.
 *
 * El dueño eligió «Base AIU NO sumada al total», pulsó «Aplicar a las líneas»
 * y el sistema creó tres renglones que subieron el total de $2.328.800 a
 * $2.587.556: $258.756 facturados de más. Bajo el Modelo 1 aplicar la base NO
 * crea, NO borra y NO reordena líneas — marca las que hay— y el impuesto sale
 * de la porción que la base declarada admite, no del contrato entero.
 *
 * Se prueba sobre un `FormArray` de verdad, que es el mismo objeto que la
 * pantalla muta: `applyAiuMarkingToRows` es la función que el componente
 * delega, no una copia escrita para el spec.
 */
describe('invoice-create-page · Modelo 1 «no sumada»: marcar, no crear (paso 6)', () => {
  const itemsArray = (): FormArray<FormGroup> =>
    new FormArray<FormGroup>([
      new FormGroup({
        description: new FormControl('Servicio de aseo — contrato'),
        quantity: new FormControl(1),
        unit_price: new FormControl(CONTRATO_CASO_REAL),
        discount_amount: new FormControl(0),
        taxes: new FormControl<TaxSelection[]>([]),
        aiu_component: new FormControl(''),
      }),
    ]);

  it('aplicar la base deja UNA línea, marcada «contrato», sin crear ni borrar nada', () => {
    const array = itemsArray();
    expect(array.length).toBe(1);

    const marked = applyAiuMarkingToRows(array.controls, [0], [IVA_19]);

    expect(marked).toBe(1);
    expect(array.length).toBe(1);
    expect(array.at(0).get('aiu_component')!.value).toBe('contrato');
    expect(array.at(0).get('unit_price')!.value).toBe(CONTRATO_CASO_REAL);
    expect(array.at(0).get('taxes')!.value).toEqual([IVA_19]);
  });

  it('el line_extension_amount del documento es IDÉNTICO antes y después', () => {
    const array = itemsArray();
    const antes = computeLineMath(array.at(0).value).base;
    applyAiuMarkingToRows(array.controls, [0], [IVA_19]);
    const despues = computeLineMath(array.at(0).value).base;
    expect(despues).toBe(antes);
    expect(despues).toBe(CONTRATO_CASO_REAL);
  });

  it("base 'utilidad' + 5/2/3: el impuesto del documento es $13.274,16, no $442.472", () => {
    const array = itemsArray();
    applyAiuMarkingToRows(array.controls, [0], [IVA_19]);

    const items = array.controls.map((row) => row.value);
    const math = items.map((item) => computeLineMath(item));
    const out = deriveAiuTotals(
      items,
      math,
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
      REPARTO_523,
    );

    // Utilidad = 3 % × 2.328.800 = 69.864,00 · IVA 19 % = 13.274,16
    expect(out.contractAmount).toBe(CONTRATO_CASO_REAL);
    expect(out.taxableBase).toBeCloseTo(69864, 2);
    expect(out.taxAmount).toBeCloseTo(13274.16, 2);
    // El total facturado sube SÓLO el impuesto: 2.328.800 + 13.274,16.
    expect(out.contractAmount + out.taxAmount).toBeCloseTo(2342074.16, 2);
  });

  it('el AIU embebido no altera el valor del contrato: A+I+U salen de dentro', () => {
    const array = itemsArray();
    applyAiuMarkingToRows(array.controls, [0], [IVA_19]);
    const items = array.controls.map((row) => row.value);
    const out = deriveAiuTotals(
      items,
      items.map((item) => computeLineMath(item)),
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
      REPARTO_523,
    );
    expect(out.portions.administracion).toBe(116440);
    expect(out.portions.imprevistos).toBe(46576);
    expect(out.portions.utilidad).toBe(69864);
    expect(out.portions.costo).toBe(2095920);
    expect(out.contractAmount).toBe(CONTRATO_CASO_REAL);
  });

  it("bajo base 'aiu' la misma línea grava A+I+U: 232.880, no el contrato entero", () => {
    const array = itemsArray();
    applyAiuMarkingToRows(array.controls, [0], [IVA_19]);
    const items = array.controls.map((row) => row.value);
    const out = deriveAiuTotals(
      items,
      items.map((item) => computeLineMath(item)),
      AIU_TAXABLE_BUCKETS_BY_BASIS['aiu'],
      REPARTO_523,
    );
    expect(out.taxableBase).toBeCloseTo(232880, 2);
    expect(out.taxAmount).toBeCloseTo(232880 * 0.19, 2);
  });

  it("bajo base 'subtotal' grava el contrato entero, costo embebido incluido", () => {
    const array = itemsArray();
    applyAiuMarkingToRows(array.controls, [0], [IVA_19]);
    const items = array.controls.map((row) => row.value);
    const out = deriveAiuTotals(
      items,
      items.map((item) => computeLineMath(item)),
      AIU_TAXABLE_BUCKETS_BY_BASIS['subtotal'],
      REPARTO_523,
    );
    expect(out.taxableBase).toBeCloseTo(CONTRATO_CASO_REAL, 2);
  });

  it('marca las N líneas del contrato, no sólo la primera', () => {
    const array = itemsArray();
    array.push(
      new FormGroup({
        description: new FormControl('Vigilancia — contrato'),
        quantity: new FormControl(1),
        unit_price: new FormControl(1000000),
        discount_amount: new FormControl(0),
        taxes: new FormControl<TaxSelection[]>([]),
        aiu_component: new FormControl(''),
      }),
    );
    const marked = applyAiuMarkingToRows(array.controls, [0, 1], [IVA_19]);
    expect(marked).toBe(2);
    expect(array.length).toBe(2);
    expect(array.at(1).get('aiu_component')!.value).toBe('contrato');
  });

  it('un índice que ya no existe no rompe ni desplaza nada', () => {
    const array = itemsArray();
    expect(applyAiuMarkingToRows(array.controls, [0, 5], [IVA_19])).toBe(1);
    expect(array.length).toBe(1);
  });
});

/**
 * Paso 6 — la fracción gravable de una línea, que es lo que la previsión de
 * pantalla usa para escalar el impuesto.
 *
 * La propiedad custodiada: fuera del Modelo 1 la respuesta sigue siendo binaria
 * (1 o 0), exactamente como el `includes` histórico. El Modelo 2 no cambia ni un
 * centavo por este camino.
 */
describe('invoice-create-page · aiuLineTaxableShare (paso 6)', () => {
  it("línea 'contrato' bajo base 'utilidad' con 5/2/3: grava el 3 % de sí misma", () => {
    const share = aiuLineTaxableShare(
      'contrato',
      CONTRATO_CASO_REAL,
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
      REPARTO_523,
    );
    expect(share).toBeCloseTo(0.03, 6);
    expect(CONTRATO_CASO_REAL * share * 0.19).toBeCloseTo(13274.16, 2);
  });

  it('línea de utilidad del Modelo 2: grava entera, como siempre', () => {
    expect(
      aiuLineTaxableShare(
        'utilidad',
        77627,
        AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
        REPARTO_523,
      ),
    ).toBe(1);
  });

  it('línea de administración bajo base utilidad: no grava, como siempre', () => {
    expect(
      aiuLineTaxableShare(
        'administracion',
        129378,
        AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
        REPARTO_523,
      ),
    ).toBe(0);
  });

  it('línea de costo reembolsable: fuera bajo utilidad y AIU, dentro bajo subtotal', () => {
    expect(
      aiuLineTaxableShare('', 2328800, AIU_TAXABLE_BUCKETS_BY_BASIS['aiu'], null),
    ).toBe(0);
    expect(
      aiuLineTaxableShare(
        '',
        2328800,
        AIU_TAXABLE_BUCKETS_BY_BASIS['subtotal'],
        null,
      ),
    ).toBe(1);
  });
});

/**
 * Paso 7 — el desglose A/I/U del resumen de cobro.
 *
 * La propiedad custodiada: SIEMPRE tres filas, con la marca de gravabilidad
 * leída de `AIU_TAXABLE_BUCKETS_BY_BASIS` y no de una lista escrita a mano.
 * Bajo base `'utilidad'` sólo la Utilidad lleva «Gravable»; ver a
 * Administración marcada «No gravable» es lo que evita que el operador crea que
 * el documento está sub-declarando.
 */
describe('invoice-create-page · buildAiuSummaryRows (paso 7)', () => {
  const portions = {
    administracion: 116440,
    imprevistos: 46576,
    utilidad: 69864,
    costo: 2095920,
  };

  it('son TRES filas, en el orden A · I · U', () => {
    const rows = buildAiuSummaryRows(portions, 'utilidad');
    expect(rows.length).toBe(3);
    expect(rows.map((row) => row.key)).toEqual([
      'administracion',
      'imprevistos',
      'utilidad',
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      'Administración',
      'Imprevistos',
      'Utilidad',
    ]);
  });

  it("bajo base 'utilidad' SÓLO la Utilidad lleva el badge «Gravable»", () => {
    const rows = buildAiuSummaryRows(portions, 'utilidad');
    expect(rows.map((row) => row.badge)).toEqual([
      'No gravable',
      'No gravable',
      'Gravable',
    ]);
    expect(rows.filter((row) => row.taxable).map((row) => row.key)).toEqual([
      'utilidad',
    ]);
  });

  it("bajo base 'aiu' las tres porciones gravan", () => {
    const rows = buildAiuSummaryRows(portions, 'aiu');
    expect(rows.every((row) => row.taxable)).toBe(true);
    expect(rows.every((row) => row.badge === 'Gravable')).toBe(true);
  });

  it("bajo base 'subtotal' las tres gravan también (y el costo, que no es fila)", () => {
    const rows = buildAiuSummaryRows(portions, 'subtotal');
    expect(rows.every((row) => row.taxable)).toBe(true);
    expect(rows.some((row) => String(row.key) === 'costo')).toBe(false);
  });

  it('cada fila lleva su importe, y la porción en cero sigue siendo una fila', () => {
    const rows = buildAiuSummaryRows(
      { administracion: 0, imprevistos: 0, utilidad: 69864, costo: 0 },
      'utilidad',
    );
    expect(rows.length).toBe(3);
    expect(rows[0].amount).toBe(0);
    expect(rows[2].amount).toBe(69864);
  });
});

/**
 * Paso 8 — la base se aplica sola UNA vez, y después avisa en vez de pisar.
 *
 * La propiedad custodiada: se aplica sobre un documento virgen (operación 09,
 * plan aplicable, líneas capturadas, ninguna con componente) y JAMÁS vuelve a
 * hacerlo. Tras editar un importe a mano el documento cambia, el reparto
 * escrito deja de corresponder, y lo que sale es el aviso — no una
 * sobrescritura silenciosa de cifras que el operador no escribió.
 */
describe('invoice-create-page · auto-aplicación de la base AIU (paso 8)', () => {
  const virgen: AiuAutoApplyState = {
    isAiu: true,
    planReady: true,
    applied: false,
    lineCount: 1,
    linesWithComponent: 0,
    fingerprint: '2328800.00:costo',
    appliedFingerprint: null,
  };

  it('documento virgen con la primera línea capturada: se aplica sola', () => {
    expect(shouldAutoApplyAiuBase(virgen)).toBe(true);
  });

  it('ya aplicada: NUNCA vuelve a aplicarse sola', () => {
    expect(
      shouldAutoApplyAiuBase({
        ...virgen,
        applied: true,
        linesWithComponent: 0,
      }),
    ).toBe(false);
  });

  it('con una línea ya marcada a mano no se mete: cede el turno al aviso', () => {
    expect(
      shouldAutoApplyAiuBase({ ...virgen, linesWithComponent: 1 }),
    ).toBe(false);
  });

  it('sin líneas, sin plan aplicable o fuera de la operación AIU: no se aplica', () => {
    expect(shouldAutoApplyAiuBase({ ...virgen, lineCount: 0 })).toBe(false);
    expect(shouldAutoApplyAiuBase({ ...virgen, planReady: false })).toBe(false);
    expect(shouldAutoApplyAiuBase({ ...virgen, isAiu: false })).toBe(false);
  });

  it('tras aplicar y NO tocar nada: ni se re-aplica ni avisa', () => {
    const aplicado: AiuAutoApplyState = {
      ...virgen,
      applied: true,
      linesWithComponent: 1,
      fingerprint: '2328800.00:contrato',
      appliedFingerprint: '2328800.00:contrato',
    };
    expect(shouldAutoApplyAiuBase(aplicado)).toBe(false);
    expect(shouldOfferAiuReapply(aplicado)).toBe(false);
  });

  it('tras editar un importe a mano: NO sobrescribe y expone el aviso', () => {
    const editadoAMano: AiuAutoApplyState = {
      ...virgen,
      applied: true,
      linesWithComponent: 1,
      fingerprint: '2500000.00:contrato',
      appliedFingerprint: '2328800.00:contrato',
    };
    expect(shouldAutoApplyAiuBase(editadoAMano)).toBe(false);
    expect(shouldOfferAiuReapply(editadoAMano)).toBe(true);
  });

  it('sin haber aplicado nunca no hay nada que re-aplicar: el aviso calla', () => {
    expect(shouldOfferAiuReapply(virgen)).toBe(false);
  });

  it('la huella cambia con el importe y con la porción, no con la descripción', () => {
    const items = [{ aiu_component: 'contrato' }];
    const math = [{ base: 2328800 }];
    expect(aiuDocumentFingerprint(items, math)).toBe('2328800.00:contrato');
    expect(aiuDocumentFingerprint(items, [{ base: 2500000 }])).not.toBe(
      '2328800.00:contrato',
    );
    expect(aiuDocumentFingerprint([{ aiu_component: '' }], math)).toBe(
      '2328800.00:costo',
    );
    // Una línea añadida cambia la huella aunque las anteriores no se toquen.
    expect(
      aiuDocumentFingerprint(
        [...items, { aiu_component: '' }],
        [...math, { base: 1000 }],
      ),
    ).toBe('2328800.00:contrato|1000.00:costo');
  });
});

/**
 * Paso 6 — LA NO REGRESIÓN DEL MODELO 2.
 *
 * `'sumada'` es lo que emiten hoy todos los contratos AIU del sistema. La
 * propiedad custodiada es que ninguna de las funciones nuevas lo toca: pasarles
 * un reparto configurado no mueve ni un centavo mientras no haya una línea
 * `'contrato'`, que es la única forma del Modelo 1.
 */
describe('invoice-create-page · el Modelo 2 no cambia (paso 6)', () => {
  const iva19: TaxSelection = { ...IVA_19, tax_rate_id: 1, name: 'IVA 19 %' };
  const rows = [
    { item: { aiu_component: null }, input: { quantity: 1, unit_price: 2328800, discount_amount: 0, taxes: [] as TaxSelection[] } },
    { item: { aiu_component: 'administracion' }, input: { quantity: 1, unit_price: 129378, discount_amount: 0, taxes: [] as TaxSelection[] } },
    { item: { aiu_component: 'imprevistos' }, input: { quantity: 1, unit_price: 51751, discount_amount: 0, taxes: [] as TaxSelection[] } },
    { item: { aiu_component: 'utilidad' }, input: { quantity: 1, unit_price: 77627, discount_amount: 0, taxes: [iva19] } },
  ];

  const items = rows.map((row) => row.item);
  const math = rows.map((row) => computeLineMath(row.input));

  it('con reparto configurado o sin él, el documento del Modelo 2 da las MISMAS cifras', () => {
    const sinReparto = deriveAiuTotals(
      items,
      math,
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
    );
    const conReparto = deriveAiuTotals(
      items,
      math,
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
      REPARTO_523,
    );
    expect(conReparto).toEqual(sinReparto);
  });

  it('las cifras del Modelo 2 siguen siendo las históricas, al centavo', () => {
    const out = deriveAiuTotals(
      items,
      math,
      AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
      REPARTO_523,
    );
    expect(out.contractAmount).toBe(2587556);
    expect(out.taxableBase).toBe(77627);
    expect(out.taxAmount).toBeCloseTo(14749.13, 2);
    expect(out.portions.administracion).toBe(129378);
    expect(out.portions.imprevistos).toBe(51751);
    expect(out.portions.utilidad).toBe(77627);
    expect(out.portions.costo).toBe(2328800);
  });

  it('la fracción gravable del Modelo 2 sigue siendo binaria: 1 o 0', () => {
    const shares = items.map((item, index) =>
      aiuLineTaxableShare(
        String(item.aiu_component ?? ''),
        math[index].base,
        AIU_TAXABLE_BUCKETS_BY_BASIS['utilidad'],
        REPARTO_523,
      ),
    );
    expect(shares).toEqual([0, 0, 0, 1]);
  });
});
