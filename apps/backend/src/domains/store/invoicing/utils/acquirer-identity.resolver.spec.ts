import {
  normalizeAcquirerDocumentType,
  resolveAcquirerPersonType,
  resolveAcquirerIdentity,
  resolveMissingAcquirerDocumentType,
  hasNitShape,
} from './acquirer-identity.resolver';

describe('normalizeAcquirerDocumentType', () => {
  it('acepta el literal interno (NIT) y devuelve literal + código', () => {
    expect(normalizeAcquirerDocumentType('NIT')).toEqual({
      literal: 'NIT',
      code: '31',
    });
  });

  it('acepta el código DIAN de dos dígitos (31) y devuelve literal + código', () => {
    expect(normalizeAcquirerDocumentType('31')).toEqual({
      literal: 'NIT',
      code: '31',
    });
  });

  it('es insensible a mayúsculas/minúsculas y a espacios', () => {
    expect(normalizeAcquirerDocumentType('  nit  ')).toEqual({
      literal: 'NIT',
      code: '31',
    });
  });

  it('CC (13) redondea código↔literal igual que NIT', () => {
    expect(normalizeAcquirerDocumentType('CC')).toEqual({
      literal: 'CC',
      code: '13',
    });
    expect(normalizeAcquirerDocumentType('13')).toEqual({
      literal: 'CC',
      code: '13',
    });
  });

  it('nulo/vacío devuelve ambos null', () => {
    expect(normalizeAcquirerDocumentType(null)).toEqual({
      literal: null,
      code: null,
    });
    expect(normalizeAcquirerDocumentType(undefined)).toEqual({
      literal: null,
      code: null,
    });
    expect(normalizeAcquirerDocumentType('   ')).toEqual({
      literal: null,
      code: null,
    });
  });

  it('un valor irreconocible se conserva tal cual en literal, código null (no se pierde)', () => {
    expect(normalizeAcquirerDocumentType('XX')).toEqual({
      literal: 'XX',
      code: null,
    });
  });
});

describe('resolveAcquirerPersonType', () => {
  it('deriva JURIDICA del código DIAN 31 (NIT) sin person_type explícito', () => {
    const result = resolveAcquirerPersonType(null, '31');
    expect(result.person_type).toBe('JURIDICA');
    expect(result.declared_raw).toBeNull();
  });

  it('deriva NATURAL de cualquier código distinto de 31 sin person_type explícito', () => {
    expect(resolveAcquirerPersonType(null, '13').person_type).toBe('NATURAL');
    expect(resolveAcquirerPersonType(null, null).person_type).toBe('NATURAL');
  });

  it('un person_type explícito y coherente ("1"/"2") gana sobre el código derivado', () => {
    // Código de CC (13, derivaría NATURAL) pero declarado explícitamente jurídica.
    expect(resolveAcquirerPersonType('1', '13').person_type).toBe('JURIDICA');
    // Código de NIT (31, derivaría JURIDICA) pero declarado explícitamente natural.
    expect(resolveAcquirerPersonType('2', '31').person_type).toBe('NATURAL');
  });

  it('acepta los literales JURIDICA/JURÍDICA/NATURAL explícitos', () => {
    expect(resolveAcquirerPersonType('JURIDICA', '13').person_type).toBe(
      'JURIDICA',
    );
    expect(resolveAcquirerPersonType('JURÍDICA', '13').person_type).toBe(
      'JURIDICA',
    );
    expect(resolveAcquirerPersonType('NATURAL', '31').person_type).toBe(
      'NATURAL',
    );
  });

  it('un valor irreconocible cae al derivado por código pero se conserva en declared_raw', () => {
    const result = resolveAcquirerPersonType('garbage', '31');
    expect(result.person_type).toBe('JURIDICA');
    expect(result.declared_raw).toBe('garbage');
  });
});

