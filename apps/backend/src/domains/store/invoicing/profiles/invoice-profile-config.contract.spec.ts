import { readFileSync } from 'fs';
import { join } from 'path';

import { VendixHttpException } from 'src/common/errors';

import {
  ACCOUNTING_MODELS,
  AIU_BUCKETS,
  AIU_LEGAL_FLOOR_PERCENT_SCALED,
  AIU_TAXABLE_BASES,
  AIU_TAXABLE_BUCKETS_BY_BASIS,
  ENABLED_ACCOUNTING_MODELS,
  INVOICE_PROFILE_CONFIG_VERSION,
  InvoiceProfileConfig,
  accountingModelDisabledReason,
  blockingIssues,
  buildDefaultAiuProfileConfig,
  formatPercentScaled,
  isAccountingModelEnabled,
  parsePercentScaled,
  regimeFromTaxableBasis,
  resolveAccountingModel,
  resolveAiuComponentsBasis,
  resolveAiuTaxableBasis,
  taxableBasisFromRegime,
  validateInvoiceProfileConfig,
} from './invoice-profile-config.contract';
import { normalizeAndAssertProfileConfig } from './invoice-profile-config.validator';

/** Códigos de los problemas devueltos, para afirmar sin acoplarse al texto. */
function codes(config: InvoiceProfileConfig, operation_type = '09'): string[] {
  return validateInvoiceProfileConfig(config, { operation_type }).map(
    (i) => i.code,
  );
}

/** Snapshot AIU válido; cada test lo desvía en un solo eje. */
function aiuConfig(
  patch: (c: InvoiceProfileConfig) => void = () => undefined,
): InvoiceProfileConfig {
  const config = JSON.parse(
    JSON.stringify(buildDefaultAiuProfileConfig('Aseo y cafetería sede norte')),
  ) as InvoiceProfileConfig;
  patch(config);
  return config;
}

describe('InvoiceProfileConfig — aritmética de porcentajes', () => {
  it('parsea y reimprime sin perder el valor', () => {
    expect(parsePercentScaled('19.00')).toBe(1900);
    expect(parsePercentScaled('0.00')).toBe(0);
    expect(parsePercentScaled('5')).toBe(500);
    expect(parsePercentScaled('5.5')).toBe(550);
    expect(parsePercentScaled('100.00')).toBe(10000);
    expect(formatPercentScaled(1900)).toBe('19.00');
    expect(formatPercentScaled(0)).toBe('0.00');
    expect(formatPercentScaled(10000)).toBe('100.00');
  });

  it('rechaza lo que no es un porcentaje de dos decimales', () => {
    // Tres decimales no se aceptan: el `cbc:Percent` del anexo lleva dos, y
    // admitirlos acá sólo aplazaría el redondeo hasta el XML.
    expect(parsePercentScaled('33.333')).toBeNull();
    expect(parsePercentScaled('-5.00')).toBeNull();
    expect(parsePercentScaled('19,00')).toBeNull();
    expect(parsePercentScaled('abc')).toBeNull();
    expect(parsePercentScaled('')).toBeNull();
    expect(parsePercentScaled(19)).toBeNull();
    expect(parsePercentScaled(null)).toBeNull();
    expect(parsePercentScaled(undefined)).toBeNull();
  });

  it('el reparto que el punto flotante rompería suma exactamente 100', () => {
    // La razón de que los porcentajes sean `string` y la suma entera. Este
    // reparto —perfectamente posible en un contrato real— NO da 100 en
    // IEEE-754: da 100.00000000000001, así que una validación con `number`
    // rechazaría una configuración correcta.
    //
    // Ojo con el ejemplo: `33.33 + 33.33 + 33.34` SÍ da exactamente 100 en
    // punto flotante. El intuitivo no sirve como caso de prueba; hay que
    // buscar uno que de verdad falle.
    expect(14.21 + 49.84 + 35.95).not.toBe(100);
    expect(
      parsePercentScaled('14.21')! +
        parsePercentScaled('49.84')! +
        parsePercentScaled('35.95')!,
    ).toBe(10000);

    const config = aiuConfig((c) => {
      c.aiu!.components = {
        administracion: '14.21',
        imprevistos: '49.84',
        utilidad: '35.95',
      };
    });
    expect(codes(config)).not.toContain('AIU_PERCENT_SUM');
  });

  it('y el reparto que se rompe por el otro lado también suma 100', () => {
    // 99.99999999999999 en `number`: el mismo error con el signo contrario.
    expect(14.29 + 49.91 + 35.8).not.toBe(100);
    const config = aiuConfig((c) => {
      c.aiu!.components = {
        administracion: '14.29',
        imprevistos: '49.91',
        utilidad: '35.80',
      };
    });
    expect(codes(config)).not.toContain('AIU_PERCENT_SUM');
  });
});

describe('InvoiceProfileConfig — el snapshot por omisión', () => {
  it('valida limpio', () => {
    expect(codes(aiuConfig())).toEqual([]);
  });

  it('trae el régimen conservador y el piso legal activo', () => {
    const config = buildDefaultAiuProfileConfig('x');
    // `et_462_1` grava el AIU COMPLETO: declara MÁS IVA. Equivocarse por ese
    // lado es recuperable; por el otro es sanción.
    expect(config.aiu!.regime).toBe('et_462_1');
    expect(config.aiu!.enforce_minimum_base).toBe(true);
    expect(config.aiu!.minimum_base_percent).toBe('10.00');
    expect(config.config_version).toBe(INVOICE_PROFILE_CONFIG_VERSION);
  });

  it('declara una regla de impuesto por cada porción del contrato', () => {
    const buckets = buildDefaultAiuProfileConfig('x').taxes.rules.map(
      (r) => r.bucket,
    );
    expect(buckets).toEqual([
      'administracion',
      'imprevistos',
      'utilidad',
      'costo',
    ]);
  });
});

describe('InvoiceProfileConfig — porcentajes AIU', () => {
  it('un reparto que no suma 100 se rechaza nombrando la suma real', () => {
    const config = aiuConfig((c) => {
      // Unidad `'aiu'`: es la única en la que «sumar 100» es la regla.
      c.aiu!.components_basis = 'aiu';
      c.aiu!.components = {
        administracion: '50.00',
        imprevistos: '10.00',
        utilidad: '10.00',
      };
    });
    const issues = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    });
    const sum = issues.find((i) => i.code === 'AIU_PERCENT_SUM');
    expect(sum).toBeDefined();
    expect(sum!.message).toContain('70.00');
    expect(sum!.field).toBe('aiu.components');
  });

  it('sumar 100.01 también se rechaza', () => {
    const config = aiuConfig((c) => {
      c.aiu!.components_basis = 'aiu';
      c.aiu!.components = {
        administracion: '10.01',
        imprevistos: '5.00',
        utilidad: '85.00',
      };
    });
    expect(codes(config)).toContain('AIU_PERCENT_SUM');
  });

  it('un porcentaje ilegible se señala en su propio campo y no se suma', () => {
    const config = aiuConfig((c) => {
      (c.aiu!.components as any).utilidad = '85,00';
    });
    const issues = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    });
    expect(issues.map((i) => i.field)).toContain('aiu.components.utilidad');
    // No se acumula un AIU_PERCENT_SUM engañoso a partir de una suma parcial.
    expect(issues.map((i) => i.code)).not.toContain('AIU_PERCENT_SUM');
  });
});

