import { readFileSync } from 'fs';
import { join } from 'path';

import {
  AIU_LEGAL_FLOOR_PERCENT_SCALED,
  INVOICE_PROFILE_CONFIG_VERSION,
  InvoiceProfileConfig,
  buildDefaultAiuProfileConfig,
  formatPercentScaled,
  parsePercentScaled,
  validateInvoiceProfileConfig,
} from './invoice-profile-config.contract';

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
});

describe('InvoiceProfileConfig — devuelve TODOS los problemas', () => {
  it('siete errores en un guardado se reportan juntos, no de a uno', () => {
    const config = aiuConfig((c) => {
      c.config_version = 99;
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