describe('resolveAcquirerIdentity', () => {
  it('incidente real: factura manual sin customer_id, snapshot NIT/31 con DV y correo', () => {
    // Óptica Panorama SAS — NIT 800214345-7, factura manual de Pollo Árabe.
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_name: 'Óptica Panorama SAS',
        customer_tax_id: '800214345',
        customer_document_type: '31',
        customer_verification_digit: '7',
        customer_email: 'facturacion@opticapanorama.co',
      },
      customer: undefined,
    });

    expect(result.document_type_literal).toBe('NIT');
    expect(result.document_type_code).toBe('31');
    expect(result.document_number).toBe('800214345');
    expect(result.verification_digit).toBe('7');
    expect(result.person_type).toBe('JURIDICA');
    expect(result.email).toBe('facturacion@opticapanorama.co');
    expect(result.name).toBe('Óptica Panorama SAS');
  });

  it('sin customer_id y sin document_type en el snapshot: no inventa nada (null, no CC)', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_name: 'Comprador Sin Tipo',
        customer_tax_id: '800214345',
      },
      customer: undefined,
    });

    expect(result.document_type_literal).toBeNull();
    expect(result.document_type_code).toBeNull();
    // person_type sigue SIEMPRE resuelto (nunca null) — deriva a NATURAL en
    // ausencia de código; es el resolver de más arriba (rail/provider) el que
    // debe bloquear por falta de tipo, no este helper puro.
    expect(result.person_type).toBe('NATURAL');
  });

  it('ficha vinculada (customer_id presente) manda campo a campo sobre el snapshot', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_name: 'Nombre Viejo En Snapshot',
        customer_tax_id: '999999999',
        customer_document_type: 'CC',
        customer_email: 'snapshot@old.example',
      },
      customer: {
        legal_name: 'Óptica Panorama SAS',
        document_type: 'NIT',
        document_number: '800214345',
        verification_digit: '7',
        email: 'ficha@opticapanorama.co',
      },
    });

    expect(result.name).toBe('Óptica Panorama SAS');
    expect(result.document_type_literal).toBe('NIT');
    expect(result.document_type_code).toBe('31');
    expect(result.document_number).toBe('800214345');
    expect(result.verification_digit).toBe('7');
    expect(result.email).toBe('ficha@opticapanorama.co');
  });

  it('ficha vinculada con campos ausentes hace backfill campo a campo desde el snapshot', () => {
    // La ficha trae nombre y documento pero NO trae correo/teléfono: deben
    // completarse desde el snapshot de la factura, no perderse.
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_email: 'snapshot@fallback.example',
        customer_phone: '3000000000',
        customer_tax_regime: 'RESPONSABLE',
      },
      customer: {
        legal_name: 'Óptica Panorama SAS',
        document_type: 'NIT',
        document_number: '800214345',
        verification_digit: '7',
      },
    });

    expect(result.email).toBe('snapshot@fallback.example');
    expect(result.phone).toBe('3000000000');
    expect(result.tax_regime).toBe('RESPONSABLE');
    expect(result.document_number).toBe('800214345');
  });

  it('consumidor final (sin ficha, snapshot sentinel) no queda afectado: person_type deriva NATURAL', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_name: 'Consumidor Final',
        customer_tax_id: '222222222222',
        customer_document_type: '13',
      },
      customer: undefined,
    });

    expect(result.document_type_code).toBe('13');
    expect(result.person_type).toBe('NATURAL');
    expect(result.document_number).toBe('222222222222');
  });

  it('tax_responsibilities: ficha gana sobre snapshot, y snapshot respalda si la ficha no trae nada', () => {
    const withCustomerList = resolveAcquirerIdentity({
      snapshot: { customer_fiscal_responsibilities: ['O-13'] },
      customer: { fiscal_responsibilities: ['O-48'] },
    });
    expect(withCustomerList.tax_responsibilities).toEqual(['O-48']);

    const fallbackToSnapshot = resolveAcquirerIdentity({
      snapshot: { customer_fiscal_responsibilities: ['O-48'] },
      customer: { legal_name: 'Sin lista propia' },
    });
    expect(fallbackToSnapshot.tax_responsibilities).toEqual(['O-48']);
  });

  it('person_type_raw preserva el valor declarado crudo (para diagnósticos), aun cuando person_type ya viene derivado', () => {
    const result = resolveAcquirerIdentity({
      snapshot: { customer_document_type: '31' },
      customer: { person_type: 'garbage-value' },
    });

    expect(result.person_type).toBe('JURIDICA'); // derivado por código 31
    expect(result.person_type_raw).toBe('garbage-value'); // crudo, sin perder
  });

  // Task D — MARIA BEATRIZ FERNANDEZ (NIT 27003183-1), factura manual sin
  // customer_id: sin el respaldo del snapshot, el default (código 31 ⇒
  // JURIDICA) la resolvía como persona jurídica.
  it('Task D: factura manual (sin ficha) con NIT y customer_person_type=NATURAL en el snapshot NO deriva JURIDICA', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_name: 'MARIA BEATRIZ FERNANDEZ',
        customer_tax_id: '27003183',
        customer_document_type: '31',
        customer_verification_digit: '1',
        customer_person_type: 'NATURAL',
      },
      customer: undefined,
    });

    expect(result.person_type).toBe('NATURAL');
    expect(result.person_type_raw).toBe('NATURAL');
  });

  it('Task D: sin ficha, sin customer_person_type en el snapshot, sigue derivando JURIDICA del código 31 (comportamiento previo intacto)', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_tax_id: '800214345',
        customer_document_type: '31',
      },
      customer: undefined,
    });

    expect(result.person_type).toBe('JURIDICA');
    expect(result.person_type_raw).toBeNull();
  });

  it('Task D: person_type de la ficha vinculada gana sobre customer_person_type del snapshot', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {
        customer_document_type: '31',
        customer_person_type: 'JURIDICA',
      },
      customer: { person_type: 'NATURAL' },
    });

    expect(result.person_type).toBe('NATURAL');
    expect(result.person_type_raw).toBe('NATURAL');
  });

  it('Task D: customer_person_type del snapshot respalda cuando la ficha vinculada no declara person_type', () => {
    const result = resolveAcquirerIdentity({
      snapshot: { customer_document_type: '31', customer_person_type: 'NATURAL' },
      customer: { legal_name: 'Sin person_type propio' },
    });

    expect(result.person_type).toBe('NATURAL');
    expect(result.person_type_raw).toBe('NATURAL');
  });

  // P1-B — ficha antigua sin document_type, sin señal de riesgo: infiere CC.
  it('ficha con document_type NULL, número SIN forma de NIT y sin legal_name/person_type ⇒ infiere CC (no bloquea)', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {},
      customer: {
        id: 4242,
        document_number: '1118860776',
        first_name: 'Juan',
        last_name: 'Pérez',
      },
    });

    expect(result.document_type_literal).toBe('CC');
    expect(result.document_type_code).toBe('13');
    expect(result.document_number).toBe('1118860776');
  });

  it('ficha con document_type NULL, número CON forma de NIT ⇒ NO infiere, queda null (bloqueo aguas arriba)', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {},
      customer: {
        id: 99,
        document_number: '900123456',
        first_name: 'Juan',
        last_name: 'Pérez',
      },
    });

    expect(result.document_type_literal).toBeNull();
    expect(result.document_type_code).toBeNull();
  });

  it('ficha con document_type NULL, número plano pero legal_name presente ⇒ NO infiere, queda null (señal jurídica)', () => {
    const result = resolveAcquirerIdentity({
      snapshot: {},
      customer: {
        id: 100,
        document_number: '1118860776',
        legal_name: 'Comercializadora ACME SAS',
      },
    });

    expect(result.document_type_literal).toBeNull();
  });

  // P1-B — `''` cuenta como AUSENTE en el respaldo ficha→snapshot, no como
  // valor declarado que le gane al snapshot.
  it("ficha con document_type en '' (no NULL) NO le gana al snapshot: cae al respaldo real", () => {
    const result = resolveAcquirerIdentity({
      snapshot: { customer_document_type: 'NIT' },
      customer: {
        document_type: '',
        document_number: '800214345',
      },
    });

    expect(result.document_type_literal).toBe('NIT');
    expect(result.document_type_code).toBe('31');
  });

  it("ficha con email en '' (no NULL) NO le gana al snapshot: cae al correo real", () => {
    const result = resolveAcquirerIdentity({
      snapshot: { customer_email: 'snapshot@fallback.example' },
      customer: { email: '' },
    });

    expect(result.email).toBe('snapshot@fallback.example');
  });
});