describe('InvoiceProfileConfig — la unidad de los porcentajes', () => {
  it('resolveAiuComponentsBasis lee la ausencia como la unidad heredada', () => {
    // La ausencia NO puede significar `'contract'`: los snapshots ya timbrados
    // se escribieron sobre el AIU, y leer un `85.00` de utilidad como «85 % del
    // contrato» multiplicaría por diez la base gravable de un documento emitido.
    expect(resolveAiuComponentsBasis(null)).toBe('aiu');
    expect(resolveAiuComponentsBasis(undefined)).toBe('aiu');
    expect(resolveAiuComponentsBasis({ components_basis: null })).toBe('aiu');
    expect(resolveAiuComponentsBasis({ components_basis: 'aiu' })).toBe('aiu');
    expect(resolveAiuComponentsBasis({ components_basis: 'contract' })).toBe(
      'contract',
    );
    // Una unidad corrupta cae del lado conservador, no del inflado.
    expect(
      resolveAiuComponentsBasis({ components_basis: 'kontrakt' as never }),
    ).toBe('aiu');
  });

  it('el snapshot por omisión mide sobre el contrato y suma el piso legal', () => {
    const aiu = buildDefaultAiuProfileConfig('x').aiu!;
    expect(aiu.components_basis).toBe('contract');
    const sum =
      parsePercentScaled(aiu.components.administracion)! +
      parsePercentScaled(aiu.components.imprevistos)! +
      parsePercentScaled(aiu.components.utilidad)!;
    expect(sum).toBe(AIU_LEGAL_FLOOR_PERCENT_SCALED);
  });

  it('sobre el contrato, un AIU del 70% es legítimo y no se rechaza', () => {
    const config = aiuConfig((c) => {
      c.aiu!.components_basis = 'contract';
      c.aiu!.components = {
        administracion: '40.00',
        imprevistos: '10.00',
        utilidad: '20.00',
      };
    });
    const found = codes(config);
    expect(found).not.toContain('AIU_PERCENT_SUM');
    expect(found).not.toContain('AIU_PERCENT_SUM_OF_CONTRACT');
    expect(found).not.toContain('AIU_PERCENT_SUM_BELOW_FLOOR');
  });

  it('sobre el contrato, cero y más del 100% se rechazan', () => {
    for (const parts of [
      { administracion: '0.00', imprevistos: '0.00', utilidad: '0.00' },
      { administracion: '50.00', imprevistos: '50.00', utilidad: '0.01' },
    ]) {
      const config = aiuConfig((c) => {
        c.aiu!.components_basis = 'contract';
        c.aiu!.components = parts;
      });
      expect(codes(config)).toContain('AIU_PERCENT_SUM_OF_CONTRACT');
    }
  });

  it('sobre el contrato, un AIU por debajo del piso se ataja AL GUARDAR', () => {
    // Esta es la compuerta que la unidad `'aiu'` no puede tener: allí la suma
    // es siempre 100 y no dice nada del contrato, así que el piso sólo se podía
    // comprobar al calcular el documento — con el consecutivo ya gastado.
    const config = aiuConfig((c) => {
      c.aiu!.components_basis = 'contract';
      c.aiu!.components = {
        administracion: '4.00',
        imprevistos: '2.00',
        utilidad: '2.00',
      };
    });
    const issue = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    }).find((i) => i.code === 'AIU_PERCENT_SUM_BELOW_FLOOR');
    expect(issue).toBeDefined();
    expect(issue!.field).toBe('aiu.components');
    expect(issue!.message).toContain('8.00');
    expect(issue!.message).toContain('10.00');
  });

  it('sin exigir piso, el mismo 8% pasa', () => {
    const config = aiuConfig((c) => {
      c.aiu!.components_basis = 'contract';
      c.aiu!.enforce_minimum_base = false;
      c.aiu!.components = {
        administracion: '4.00',
        imprevistos: '2.00',
        utilidad: '2.00',
      };
    });
    expect(codes(config)).not.toContain('AIU_PERCENT_SUM_BELOW_FLOOR');
  });

  it('bajo el Decreto 1372/1992 no hay piso que exigir', () => {
    const config = aiuConfig((c) => {
      c.aiu!.components_basis = 'contract';
      c.aiu!.regime = 'decreto_1372_1992';
      c.aiu!.components = {
        administracion: '4.00',
        imprevistos: '2.00',
        utilidad: '2.00',
      };
      // Bajo este régimen sólo la utilidad grava; si no se ajusta la matriz el
      // ruido de `TAX_MATRIX_CONTRADICTS_REGIME` taparía lo que se mide acá.
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.bucket === 'utilidad'
          ? r
          : { ...r, taxable: false, rate: '0.00' },
      );
    });
    expect(codes(config)).not.toContain('AIU_PERCENT_SUM_BELOW_FLOOR');
  });

  it('una unidad desconocida se reporta y se trata como la heredada', () => {
    const config = aiuConfig((c) => {
      (c.aiu as { components_basis?: unknown }).components_basis = 'kontrakt';
    });
    const found = codes(config);
    expect(found).toContain('AIU_BASIS_UNKNOWN');
    // 5 + 2 + 3 = 10, que sobre el AIU no suma 100: al caer del lado
    // conservador la configuración corrupta NO se aprueba en silencio.
    expect(found).toContain('AIU_PERCENT_SUM');
  });
});

describe('InvoiceProfileConfig — el piso legal', () => {
  it('bajar del 10% bajo et_462_1 se rechaza', () => {
    const config = aiuConfig((c) => {
      c.aiu!.minimum_base_percent = '5.00';
    });
    const issue = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    }).find((i) => i.code === 'AIU_FLOOR_BELOW_LEGAL');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('10.00');
    expect(issue!.message).toContain('5.00');
  });

  it('el 10% exacto pasa: es un mínimo, no un umbral estricto', () => {
    expect(codes(aiuConfig())).not.toContain('AIU_FLOOR_BELOW_LEGAL');
  });

  it('subirlo se permite — declara más IVA, que es el lado recuperable', () => {
    const config = aiuConfig((c) => {
      c.aiu!.minimum_base_percent = '15.00';
    });
    expect(codes(config)).not.toContain('AIU_FLOOR_BELOW_LEGAL');
  });

  it('con el piso apagado explícitamente no se mide', () => {
    const config = aiuConfig((c) => {
      c.aiu!.enforce_minimum_base = false;
      c.aiu!.minimum_base_percent = '1.00';
    });
    expect(codes(config)).not.toContain('AIU_FLOOR_BELOW_LEGAL');
  });

  it('bajo decreto_1372_1992 no hay piso que respetar', () => {
    const config = aiuConfig((c) => {
      c.aiu!.regime = 'decreto_1372_1992';
      c.aiu!.minimum_base_percent = '0.00';
      c.taxes.rules = [
        { bucket: 'administracion', taxable: false, tax_code: '01', rate: '0.00' },
        { bucket: 'imprevistos', taxable: false, tax_code: '01', rate: '0.00' },
        { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '19.00' },
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ];
    });
    expect(codes(config)).toEqual([]);
  });

  it('un enforce_minimum_base ausente se rechaza en vez de asumirse', () => {
    // En `store_settings` la ausencia significa «activo», y esa ambigüedad ya
    // obligó a escribir `=== false` en la emisión. Un snapshot no la hereda.
    const config = aiuConfig((c) => {
      delete (c.aiu as any).enforce_minimum_base;
    });
    expect(codes(config)).toContain('AIU_ENFORCE_NOT_EXPLICIT');
  });
});

