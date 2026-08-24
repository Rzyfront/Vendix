import {
  buildDefaultAiuProfileConfig,
  normalizeInvoiceProfileConfig,
  validateInvoiceProfileConfig,
  CONFIG_LIMITS,
  INVOICE_PROFILE_CONFIG_VERSION,
} from './invoice-profile-config.contract';

/** Códigos de los problemas, para afirmar sobre el conjunto y no sobre el orden. */
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe('normalizeInvoiceProfileConfig — proyección estructural', () => {
  it('el snapshot por omisión atraviesa el normalizador sin un solo problema', () => {
    const base = buildDefaultAiuProfileConfig('Obra civil');
    const { config, issues } = normalizeInvoiceProfileConfig(base);

    expect(issues).toEqual([]);
    // Round-trip exacto: si el normalizador cambiara algo del default, cada
    // creación desde plantilla guardaría algo distinto de lo que la plantilla
    // dice, y el editor mostraría un cambio que el usuario no hizo.
    expect(config).toEqual(base);
  });

  it('el default normalizado sigue siendo válido para el validador', () => {
    const { config } = normalizeInvoiceProfileConfig(
      buildDefaultAiuProfileConfig('Obra civil'),
    );
    expect(
      validateInvoiceProfileConfig(config, { operation_type: '09' }),
    ).toEqual([]);
  });

  it('una entrada que no es objeto devuelve cascarón y CONFIG_NOT_OBJECT', () => {
    for (const input of ['texto', 42, true, [], null, undefined]) {
      const { config, issues } = normalizeInvoiceProfileConfig(input);
      expect(codes(issues)).toContain('CONFIG_NOT_OBJECT');
      // El cascarón existe para que el validador pueda correr igual y el
      // frontend reciba UNA sola lista de problemas.
      expect(config.taxes.rules).toEqual([]);
      expect(config.model_lines).toEqual([]);
      expect(config.aiu).toBeNull();
    }
  });

  it('reporta la clave desconocida por nombre y no la guarda', () => {
    const base = buildDefaultAiuProfileConfig('X') as unknown as Record<
      string,
      unknown
    >;
    const { config, issues } = normalizeInvoiceProfileConfig({
      ...base,
      es_predeterminado: true,
      state: 'active',
    });

    expect(codes(issues)).toEqual(['UNKNOWN_KEY', 'UNKNOWN_KEY']);
    expect(fields(issues)).toEqual(['es_predeterminado', 'state']);
    expect(config).not.toHaveProperty('es_predeterminado');
    // `state` es COLUMNA de `invoice_profiles`: aceptarlo dentro del JSON
    // crearía la segunda fuente de verdad que el contrato existe para evitar.
    expect(config).not.toHaveProperty('state');
  });

  it('reporta claves desconocidas anidadas con su ruta completa', () => {
    const base = buildDefaultAiuProfileConfig('X');
    const { config, issues } = normalizeInvoiceProfileConfig({
      ...base,
      aiu: { ...base.aiu, regimen: 'et_462_1', components: { ...base.aiu!.components, otro: '1.00' } },
      taxes: { rules: [{ ...base.taxes.rules[0], nota: 'x' }] },
      dian: { ...base.dian, extra: 1 },
    });

    expect(fields(issues).sort()).toEqual([
      'aiu.components.otro',
      'aiu.regimen',
      'dian.extra',
      'taxes.rules[0].nota',
    ]);
    expect(config.aiu).not.toHaveProperty('regimen');
    expect(config.taxes.rules[0]).not.toHaveProperty('nota');
  });

  it('NO coerciona ni un solo valor: el validador tiene que poder rechazarlo', () => {
    const base = buildDefaultAiuProfileConfig('X');
    const { config } = normalizeInvoiceProfileConfig({
      ...base,
      // Tres decimales: inválido a propósito. Si el normalizador redondeara,
      // el snapshot guardaría 19.00 y la factura se emitiría con una tarifa que
      // el usuario nunca escribió.
      taxes: { rules: [{ bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.000' }] },
    });

    expect(config.taxes.rules[0].rate).toBe('19.000');
    expect(
      codes(validateInvoiceProfileConfig(config, { operation_type: '09' })),
    ).toContain('TAX_RATE_INVALID');
  });

  it('config_version viaja tal cual, incluso si no es un número', () => {
    const base = buildDefaultAiuProfileConfig('X');
    const { config } = normalizeInvoiceProfileConfig({
      ...base,
      config_version: '1',
    });

    // Fijarla al valor del servidor convertiría un frontend desactualizado en un
    // snapshot mal etiquetado, que es peor que un 422.
    expect(config.config_version).toBe('1');
    expect(
      codes(validateInvoiceProfileConfig(config, { operation_type: '09' })),
    ).toContain('CONFIG_VERSION_UNSUPPORTED');
  });

  it('aiu ausente y aiu:null normalizan igual, a null', () => {
    const base = buildDefaultAiuProfileConfig('X');
    const { aiu: _drop, ...withoutAiu } = base;

    expect(normalizeInvoiceProfileConfig(withoutAiu).config.aiu).toBeNull();
    expect(
      normalizeInvoiceProfileConfig({ ...base, aiu: null }).config.aiu,
    ).toBeNull();
    // Y es el validador —no el normalizador— quien decide si faltaba.
    expect(
      codes(
        validateInvoiceProfileConfig(
          normalizeInvoiceProfileConfig(withoutAiu).config,
          { operation_type: '09' },
        ),
      ),
    ).toContain('AIU_SECTION_REQUIRED');
  });

  it('un contenedor con el tipo equivocado se reporta y no revienta el validador', () => {
    const base = buildDefaultAiuProfileConfig('X');
    const { config, issues } = normalizeInvoiceProfileConfig({
      ...base,
      taxes: { rules: 'todas' },
      model_lines: { 0: 'x' },
      general: 'sin descripción',
    });

    expect(codes(issues)).toEqual(
      expect.arrayContaining(['EXPECTED_ARRAY', 'EXPECTED_ARRAY', 'EXPECTED_OBJECT']),
    );
    expect(config.taxes.rules).toEqual([]);
    expect(config.model_lines).toEqual([]);
    // Sin esta garantía el validador hacía `rules.forEach` sobre una cadena y
    // el 422 se convertía en un 500 de `TypeError`.
    expect(() =>
      validateInvoiceProfileConfig(config, { operation_type: '09' }),
    ).not.toThrow();
  });

  it('una entrada del arreglo que no es objeto se reporta con su índice', () => {
    const base = buildDefaultAiuProfileConfig('X');
    const { config, issues } = normalizeInvoiceProfileConfig({
      ...base,
      taxes: { rules: [base.taxes.rules[0], 'imprevistos'] },
    });

    expect(fields(issues)).toContain('taxes.rules[1]');
    expect(codes(issues)).toContain('EXPECTED_OBJECT');
    expect(config.taxes.rules[1]).toEqual({});
  });

  it('`__proto__` se reporta como clave desconocida y no contamina el prototipo', () => {
    const base = buildDefaultAiuProfileConfig('X');
    // JSON.parse crea `__proto__` como propiedad PROPIA, así que `Object.keys`
    // la ve y una copia ingenua (`out[key] = ...`) reemplazaría el prototipo del
    // objeto destino en vez de añadirle una clave.
    const hostile = JSON.parse(
      `{"config_version":1,"__proto__":{"contaminado":true}}`,
    );
    const { config, issues } = normalizeInvoiceProfileConfig({
      ...base,
      ...hostile,
    });

    expect(codes(issues)).toContain('UNKNOWN_KEY');
    expect(({} as Record<string, unknown>).contaminado).toBeUndefined();
    expect(
      (config as unknown as Record<string, unknown>).contaminado,
    ).toBeUndefined();
  });

  it('el normalizador nunca lanza, con cualquier basura anidada', () => {
    const garbage = [
      { taxes: { rules: [null, undefined, 0, [], () => 1] } },
      { aiu: { components: 'A/I/U' } },
      { accounting: { revenue_account_by_bucket: [], mapping_key_overrides: 7 } },
      { dian: { header_notes: 'una nota' } },
      { format: null, general: undefined },
    ];
    for (const input of garbage) {
      expect(() => normalizeInvoiceProfileConfig(input)).not.toThrow();
      const { config } = normalizeInvoiceProfileConfig(input);
      expect(() =>
        validateInvoiceProfileConfig(config, { operation_type: '09' }),
      ).not.toThrow();
      expect(() =>
        validateInvoiceProfileConfig(config, { operation_type: '10' }),
      ).not.toThrow();
    }
  });
});

describe('validateBounds — cotas del snapshot', () => {
  const withAiu = (over: Record<string, unknown> = {}) => ({
    ...buildDefaultAiuProfileConfig('Obra civil'),
    ...over,
  });

  it('una descripción por encima del límite se rechaza nombrando el largo', () => {
    const issues = validateInvoiceProfileConfig(
      withAiu({
        general: { description: 'x'.repeat(CONFIG_LIMITS.description + 1), internal_note: null },
      }) as never,
      { operation_type: '09' },
    );
    const found = issues.find((i) => i.field === 'general.description');
    expect(found?.code).toBe('TEXT_TOO_LONG');
    expect(found?.message).toContain(String(CONFIG_LIMITS.description + 1));
  });

  it('exactamente el límite se acepta', () => {
    const issues = validateInvoiceProfileConfig(
      withAiu({
        general: { description: 'x'.repeat(CONFIG_LIMITS.description), internal_note: null },
      }) as never,
      { operation_type: '09' },
    );
    expect(fields(issues)).not.toContain('general.description');
  });

  it('un campo de texto que llega como número se rechaza en vez de medirse', () => {
    // `.length` de un número es `undefined`, y `undefined > 500` es `false`: sin
    // la comprobación de `typeof` el valor pasaba la cota y se guardaba.
    const issues = validateInvoiceProfileConfig(
      withAiu({ general: { description: 12345, internal_note: null } }) as never,
      { operation_type: '09' },
    );
    expect(
      issues.find((i) => i.field === 'general.description')?.code,
    ).toBe('EXPECTED_STRING');
  });

  it('el objeto del contrato tiene la cota del `cbc:Note`', () => {
    const issues = validateInvoiceProfileConfig(
      buildDefaultAiuProfileConfig('x'.repeat(CONFIG_LIMITS.contract_object + 1)),
      { operation_type: '09' },
    );
    expect(
      issues.find((i) => i.field === 'aiu.contract_object')?.code,
    ).toBe('TEXT_TOO_LONG');
  });

  it('un código de tributo que no son dos dígitos se rechaza', () => {
    for (const tax_code of ['1', '001', 'IVA', '', 1 as never, null as never]) {
      const issues = validateInvoiceProfileConfig(
        withAiu({
          taxes: {
            rules: [{ bucket: 'administracion', taxable: true, tax_code, rate: '19.00' }],
          },
        }) as never,
        { operation_type: '09' },
      );
      expect(codes(issues)).toContain('TAX_CODE_MALFORMED');
    }
  });

  it('«01» y «04» siguen siendo códigos bien formados', () => {
    const issues = validateInvoiceProfileConfig(
      buildDefaultAiuProfileConfig('Obra'),
      { operation_type: '09' },
    );
    expect(codes(issues)).not.toContain('TAX_CODE_MALFORMED');
  });

  it('más notas de cabecera que el tope se rechazan', () => {
    const issues = validateInvoiceProfileConfig(
      withAiu({
        dian: {
          payment_means_code: null,
          payment_method_code: null,
          header_notes: Array.from(
            { length: CONFIG_LIMITS.header_notes_count + 1 },
            (_, i) => `nota ${i}`,
          ),
        },
      }) as never,
      { operation_type: '09' },
    );
    expect(
      issues.find((i) => i.field === 'dian.header_notes')?.code,
    ).toBe('TOO_MANY_ITEMS');
  });

  it('más sobrescrituras de cuenta que el tope se rechazan', () => {
    const overrides: Record<string, string> = {};
    for (let i = 0; i <= CONFIG_LIMITS.mapping_overrides_count; i += 1) {
      overrides[`clave_${i}`] = '413505';
    }
    const issues = validateInvoiceProfileConfig(
      withAiu({
        accounting: {
          revenue_account_by_bucket: null,
          vat_payable_account: null,
          mapping_key_overrides: overrides,
        },
      }) as never,
      { operation_type: '09' },
    );
    expect(
      issues.find((i) => i.field === 'accounting.mapping_key_overrides')?.code,
    ).toBe('TOO_MANY_ITEMS');
  });

  it('un código de cuenta desmedido se rechaza aunque venga en el mapa libre', () => {
    const issues = validateInvoiceProfileConfig(
      withAiu({
        accounting: {
          revenue_account_by_bucket: { administracion: '4'.repeat(CONFIG_LIMITS.account_code + 1) },
          vat_payable_account: null,
          mapping_key_overrides: { venta_aiu: '2'.repeat(CONFIG_LIMITS.account_code + 1) },
        },
      }) as never,
      { operation_type: '09' },
    );
    expect(codes(issues).filter((c) => c === 'TEXT_TOO_LONG')).toHaveLength(2);
  });

  it('las cotas corren también en un perfil estándar (no AIU)', () => {
    // El snapshot de un perfil `10` es el mismo `jsonb` de un registro fiscal:
    // no hay motivo para acotar uno y no el otro.
    const standard = {
      config_version: INVOICE_PROFILE_CONFIG_VERSION,
      general: { description: 'x'.repeat(CONFIG_LIMITS.description + 1), internal_note: null },
      aiu: null,
      accounting: { revenue_account_by_bucket: null, vat_payable_account: null, mapping_key_overrides: null },
      taxes: { rules: [] },
      model_lines: [],
      format: { template_key: null, show_aiu_breakdown: false, display_decimals: 2 },
      dian: { payment_means_code: null, payment_method_code: null, header_notes: null },
      // Las dos secciones nuevas van vacías a propósito: probar que un snapshot
      // SIN retenciones ni divisa sigue siendo válido es justamente lo que
      // demuestra que añadirlas no rompió los perfiles ya guardados.
      withholdings: { rules: [] },
      currency: {},
    };
    expect(
      codes(validateInvoiceProfileConfig(standard, { operation_type: '10' })),
    ).toContain('TEXT_TOO_LONG');
  });
});