describe('hasNitShape', () => {
  it('9 dígitos que empiezan en 8 o 9 tienen forma de NIT', () => {
    expect(hasNitShape('800214345')).toBe(true);
    expect(hasNitShape('900123456')).toBe(true);
  });

  it('cédulas típicas (menos de 9 dígitos, o que no empiezan en 8/9) no tienen forma de NIT', () => {
    expect(hasNitShape('1118860776')).toBe(false); // 10 dígitos
    expect(hasNitShape('700123456')).toBe(false); // empieza en 7
    expect(hasNitShape('12345678')).toBe(false); // 8 dígitos
  });

  it('acepta el número con puntos/guiones (sólo compara dígitos)', () => {
    expect(hasNitShape('800.214.345')).toBe(true);
  });

  it('null/undefined/vacío no tienen forma de NIT', () => {
    expect(hasNitShape(null)).toBe(false);
    expect(hasNitShape(undefined)).toBe(false);
    expect(hasNitShape('')).toBe(false);
  });
});

describe('resolveMissingAcquirerDocumentType', () => {
  it('sin ninguna señal de riesgo ⇒ infiere CC', () => {
    const result = resolveMissingAcquirerDocumentType({
      document_number: '1118860776',
    });
    expect(result.should_block).toBe(false);
    expect(result.inferred_document_type).toBe('CC');
  });

  it('person_type JURIDICA ⇒ bloquea', () => {
    const result = resolveMissingAcquirerDocumentType({
      document_number: '1118860776',
      person_type: 'JURIDICA',
    });
    expect(result.should_block).toBe(true);
    expect(result.inferred_document_type).toBeNull();
  });

  it("person_type crudo '1' (código DIAN de persona jurídica) ⇒ bloquea", () => {
    const result = resolveMissingAcquirerDocumentType({
      document_number: '1118860776',
      person_type: '1',
    });
    expect(result.should_block).toBe(true);
  });

  it('legal_name con contenido ⇒ bloquea aunque el número no tenga forma de NIT', () => {
    const result = resolveMissingAcquirerDocumentType({
      document_number: '1118860776',
      legal_name: 'Comercializadora ACME SAS',
    });
    expect(result.should_block).toBe(true);
  });

  it('número con forma de NIT ⇒ bloquea aunque no haya legal_name ni person_type', () => {
    const result = resolveMissingAcquirerDocumentType({
      document_number: '900123456',
    });
    expect(result.should_block).toBe(true);
  });
});