describe('InvoiceProfileConfig — la matriz no puede contradecir el régimen', () => {
  it('bajo et_462_1 dejar imprevistos sin gravar se rechaza', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.bucket === 'imprevistos'
          ? { ...r, taxable: false, rate: '0.00' }
          : r,
      );
    });
    const issue = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    }).find((i) => i.code === 'TAX_MATRIX_CONTRADICTS_REGIME');
    expect(issue).toBeDefined();
    expect(issue!.field).toBe('taxes.rules.imprevistos.taxable');
  });

  it('bajo decreto_1372_1992 gravar administración se rechaza', () => {
    const config = aiuConfig((c) => {
      c.aiu!.regime = 'decreto_1372_1992';
      c.aiu!.minimum_base_percent = '10.00';
    });
    // El default grava los tres, que es lo correcto para et_462_1 y lo
    // incorrecto para el decreto: dos contradicciones, una por componente.
    const contradictions = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    }).filter((i) => i.code === 'TAX_MATRIX_CONTRADICTS_REGIME');
    expect(contradictions.map((i) => i.field)).toEqual([
      'taxes.rules.administracion.taxable',
      'taxes.rules.imprevistos.taxable',
    ]);
  });

  /**
   * El MENSAJE, no sólo el código.
   *
   * `describeTaxableBasis` produce tres textos y ninguna aseveración los tocaba:
   * se podían intercambiar «AIU completo» y «sólo utilidad» y la suite entera
   * seguía verde. Ese mensaje es lo único que le dice a la persona qué corregir,
   * así que intercambiarlo la manda a arreglar exactamente lo contrario —y en
   * materia de IVA eso es declarar de menos, que es sanción e intereses.
   *
   * Se afirma la CITA LEGAL de cada base, que es la parte que no se puede
   * reescribir por gusto: el art. 462-1 y el Decreto 1372/1992 no son
   * intercambiables, y «Subtotal» no tiene ninguna porque no es un régimen.
   */
  it('el mensaje de la contradicción nombra la base declarada, no el régimen heredado', () => {
    const decreto = validateInvoiceProfileConfig(
      aiuConfig((c) => {
        c.aiu!.regime = 'decreto_1372_1992';
        c.aiu!.minimum_base_percent = '10.00';
      }),
      { operation_type: '09' },
    ).filter((i) => i.code === 'TAX_MATRIX_CONTRADICTS_REGIME');
    expect(decreto.length).toBeGreaterThan(0);
    for (const issue of decreto) {
      expect(issue.message).toContain('Decreto 1372/1992');
      expect(issue.message).not.toContain('462-1');
    }

    const et = validateInvoiceProfileConfig(
      aiuConfig((c) => {
        c.taxes.rules = c.taxes.rules.map((r) =>
          r.bucket === 'utilidad' ? { ...r, taxable: false, rate: '0.00' } : r,
        );
      }),
      { operation_type: '09' },
    ).filter((i) => i.code === 'TAX_MATRIX_CONTRADICTS_REGIME');
    expect(et.length).toBeGreaterThan(0);
    for (const issue of et) {
      expect(issue.message).toContain('462-1');
      expect(issue.message).not.toContain('1372');
    }
  });

  /**
   * Bajo «subtotal» el mensaje NO puede citar un régimen, porque esa base no
   * colapsa a ninguno: declina el tratamiento AIU. Los mensajes que
   * interpolaban `config.aiu.regime` imprimían acá el régimen heredado —o
   * `undefined`— sobre un perfil cuya base era otra.
   */
  /**
   * LA GUARDA QUE CARGA CON TODOS LOS PERFILES ORDINARIOS.
   *
   * `validateTaxSection` se llama sin condición, y lo único que impide que su
   * cola AIU se aplique a un perfil de venta corriente es un `if (!config.aiu)
   * return;` de una línea. Sin ella, `resolveAiuTaxableBasis(undefined)` NO
   * lanza: devuelve `'aiu'` por su propio fallback conservador, la matriz
   * esperada pasa a ser A+I+U, y el recorrido exige `TAX_RULE_MISSING` de tres
   * porciones a un perfil que no tiene AIU en absoluto. Resultado: TODO perfil
   * ordinario deja de poder guardarse, con un 422 que le pide reglas de
   * impuesto de Administración a quien vende empanadas.
   *
   * Antes de este caso ningún test pasaba una config sin sección `aiu` por acá,
   * así que borrar esa línea dejaba la suite entera en verde.
   */
  it('un perfil SIN sección aiu no recibe ningún problema de la matriz AIU', () => {
    const config = aiuConfig((c) => {
      delete (c as unknown as Record<string, unknown>).aiu;
    });
    const found = codes(config).filter((c) => c.startsWith('TAX_'));
    expect(found).toEqual([]);
  });

  /**
   * El SENTIDO del mensaje, no sólo su cita legal.
   *
   * `TAX_MATRIX_CONTRADICTS_REGIME` tiene dos redacciones y las elige un
   * ternario sobre `shouldBeTaxable`. Invertirlo produce mensajes que dicen
   * exactamente lo contrario de lo que hay que hacer —«no puede quedar sin
   * gravar» sobre una casilla que hay que DESgravar— y ninguna aseveración lo
   * notaba. Es el peor mutante posible en un mensaje de corrección: no confunde,
   * dirige mal.
   */
  it('el mensaje dice DESgravar cuando sobra el impuesto y gravar cuando falta', () => {
    // Bajo el decreto sólo la utilidad entra: gravar administración es de MÁS.
    const sobra = validateInvoiceProfileConfig(
      aiuConfig((c) => {
        c.aiu!.regime = 'decreto_1372_1992';
        c.aiu!.minimum_base_percent = '10.00';
      }),
      { operation_type: '09' },
    ).find(
      (i) =>
        i.code === 'TAX_MATRIX_CONTRADICTS_REGIME' &&
        i.field === 'taxes.rules.administracion.taxable',
    );
    expect(sobra).toBeDefined();
    expect(sobra!.message).toContain('no incluye');
    expect(sobra!.message).toContain('no puede quedar gravado');

    // Bajo el art. 462-1 los tres entran: desgravar imprevistos es de MENOS.
    const falta = validateInvoiceProfileConfig(
      aiuConfig((c) => {
        c.taxes.rules = c.taxes.rules.map((r) =>
          r.bucket === 'imprevistos' ? { ...r, taxable: false, rate: '0.00' } : r,
        );
      }),
      { operation_type: '09' },
    ).find(
      (i) =>
        i.code === 'TAX_MATRIX_CONTRADICTS_REGIME' &&
        i.field === 'taxes.rules.imprevistos.taxable',
    );
    expect(falta).toBeDefined();
    expect(falta!.message).toContain('incluye');
    expect(falta!.message).not.toContain('no incluye');
    expect(falta!.message).toContain('no puede quedar sin gravar');
  });

  it('bajo subtotal el mensaje no cita ningún régimen legal', () => {
    const issues = validateInvoiceProfileConfig(
      aiuConfig((c) => {
        c.aiu!.taxable_basis = 'subtotal';
      }),
      { operation_type: '09' },
    ).filter(
      (i) =>
        i.code === 'TAX_MATRIX_CONTRADICTS_REGIME' ||
        i.code === 'TAX_RULE_MISSING',
    );
    // El default deja el costo fuera de la base, y bajo «subtotal» entra: hay
    // al menos una contradicción que reportar.
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.message).not.toContain('462-1');
      expect(issue.message).not.toContain('1372');
      expect(issue.message).not.toContain('undefined');
    }
  });

  it('falta la regla de un componente → se rechaza, no se asume', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.filter((r) => r.bucket !== 'utilidad');
    });
    expect(codes(config)).toContain('TAX_RULE_MISSING');
  });

  it('el costo reembolsable no puede quedar gravado', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.bucket === 'costo' ? { ...r, taxable: true, rate: '19.00' } : r,
      );
    });
    expect(codes(config)).toContain('TAX_COST_MUST_NOT_BE_TAXABLE');
  });

  it('dos reglas para la misma porción se rechazan', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = [
        ...c.taxes.rules,
        { bucket: 'utilidad', taxable: true, tax_code: '01', rate: '5.00' },
      ];
    });
    expect(codes(config)).toContain('TAX_BUCKET_DUPLICATED');
  });
});

