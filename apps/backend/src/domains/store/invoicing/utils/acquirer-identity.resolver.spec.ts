import {
  normalizeAcquirerDocumentType,
  resolveAcquirerPersonType,
  resolveAcquirerIdentity,
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
});