describe('InvoiceProfileConfig — taxable_basis (Subtotal / AIU / Utilidad)', () => {
  it('regimeFromTaxableBasis y taxableBasisFromRegime son inversas para aiu y utilidad', () => {
    expect(regimeFromTaxableBasis('aiu')).toBe('et_462_1');
    expect(regimeFromTaxableBasis('utilidad')).toBe('decreto_1372_1992');
    expect(taxableBasisFromRegime('et_462_1')).toBe('aiu');
    expect(taxableBasisFromRegime('decreto_1372_1992')).toBe('utilidad');
    for (const regime of ['et_462_1', 'decreto_1372_1992'] as const) {
      expect(regimeFromTaxableBasis(taxableBasisFromRegime(regime))).toBe(
        regime,
      );
    }
  });

  it('subtotal no tiene régimen legal: regimeFromTaxableBasis devuelve null', () => {
    expect(regimeFromTaxableBasis('subtotal')).toBeNull();
  });

  it('un config sin taxable_basis se lee con la base derivada de regime, sin escribir', () => {
    const config = aiuConfig();
    delete (config.aiu as any).taxable_basis;
    expect(config.aiu!.taxable_basis).toBeUndefined();
    expect(resolveAiuTaxableBasis(config.aiu)).toBe('aiu');

    const config2 = aiuConfig((c) => {
      c.aiu!.regime = 'decreto_1372_1992';
    });
    delete (config2.aiu as any).taxable_basis;
    expect(resolveAiuTaxableBasis(config2.aiu)).toBe('utilidad');

    // La lectura no reescribe el snapshot.
    expect(config.aiu).not.toHaveProperty('taxable_basis');
  });

  it('taxable_basis presente gana sobre regime cuando ambos están', () => {
    const config = aiuConfig((c) => {
      c.aiu!.regime = 'et_462_1';
      (c.aiu as any).taxable_basis = 'utilidad';
    });
    expect(resolveAiuTaxableBasis(config.aiu)).toBe('utilidad');
  });

  it('un valor desconocido de taxable_basis se rechaza', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'contrato_completo';
    });
    expect(codes(config)).toContain('AIU_TAXABLE_BASIS_UNKNOWN');
  });

  it('los tres valores válidos no producen AIU_TAXABLE_BASIS_UNKNOWN', () => {
    for (const basis of AIU_TAXABLE_BASES) {
      const config = aiuConfig((c) => {
        (c.aiu as any).taxable_basis = basis;
        if (basis === 'subtotal') {
          // Bajo subtotal la matriz queda libre: se relaja a propósito.
          c.taxes.rules = c.taxes.rules.map((r) => ({
            ...r,
            taxable: true,
            rate: '19.00',
          }));
        }
      });
      expect(codes(config)).not.toContain('AIU_TAXABLE_BASIS_UNKNOWN');
    }
  });

  it('con base subtotal no se exige el piso legal aunque el porcentaje sea bajo', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'subtotal';
      c.aiu!.minimum_base_percent = '0.00';
    });
    expect(codes(config)).not.toContain('AIU_FLOOR_BELOW_LEGAL');
    expect(codes(config)).not.toContain('AIU_PERCENT_SUM_BELOW_FLOOR');
  });

  it('con base subtotal la matriz puede gravar el costo sin rechazo', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'subtotal';
      c.taxes.rules = c.taxes.rules.map((r) => ({
        ...r,
        taxable: true,
        rate: '19.00',
      }));
    });
    expect(codes(config)).not.toContain('TAX_COST_MUST_NOT_BE_TAXABLE');
    expect(codes(config)).not.toContain('TAX_MATRIX_CONTRADICTS_REGIME');
  });

  /**
   * Este caso afirmaba lo contrario cuando se introdujo `taxable_basis`, con el
   * argumento de que bajo «subtotal» la gravabilidad la decide `isAiuTaxable` y
   * no la matriz. El argumento vale para el SENTIDO de cada casilla y no para su
   * AUSENCIA: si falta la regla de una porción que la base sí grava, la emisión
   * no tiene tarifa que aplicar y la factura sale declarando de menos. Bajo esa
   * lectura el `return` temprano apagaba cuatro guardas de golpe, y una config
   * con `administracion.taxable = false` validaba limpia para producir
   * documentos que INVOICING_AIU_004 corta al emitir, con consecutivo gastado.
   */
  it('con base subtotal SÍ se exige la regla de una porción que la base grava', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'subtotal';
      c.taxes.rules = c.taxes.rules.map((r) => ({
        ...r,
        taxable: true,
        rate: '19.00',
      }));
      c.taxes.rules = c.taxes.rules.filter((r) => r.bucket !== 'utilidad');
    });
    expect(codes(config)).toContain('TAX_RULE_MISSING');
  });

  it('con base subtotal el costo sin regla también se exige: entra en la base', () => {
    // Bajo «aiu» y «utilidad» el costo queda fuera por definición y su regla es
    // opcional. Bajo «subtotal» es la porción MÁS GRANDE del contrato, así que
    // omitirla es dejar sin tarifa el 90 % de lo facturado.
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'subtotal';
      c.taxes.rules = c.taxes.rules
        .map((r) => ({ ...r, taxable: true, rate: '19.00' }))
        .filter((r) => r.bucket !== 'costo');
    });
    expect(codes(config)).toContain('TAX_RULE_MISSING');
  });

  it('bajo aiu y utilidad el costo sin regla NO se exige: queda fuera de la base', () => {
    for (const basis of ['aiu', 'utilidad']) {
      const config = aiuConfig((c) => {
        (c.aiu as any).taxable_basis = basis;
        c.taxes.rules = c.taxes.rules.filter((r) => r.bucket !== 'costo');
      });
      expect(codes(config)).not.toContain('TAX_RULE_MISSING');
    }
  });
});

describe('InvoiceProfileConfig — matriz AIU derivada de la base (sonda permanente)', () => {
  /**
   * La sonda que originó este plan: con la base por omisión (`aiu`) y un clic
   * en «Agregar impuesto» el guardado devolvía 2 bloqueantes TAX_RULE_MISSING
   * (imprevistos, utilidad); con dos clics se sumaba TAX_BUCKET_DUPLICATED.
   * Los tres escenarios de la izquierda lo dejan escrito con su código exacto:
   * si alguien reintroduce la matriz parcial, el spec dice qué código bloquea.
   * Los tres de la derecha —uno por base— afirman el criterio de aceptación:
   * la matriz derivada de cuatro porciones guarda sin bloqueos.
   */
  const derivedRules = (basis: 'aiu' | 'utilidad' | 'subtotal') => {
    const taxable = AIU_TAXABLE_BUCKETS_BY_BASIS[basis];
    return AIU_BUCKETS.map((bucket) => {
      const shouldBeTaxable = taxable.includes(bucket);
      return {
        bucket,
        taxable: shouldBeTaxable,
        tax_code: '01',
        rate: shouldBeTaxable ? '19.00' : '0.00',
      };
    });
  };

  it('matriz parcial bajo aiu: faltan imprevistos y utilidad (2 TAX_RULE_MISSING)', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = [
        {
          bucket: 'administracion',
          taxable: true,
          tax_code: '01',
          rate: '19.00',
        },
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ] as any;
    });
    const blocking = blockingIssues(
      validateInvoiceProfileConfig(config, { operation_type: '09' }),
    );
    const missing = blocking.filter((i) => i.code === 'TAX_RULE_MISSING');
    expect(missing.map((i) => i.field).sort()).toEqual([
      'taxes.rules.imprevistos',
      'taxes.rules.utilidad',
    ]);
  });

  it('matriz parcial con porción duplicada: se suma TAX_BUCKET_DUPLICATED', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = [
        {
          bucket: 'administracion',
          taxable: true,
          tax_code: '01',
          rate: '19.00',
        },
        {
          bucket: 'administracion',
          taxable: true,
          tax_code: '01',
          rate: '19.00',
        },
        { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00' },
      ] as any;
    });
    expect(codes(config)).toContain('TAX_BUCKET_DUPLICATED');
    expect(codes(config)).toContain('TAX_RULE_MISSING');
  });

  it('matriz que grava lo que la base utilidad excluye: TAX_MATRIX_CONTRADICTS_REGIME', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'utilidad';
      (c.aiu as any).regime = 'decreto_1372_1992';
      c.taxes.rules = derivedRules('utilidad').map((r) =>
        r.bucket === 'administracion' ? { ...r, taxable: true } : r,
      ) as any;
    });
    expect(codes(config)).toContain('TAX_MATRIX_CONTRADICTS_REGIME');
  });

  it.each(['aiu', 'utilidad', 'subtotal'] as const)(
    'base %s con la matriz derivada: 0 bloqueantes',
    (basis) => {
      const config = aiuConfig((c) => {
        (c.aiu as any).taxable_basis = basis;
        (c.aiu as any).regime =
          regimeFromTaxableBasis(basis) ?? 'et_462_1';
        c.taxes.rules = derivedRules(basis) as any;
      });
      expect(
        blockingIssues(
          validateInvoiceProfileConfig(config, { operation_type: '09' }),
        ),
      ).toEqual([]);
    },
  );

  it('base utilidad derivada: taxable sólo en utilidad y 0.00 en el resto', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).taxable_basis = 'utilidad';
      (c.aiu as any).regime = 'decreto_1372_1992';
      c.taxes.rules = derivedRules('utilidad') as any;
    });
    const byBucket = Object.fromEntries(
      config.taxes.rules.map((r) => [r.bucket, r]),
    ) as Record<string, { taxable: boolean; rate: string }>;
    expect(byBucket['utilidad']).toMatchObject({
      taxable: true,
      rate: '19.00',
    });
    for (const bucket of ['administracion', 'imprevistos', 'costo']) {
      expect(byBucket[bucket]).toMatchObject({ taxable: false, rate: '0.00' });
    }
    expect(
      blockingIssues(
        validateInvoiceProfileConfig(config, { operation_type: '09' }),
      ).length,
    ).toBe(0);
  });
});

describe('InvoiceProfileConfig — tarifas', () => {
  it('una tarifa de IVA fuera de la lista de la DIAN se rechaza', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.taxable ? { ...r, rate: '12.00' } : r,
      );
    });
    expect(codes(config)).toContain('TAX_RATE_NOT_IN_DIAN_LIST');
  });

  it('las cuatro tarifas de IVA del anexo pasan', () => {
    for (const rate of ['0.00', '5.00', '16.00', '19.00']) {
      const config = aiuConfig((c) => {
        c.taxes.rules = c.taxes.rules.map((r) =>
          r.taxable ? { ...r, rate } : r,
        );
      });
      expect(codes(config)).toEqual([]);
    }
  });

  it('una tarifa 0 DECLARADA no se confunde con impuesto omitido', () => {
    // Un servicio exento declara su grupo con `cbc:Percent` en cero. Tratarlo
    // como «sin declarar» bloquearía facturas correctas.
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.taxable ? { ...r, rate: '0.00' } : r,
      );
    });
    expect(codes(config)).toEqual([]);
  });

  it('una porción no gravada con tarifa distinta de cero se rechaza', () => {
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.bucket === 'costo' ? { ...r, taxable: false, rate: '19.00' } : r,
      );
    });
    expect(codes(config)).toContain('TAX_RATE_ON_NON_TAXABLE');
  });

  it('INC valida contra su propia lista, no contra la de IVA', () => {
    const withInc = (rate: string) =>
      aiuConfig((c) => {
        c.taxes.rules = c.taxes.rules.map((r) =>
          r.taxable ? { ...r, tax_code: '04', rate } : r,
        );
      });
    expect(codes(withInc('8.00'))).toEqual([]);
    // 5 % es tarifa válida de IVA y NO de INC.
    expect(codes(withInc('5.00'))).toContain('TAX_RATE_NOT_IN_DIAN_LIST');
  });

  it('un tributo sin lista de tarifas publicada no se valida por tarifa', () => {
    // Retefuente se indexa por CONCEPTO, no por porcentaje: una lista de
    // porcentajes sueltos daría falsa seguridad. Ver `dian-tax-codes.ts`.
    const config = aiuConfig((c) => {
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.taxable ? { ...r, tax_code: '06', rate: '3.50' } : r,
      );
    });
    expect(codes(config)).not.toContain('TAX_RATE_NOT_IN_DIAN_LIST');
  });
});

describe('InvoiceProfileConfig — la sección AIU está atada al tipo de operación', () => {
  it('un perfil 09 sin sección AIU se rechaza', () => {
    const config = aiuConfig((c) => {
      c.aiu = null;
    });
    expect(codes(config, '09')).toContain('AIU_SECTION_REQUIRED');
  });

  it('un perfil estándar con sección AIU se rechaza', () => {
    expect(codes(aiuConfig(), '10')).toContain('AIU_SECTION_NOT_APPLICABLE');
  });

  it('un régimen desconocido se rechaza', () => {
    const config = aiuConfig((c) => {
      (c.aiu as any).regime = 'et_999';
    });
    expect(codes(config)).toContain('AIU_REGIME_UNKNOWN');
  });

  it('el objeto del contrato vacío se rechaza: CAV03 lo valida', () => {
    const config = aiuConfig((c) => {
      c.aiu!.contract_object = '   ';
    });
    expect(codes(config)).toContain('AIU_CONTRACT_OBJECT_EMPTY');
  });

  it('la plantilla de impresión vacía es legal: hereda la de la tienda', () => {
    // El caso normal. Un perfil que no opina sobre el diseño NO debe congelar
    // uno: si lo congelara, cambiar la plantilla de la tienda dejaría de
    // afectar a las facturas de ese perfil sin que nadie lo haya pedido.
    const config = aiuConfig((c) => {
      c.format.template_id = null;
    });
    expect(codes(config)).not.toContain('FORMAT_TEMPLATE_ID_INVALID');
  });

  it('una plantilla de impresión que no es un id se rechaza', () => {
    // `template_id` es una FK lógica a `print_templates`. Un 0, un negativo o
    // un decimal no identifican ninguna fila, y guardarlos produciría un perfil
    // que al imprimir cae al fallback en silencio — el operador vería otro
    // diseño y no sabría por qué.
    for (const bad of [0, -3, 1.5, '12']) {
      const config = aiuConfig((c) => {
        (c.format as { template_id?: unknown }).template_id = bad;
      });
      expect(codes(config)).toContain('FORMAT_TEMPLATE_ID_INVALID');
    }
  });

  it('sin resolución preferida el perfil es válido: la elige la factura', () => {
    // El caso normal. Un perfil que no opina sobre el rango deja que la
    // pantalla de emisión aplique su criterio (la vigente más antigua), que es
    // lo que evita dejar vencer numeración autorizada sin usar.
    const config = aiuConfig((c) => {
      c.dian.resolution_id = null;
      c.dian.resolution_number = null;
    });
    expect(codes(config)).not.toContain('DIAN_RESOLUTION_ID_INVALID');
  });

  it('una resolución preferida que no es un id se rechaza', () => {
    for (const bad of [0, -1, 2.5, '7', true]) {
      const config = aiuConfig((c) => {
        (c.dian as { resolution_id?: unknown }).resolution_id = bad;
      });
      expect(codes(config)).toContain('DIAN_RESOLUTION_ID_INVALID');
    }
  });

  it('una resolución preferida VENCIDA se guarda: la vigencia no se juzga acá', () => {
    // El snapshot es inmutable y la numeración autorizada caduca. Si guardar
    // exigiera vigencia, el día que venciera el rango quedaría inguardable un
    // perfil correcto en todo lo demás. Quien decide si sirve es la precarga,
    // con la fecha de hoy y contra las resoluciones de la propia tienda.
    const config = aiuConfig((c) => {
      c.dian.resolution_id = 41;
      c.dian.resolution_number = '18764000000123';
    });
    expect(codes(config)).not.toContain('DIAN_RESOLUTION_ID_INVALID');
  });

  it('el número de la resolución se acota: viaja en el aviso, no al XML', () => {
    const config = aiuConfig((c) => {
      c.dian.resolution_number = 'X'.repeat(61);
    });
    expect(codes(config)).toContain('TEXT_TOO_LONG');
  });
});

describe('InvoiceProfileConfig — retenciones por omisión', () => {
  const rule = (patch: Record<string, unknown> = {}) => ({
    concept_id: 7,
    role: 'practiced' as const,
    rate: '2.50',
    ...patch,
  });

  it('sin retenciones el perfil es válido: no todo cliente retiene', () => {
    expect(codes(aiuConfig())).toEqual([]);
  });

  it('una retención completa pasa', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = { rules: [rule()] };
    });
    expect(codes(config)).toEqual([]);
  });

  it('sin concepto la fila se rechaza: al emitir no se podría resolver', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule({ concept_id: 0 })],
      };
    });
    expect(codes(config)).toContain('WITHHOLDING_CONCEPT_INVALID');
  });

  it('un lado desconocido se rechaza: practicada y sufrida no son lo mismo', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule({ role: 'both' })],
      };
    });
    expect(codes(config)).toContain('WITHHOLDING_ROLE_UNKNOWN');
  });

  /**
   * El contraste con la matriz de impuestos es el punto del test: allí `'0.00'`
   * con `taxable: true` es un servicio exento y es LEGAL. Acá no existe la
   * retención exenta, así que el mismo número tiene que decidirse distinto.
   */
  it('una retención al 0 % se rechaza, aunque un IVA al 0 % sea legal', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule({ rate: '0.00' })],
      };
    });
    expect(codes(config)).toContain('WITHHOLDING_RATE_ZERO');
  });

  it('una tarifa por encima del 100 % se rechaza', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule({ rate: '150.00' })],
      };
    });
    expect(codes(config)).toContain('WITHHOLDING_RATE_OUT_OF_RANGE');
  });

  it('una tarifa con tres decimales se rechaza', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule({ rate: '2.505' })],
      };
    });
    expect(codes(config)).toContain('WITHHOLDING_RATE_INVALID');
  });

  it('el mismo concepto y el mismo lado dos veces se retendría doble', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule(), rule({ rate: '4.00' })],
      };
    });
    expect(codes(config)).toContain('WITHHOLDING_RULE_DUPLICATED');
  });

  it('el mismo concepto en los DOS lados es legítimo y no se marca', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: [rule(), rule({ role: 'suffered' })],
      };
    });
    expect(codes(config)).toEqual([]);
  });

  it('pasado el tope se reporta y no se validan las de más', () => {
    const config = aiuConfig((c) => {
      (c as { withholdings: unknown }).withholdings = {
        rules: Array.from({ length: 21 }, (_, i) => rule({ concept_id: i + 1 })),
      };
    });
    expect(codes(config)).toEqual(['TOO_MANY_ITEMS']);
  });
});

describe('InvoiceProfileConfig — divisa', () => {
  const withCurrency = (currency: unknown) =>
    aiuConfig((c) => {
      (c as { currency: unknown }).currency = currency;
    });

  it('sin divisa el perfil es válido: la factura se emite en pesos', () => {
    expect(codes(withCurrency({ declare_foreign: false, code: null }))).toEqual(
      [],
    );
  });

  it('una divisa declarada con su código pasa', () => {
    expect(
      codes(withCurrency({ declare_foreign: true, code: 'USD' })),
    ).toEqual([]);
  });

  it('declarar conversión sin decir a qué divisa se rechaza', () => {
    expect(codes(withCurrency({ declare_foreign: true, code: '' }))).toContain(
      'CURRENCY_CODE_REQUIRED',
    );
  });

  it('un código que no es ISO 4217 de tres mayúsculas se rechaza', () => {
    expect(codes(withCurrency({ declare_foreign: true, code: 'usd' }))).toContain(
      'CURRENCY_CODE_INVALID',
    );
    expect(
      codes(withCurrency({ declare_foreign: true, code: 'DOLAR' })),
    ).toContain('CURRENCY_CODE_INVALID');
  });

  /** Declararía que un peso vale un peso: pasa la forma y no significa nada. */
  it('COP como divisa alterna se rechaza', () => {
    expect(codes(withCurrency({ declare_foreign: true, code: 'COP' }))).toContain(
      'CURRENCY_CODE_IS_LOCAL',
    );
  });

  it('un código sin declarar conversión no bloquea: queda apagado', () => {
    expect(
      codes(withCurrency({ declare_foreign: false, code: 'EUR' })),
    ).toEqual([]);
  });
});

describe('InvoiceProfileConfig — tipo de documento y precio de la línea', () => {
  it('sin tipo de documento el perfil es válido: manda la venta nacional', () => {
    expect(codes(aiuConfig())).toEqual([]);
  });

  it('los dos tipos del formulario pasan', () => {
    for (const type of ['sales_invoice', 'export_invoice']) {
      const config = aiuConfig((c) => {
        c.dian = { ...c.dian, document_type: type as never };
      });
      expect(codes(config)).toEqual([]);
    }
  });

  it('un tipo que no existe se rechaza: se traduciría a otro documento DIAN', () => {
    const config = aiuConfig((c) => {
      c.dian = { ...c.dian, document_type: 'nota_credito' as never };
    });
    expect(codes(config)).toContain('DIAN_DOCUMENT_TYPE_UNKNOWN');
  });

  const withPrice = (unit_price: unknown) =>
    aiuConfig((c) => {
      (c as { model_lines: unknown }).model_lines = [
        {
          bucket: 'administracion',
          description: 'Servicio mensual',
          unit_code: '94',
          quantity: '1',
          unit_price,
        },
      ];
    });

  it('un precio con hasta seis decimales pasa: el anexo los admite', () => {
    expect(codes(withPrice('1500'))).toEqual([]);
    expect(codes(withPrice('1500.5'))).toEqual([]);
    expect(codes(withPrice('1500.123456'))).toEqual([]);
  });

  it('el precio en blanco es legal: se teclea en cada factura', () => {
    expect(codes(withPrice(''))).toEqual([]);
    expect(codes(withPrice(null))).toEqual([]);
  });

  it('siete decimales, negativo o notación científica se rechazan', () => {
    for (const bad of ['1500.1234567', '-5', '1e3', '1.500,50', 'gratis']) {
      expect(codes(withPrice(bad))).toContain('LINE_UNIT_PRICE_INVALID');
    }
  });

  it('los espacios alrededor no invalidan el precio: el validador recorta', () => {
    // Deliberado, y por eso está escrito: un precio pegado desde una hoja de
    // cálculo llega con espacios. Rechazarlo obligaría a un usuario a mirar un
    // campo que a la vista tiene un número correcto.
    expect(codes(withPrice(' 12 '))).toEqual([]);
  });
});

describe('InvoiceProfileConfig — devuelve TODOS los problemas', () => {
  it('siete errores en un guardado se reportan juntos, no de a uno', () => {
    const config = aiuConfig((c) => {
      c.config_version = 99;
      c.aiu!.components_basis = 'aiu';
      c.aiu!.components = {
        administracion: '1.00',
        imprevistos: '1.00',
        utilidad: '1.00',
      };
      c.aiu!.minimum_base_percent = '2.00';
      c.aiu!.contract_object = '';
      c.taxes.rules = c.taxes.rules.map((r) =>
        r.bucket === 'utilidad' ? { ...r, taxable: false, rate: '19.00' } : r,
      );
      c.format.display_decimals = 99;
    });
    const found = codes(config);
    expect(found).toEqual(
      expect.arrayContaining([
        'CONFIG_VERSION_UNSUPPORTED',
        'AIU_PERCENT_SUM',
        'AIU_FLOOR_BELOW_LEGAL',
        'AIU_CONTRACT_OBJECT_EMPTY',
        'TAX_RATE_ON_NON_TAXABLE',
        'TAX_MATRIX_CONTRADICTS_REGIME',
        'FORMAT_DECIMALS_OUT_OF_RANGE',
      ]),
    );
  });

  it('cada problema nombra la ruta del campo para que el editor lo marque', () => {
    const config = aiuConfig((c) => {
      c.format.display_decimals = -1;
    });
    const issues = validateInvoiceProfileConfig(config, {
      operation_type: '09',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('format.display_decimals');
  });
});

describe('InvoiceProfileConfig — paridad del piso legal', () => {
  /**
   * `AIU_LEGAL_FLOOR_PERCENT_SCALED` duplica el número que
   * `DEFAULT_AIU_MINIMUM_PERCENT` declara como `Prisma.Decimal`. La duplicación
   * es deliberada —este archivo no puede importar Prisma porque lo espeja el
   * frontend— y este test es el candado que impide que las dos divergan.
   *
   * Se lee el fuente en vez de importarlo para no arrastrar el grafo de
   * dependencias de un servicio de Nest a un spec de una función pura; es el
   * mismo mecanismo del spec de paridad de la política de contraseñas.
   */
  it('coincide con DEFAULT_AIU_MINIMUM_PERCENT del calculador', () => {
    const source = readFileSync(
      join(__dirname, '../services/invoice-calculator.service.ts'),
      'utf8',
    );
    const match = source.match(
      /export const DEFAULT_AIU_MINIMUM_PERCENT = new Prisma\.Decimal\((\d+(?:\.\d+)?)\)/,
    );
    expect(match).not.toBeNull();
    expect(Number(match![1]) * 100).toBe(AIU_LEGAL_FLOOR_PERCENT_SCALED);
  });
});

/**
 * El modelo de contabilización, probado POR LA PUERTA REAL.
 *
 * `normalizeAndAssertProfileConfig` es la única entrada a
 * `invoice_profile_versions.config` —la usan las cuatro rutas de escritura de
 * perfil: crear (`profiles.service.ts:420`), editar (`:502`, `:511`) y clonar
 * (`:598`)— y normaliza ANTES de validar. `pickKnownKeys` proyecta sobre la
 * allowlist y BORRA toda clave que no esté en ella, emitiendo un `UNKNOWN_KEY`
 * bloqueante.
 *
 * Por eso estos casos no entran por `validateInvoiceProfileConfig`: eso es
 * exactamente lo que dejó `taxable_basis` inerte al introducirlo —nueve specs
 * verdes contra un objeto que las cuatro rutas rechazaban con 422 nombrando el
 * campo recién creado—. Un campo del contrato sólo está probado si atravesó la
 * puerta y salió con el valor puesto.
 */
describe('InvoiceProfileConfig — accounting_model por la puerta real', () => {
  const opts = { operation_type: '09' };

  // `any` a propósito: el punto de estos casos es mandar lo que un cliente
  // manda de verdad —incluido un valor que el tipo prohíbe— y comprobar que la
  // puerta lo rechaza en vez de que lo haga el compilador del test.
  const configWith = (model?: unknown): unknown => {
    const config: any = JSON.parse(
      JSON.stringify(buildDefaultAiuProfileConfig('Vigilancia sede sur')),
    );
    if (model === undefined) {
      delete config.aiu.accounting_model;
    } else {
      config.aiu.accounting_model = model;
    }
    return config;
  };

  it("'sumada' atraviesa la normalización y sale en el snapshot persistible", () => {
    const saved = normalizeAndAssertProfileConfig(configWith('sumada'), opts);

    // No basta con que no lance: si `accounting_model` faltara en `AIU_KEYS`, la
    // clave se iría en silencio y el `UNKNOWN_KEY` bloquearía el guardado. Se
    // afirma el valor DE SALIDA.
    expect(saved.aiu?.accounting_model).toBe('sumada');
    expect(resolveAccountingModel(saved.aiu)).toBe('sumada');
  });

  it('un snapshot SIN el campo pasa la puerta y se lee como sumada', () => {
    // Es el caso de los perfiles ya guardados: el campo no existía. La ausencia
    // no puede ser un error ni cambiar el comportamiento — `'sumada'` es lo que
    // el calculador hace por construcción.
    const saved = normalizeAndAssertProfileConfig(configWith(undefined), opts);

    expect(saved.aiu?.accounting_model).toBeUndefined();
    expect(resolveAccountingModel(saved.aiu)).toBe('sumada');
  });

  it("'no_sumada' atraviesa la compuerta tras la apertura del Modelo 1 (D.7)", () => {
    // La compuerta humana se levantó el 2026-08-25 con autorización explícita
    // del dueño, con D.6 verde sobre los dos modelos. Por la puerta real: el
    // valor entra, se normaliza y sale en el snapshot persistible.
    const saved = normalizeAndAssertProfileConfig(configWith('no_sumada'), opts);

    expect(saved.aiu?.accounting_model).toBe('no_sumada');
    expect(resolveAccountingModel(saved.aiu)).toBe('no_sumada');
  });

  it('la apertura deja a `no_sumada` SIN razón de deshabilitado', () => {
    // El motivo fechado de la Fase D murió con la compuerta que describía:
    // `accountingModelDisabledReason` devuelve null para todo modelo habilitado,
    // y tras la apertura lo son los dos.
    expect(accountingModelDisabledReason('no_sumada')).toBeNull();
  });

  it('un modelo inventado se distingue del que existe y todavía no se habilita', () => {
    let error: any;
    try {
      normalizeAndAssertProfileConfig(configWith('mitad_y_mitad'), opts);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              field: 'aiu.accounting_model',
              code: 'AIU_ACCOUNTING_MODEL_UNKNOWN',
            }),
          ]),
        }),
      }),
    );
  });

  it('la habilitación sigue siendo UN interruptor, y la apertura (D.7) lo abrió completo', () => {
    // El candado del ADR-7, ahora en su estado abierto: la lista habilitada
    // cubre TODOS los valores del tipo, y ningún modelo tiene razón de
    // deshabilitado. Si alguien vuelve a cerrar el Modelo 1, este test cae y
    // dice por qué.
    expect([...ENABLED_ACCOUNTING_MODELS]).toEqual(['sumada', 'no_sumada']);
    expect([...ACCOUNTING_MODELS]).toEqual(['sumada', 'no_sumada']);
    expect(isAccountingModelEnabled('sumada')).toBe(true);
    expect(isAccountingModelEnabled('no_sumada')).toBe(true);
    expect(accountingModelDisabledReason('sumada')).toBeNull();
    expect(accountingModelDisabledReason('no_sumada')).toBeNull();
  });

  it('la ausencia se resuelve a sumada desde cualquier forma degradada', () => {
    expect(resolveAccountingModel(null)).toBe('sumada');
    expect(resolveAccountingModel(undefined)).toBe('sumada');
    expect(resolveAccountingModel({ accounting_model: null })).toBe('sumada');
    expect(
      resolveAccountingModel({ accounting_model: 'basura' as never }),
    ).toBe('sumada');
    expect(resolveAccountingModel({ accounting_model: 'no_sumada' })).toBe(
      'no_sumada',
    );
  });

  it('el snapshot por omisión declara el modelo explícitamente', () => {
    // Explícito y no ausente: un perfil recién creado no debe depender de un
    // default implícito para decidir la forma del XML.
    expect(
      buildDefaultAiuProfileConfig('Aseo sede norte').aiu?.accounting_model,
    ).toBe('sumada');
  });
});

describe('InvoiceProfileConfig — paridad con el espejo del frontend', () => {
  /**
   * El espejo de Angular es una copia **byte a byte** de este archivo, no una
   * reescritura: el archivo no importa nada, así que la copia literal hace
   * imposible la divergencia parcial —el modo en que estos espejos se rompen de
   * verdad, con un campo añadido en un lado y la validación intacta en el otro.
   *
   * ## PERO NO COMPILA IGUAL EN LOS DOS RUNTIMES
   *
   * El frontend activa `noPropertyAccessFromIndexSignature` (`tsconfig.json` y
   * `tsconfig.app.json`); el backend no. Un acceso `root.general` sobre un tipo
   * indexado compila en el backend y NO en Angular, así que la única notación
   * válida para las dos puntas es la de corchetes: `root['general']`.
   *
   * Esto ya rompió el espejo una vez: alguien arregló la copia del frontend a
   * corchetes para que compilara, y este test quedó en rojo con 23 líneas de
   * diferencia —todas de notación, ninguna de semántica—. La receta que estaba
   * escrita acá, `cp` backend → frontend, habría vuelto a romper el build de
   * Angular. Se corrigió al revés: el backend adoptó la notación de corchetes.
   *
   * Si este test falla, la corrección es copiar, no editar a mano — y en la
   * dirección que preserve los corchetes:
   *   cp apps/backend/src/domains/store/invoicing/profiles/invoice-profile-config.contract.ts \
   *      apps/frontend/src/app/core/utils/invoice-profile-config.contract.ts
   *
   * Antes de copiar, comprobar que el origen no reintrodujo acceso por punto
   * sobre un índice: si lo hizo, el espejo compilará acá y romperá Angular.
   */
  it('el archivo del frontend es idéntico al del backend', () => {
    const backend = readFileSync(
      join(__dirname, 'invoice-profile-config.contract.ts'),
      'utf8',
    );
    const frontend = readFileSync(
      join(
        __dirname,
        '../../../../../../frontend/src/app/core/utils/invoice-profile-config.contract.ts',
      ),
      'utf8',
    );
    expect(frontend).toBe(backend);
  });
});
