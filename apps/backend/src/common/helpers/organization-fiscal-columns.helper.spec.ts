import {
  buildOrganizationFiscalColumns,
  buildTenantFiscalColumns,
  buildStoreFiscalColumns,
  mergeFiscalData,
} from './organization-fiscal-columns.helper';

describe('mergeFiscalData', () => {
  it('es una fusión superficial: el payload sobrescribe claves de existing', () => {
    const merged = mergeFiscalData(
      { nit: '900123456', legal_name: 'Anterior', tax_responsibilities: ['O-13'] },
      { legal_name: 'Nueva Razón Social' },
    );

    expect(merged).toEqual({
      nit: '900123456',
      legal_name: 'Nueva Razón Social',
      tax_responsibilities: ['O-13'],
    });
  });

  it('SOBRESCRIBE arrays, no los concatena (tax_responsibilities)', () => {
    // Decisión explícita del plan §"Approach Chosen": superficial para que
    // `tax_responsibilities` se reemplace, no se concatene. Corregir 'O-13,O-48'
    // a 'O-13' debe dejar 'O-13' nada más.
    const merged = mergeFiscalData(
      { tax_responsibilities: ['O-13', 'O-48'] },
      { tax_responsibilities: ['O-13'] },
    );

    expect(merged.tax_responsibilities).toEqual(['O-13']);
  });

  it('añade claves que no existían', () => {
    const merged = mergeFiscalData(
      { nit: '900123456' },
      { municipality_code: '11001' },
    );

    expect(merged).toEqual({ nit: '900123456', municipality_code: '11001' });
  });
});

describe('buildTenantFiscalColumns', () => {
  it('enruta a OrganizationFiscalColumns cuando scope=organization', () => {
    const cols = buildTenantFiscalColumns(
      'organization',
      { nit: '902056589', nit_type: 'NIT', person_type: 'JURIDICA' },
      { tax_responsibilities: ['O-13'] },
    ) as Record<string, unknown>;

    expect(cols.tax_id).toBe('902056589');
    expect(cols.verification_digit).toBe('9');
    expect(cols.document_type).toBe('31');
    expect(cols.person_type).toBe('1');
    // NO debe traer columnas exclusivas de tienda:
    expect('municipality_code' in cols).toBe(false);
    expect('tax_id_dv' in cols).toBe(false);
    expect('nit_type' in cols).toBe(false);
  });

  it('enruta a StoreFiscalColumns cuando scope=store', () => {
    const cols = buildTenantFiscalColumns(
      'store',
      {
        nit: '902056589',
        nit_type: 'NIT',
        municipality_code: '11001',
        ciiu_code: '6201',
      },
      { tax_responsibilities: ['O-13'] },
    ) as Record<string, unknown>;

    expect(cols.tax_id).toBe('902056589');
    expect(cols.tax_id_dv).toBe('9');
    expect(cols.nit_type).toBe('NIT');
    expect(cols.municipality_code).toBe('11001');
    // NO debe traer columnas exclusivas de organización:
    expect('verification_digit' in cols).toBe(false);
    expect('document_type' in cols).toBe(false);
  });

  it('produce estado idéntico por el mismo payload entre los dos alcances cuando las columnas se solapan', () => {
    // El mismo NIT + legal_name produce columnas homólogas (tax_id, legal_name)
    // en ambos alcances. `fiscal_responsibilities` y `tax_regime` viven SÓLO en
    // `organizations` (no son columnas de `stores`), así que el alcance tienda
    // no las emite — no entran en la comparación de "estado idéntico". Ver
    // QUI-681 para el motivo.
    const org = buildTenantFiscalColumns(
      'organization',
      {
        nit: '902056589',
        nit_type: 'NIT',
        legal_name: 'QUICKSS S.A.S.',
        tax_responsibilities: ['O-13'],
      },
      { tax_responsibilities: ['O-13'] },
    ) as Record<string, unknown>;
    const store = buildTenantFiscalColumns(
      'store',
      {
        nit: '902056589',
        nit_type: 'NIT',
        legal_name: 'QUICKSS S.A.S.',
        tax_responsibilities: ['O-13'],
      },
      { tax_responsibilities: ['O-13'] },
    ) as Record<string, unknown>;

    for (const sharedKey of ['tax_id', 'legal_name']) {
      expect(org[sharedKey]).toEqual(store[sharedKey]);
    }
    // Y explícitamente: la tienda no emite las columnas exclusivas de org.
    expect('fiscal_responsibilities' in store).toBe(false);
    expect('tax_regime' in store).toBe(false);
    // La org sí las emite.
    expect('fiscal_responsibilities' in org).toBe(true);
    expect('tax_regime' in org).toBe(true);
  });
});

describe('buildStoreFiscalColumns', () => {
  it('proyecta municipality_code (que la organización no tiene)', () => {
    const cols = buildStoreFiscalColumns(
      { municipality_code: '44847' },
      {},
    );

    expect(cols.municipality_code).toBe('44847');
  });

  it('deriva tax_id_dv del NIT cuando nit_type=NIT o ausente', () => {
    const fromNit = buildStoreFiscalColumns({ nit: '902056589' }, {});
    expect(fromNit.tax_id).toBe('902056589');
    expect(fromNit.tax_id_dv).toBe('9');

    const explicitNit = buildStoreFiscalColumns(
      { nit: '902056589', nit_type: 'NIT' },
      {},
    );
    expect(explicitNit.tax_id_dv).toBe('9');
  });

  it('no inventa DV para documentos que no son NIT', () => {
    const cols = buildStoreFiscalColumns(
      { nit: '1085123456', nit_type: 'CC' },
      {},
    );
    expect(cols.tax_id).toBe('1085123456');
    expect(cols.tax_id_dv).toBeNull();
  });

  it('conserva letras en NIT_EXTRANJERIA sin saneado de dígitos', () => {
    const cols = buildStoreFiscalColumns(
      { nit: 'ES-B12345678', nit_type: 'NIT_EXTRANJERIA' },
      {},
    );
    expect(cols.tax_id).toBe('ES-B12345678');
    expect(cols.tax_id_dv).toBeNull();
  });

  // Regresión QUI-681: el PATCH del wizard fiscal tira 500 porque la tabla
  // `stores` no tiene `fiscal_responsibilities` ni `tax_regime` (viven sólo en
  // `organizations`/`users`/`suppliers`). La rama vieja los emitía igual y
  // Prisma 7 rechazaba con "Unknown argument", convertido en 500 por el
  // AllExceptionsFilter. Los datos siguen llegando a `fiscal_data` por la vía
  // del upsert de `store_settings.settings`, así que la pérdida es sólo en la
  // duplicación a columnas — que era el bug.
  it('no proyecta fiscal_responsibilities ni tax_regime (no son columnas de stores)', () => {
    const cols = buildStoreFiscalColumns(
      {
        legal_name: 'TEST S.A.S',
        nit: '234234242',
        nit_type: 'NIT',
        tax_responsibilities: ['R-99-PN'],
        tax_regime: 'COMUN',
      },
      {
        tax_responsibilities: ['R-99-PN'],
        tax_regime: 'COMUN',
      },
    );

    expect('fiscal_responsibilities' in cols).toBe(false);
    expect('tax_regime' in cols).toBe(false);
    // Las columnas que SÍ son de `stores` se siguen emitiendo:
    expect(cols.legal_name).toBe('TEST S.A.S');
    expect(cols.tax_id).toBe('234234242');
    expect(cols.tax_id_dv).toBeDefined();
    expect(cols.nit_type).toBe('NIT');
  });

  it('el dispatcher con scope=store no produce esas columnas aunque el patch las traiga', () => {
    const cols = buildTenantFiscalColumns(
      'store',
      { nit: '900123456', tax_responsibilities: ['O-13'] },
      { tax_responsibilities: ['O-13'] },
    );

    expect('fiscal_responsibilities' in cols).toBe(false);
    expect('tax_regime' in cols).toBe(false);
  });
});

describe('buildOrganizationFiscalColumns', () => {
  describe('semántica PATCH', () => {
    it('no devuelve columnas cuando el patch no trae ningún campo fiscal', () => {
      expect(buildOrganizationFiscalColumns({ branding: {} }, {})).toEqual({});
    });

    it('un patch con solo legal_name no toca el NIT', () => {
      const columns = buildOrganizationFiscalColumns(
        { legal_name: 'QUICKSS S.A.S.' },
        {},
      );
      expect(columns).toEqual({ legal_name: 'QUICKSS S.A.S.' });
      expect('tax_id' in columns).toBe(false);
      expect('verification_digit' in columns).toBe(false);
    });

    it('un campo presente pero vacío se guarda como null, no se ignora', () => {
      expect(buildOrganizationFiscalColumns({ legal_name: '   ' }, {})).toEqual({
        legal_name: null,
      });
    });
  });

  describe('traducción de vocabulario', () => {
    it('mapea nit_type a su código DIAN', () => {
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'NIT' }, {}).document_type,
      ).toBe('31');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'CC' }, {}).document_type,
      ).toBe('13');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'CE' }, {}).document_type,
      ).toBe('22');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'TI' }, {}).document_type,
      ).toBe('12');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'PP' }, {}).document_type,
      ).toBe('41');
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'NIT_EXTRANJERIA' }, {})
          .document_type,
      ).toBe('50');
    });

    it('un nit_type desconocido se guarda como null en vez de propagarse crudo', () => {
      expect(
        buildOrganizationFiscalColumns({ nit_type: 'INVENTADO' }, {})
          .document_type,
      ).toBeNull();
    });

    it('mapea person_type a cbc:AdditionalAccountID', () => {
      expect(
        buildOrganizationFiscalColumns({ person_type: 'JURIDICA' }, {})
          .person_type,
      ).toBe('1');
      expect(
        buildOrganizationFiscalColumns({ person_type: 'NATURAL' }, {})
          .person_type,
      ).toBe('2');
    });

    it('nunca escribe la etiqueta del formulario en la columna', () => {
      const columns = buildOrganizationFiscalColumns(
        { person_type: 'JURIDICA', nit_type: 'NIT' },
        {},
      );
      expect(columns.person_type).not.toBe('JURIDICA');
      expect(columns.document_type).not.toBe('NIT');
    });
  });

  describe('dígito de verificación', () => {
    it('lo deriva del NIT y no lo copia del patch', () => {
      // 902056589 → 9 (módulo 11). El patch miente a propósito con un 3.
      const columns = buildOrganizationFiscalColumns(
        { nit: '902056589', nit_dv: '3' },
        {},
      );
      expect(columns.tax_id).toBe('902056589');
      expect(columns.verification_digit).toBe('9');
    });

    it('acepta el alias tax_id además de nit', () => {
      expect(
        buildOrganizationFiscalColumns({ tax_id: '900123456' }, {}).tax_id,
      ).toBe('900123456');
    });

    it('separa el DV cuando el NIT llega con el guion pegado', () => {
      // Regresión: `computeNitDv('902056589-9')` incluye el propio DV como
      // dígito del módulo 11 y devuelve '1'. Debe derivarse desde la cabecera.
      const columns = buildOrganizationFiscalColumns(
        { nit: '902056589-9' },
        {},
      );
      expect(columns.tax_id).toBe('902056589');
      expect(columns.verification_digit).toBe('9');
    });

    it('limpia puntos y guiones del NIT antes de guardarlo', () => {
      const columns = buildOrganizationFiscalColumns(
        { nit: '902.056.589-9' },
        {},
      );
      expect(columns.tax_id).toBe('902056589');
      expect(columns.verification_digit).toBe('9');
    });

    it('conserva letras en documentos extranjeros en vez de saneárselas', () => {
      const columns = buildOrganizationFiscalColumns(
        { nit_type: 'NIT_EXTRANJERIA', nit: 'ES-B12345678' },
        {},
      );
      expect(columns.tax_id).toBe('ES-B12345678');
      expect(columns.verification_digit).toBeNull();
    });

    it('no inventa DV para documentos que no son NIT', () => {
      const columns = buildOrganizationFiscalColumns(
        { nit_type: 'CC', nit: '1085123456' },
        {},
      );
      expect(columns.verification_digit).toBeNull();
    });

    it('asume NIT cuando el patch trae documento sin declarar el tipo', () => {
      const columns = buildOrganizationFiscalColumns({ nit: '902056589' }, {});
      expect(columns.verification_digit).toBe('9');
    });

    it('limpia el DV cuando se borra el NIT', () => {
      const columns = buildOrganizationFiscalColumns({ nit: '' }, {});
      expect(columns.tax_id).toBeNull();
      expect(columns.verification_digit).toBeNull();
    });
  });

  describe('responsabilidades y régimen', () => {
    it('copia las responsabilidades tal cual (mismo vocabulario O-)', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-48', 'O-13'] },
        { tax_responsibilities: ['O-48', 'O-13'] },
      );
      expect(columns.fiscal_responsibilities).toEqual(['O-48', 'O-13']);
    });

    it('descarta entradas no-string sin romper', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-48', 42, null] },
        { tax_responsibilities: ['O-48'] },
      );
      expect(columns.fiscal_responsibilities).toEqual(['O-48']);
    });

    it('deriva tax_regime 48 para responsable de IVA', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-48'] },
        { tax_responsibilities: ['O-48'] },
      );
      expect(columns.tax_regime).toBe('48');
    });

    it('deriva tax_regime 49 para no responsable de IVA', () => {
      const columns = buildOrganizationFiscalColumns(
        { tax_responsibilities: ['O-49'] },
        { tax_responsibilities: ['O-49'] },
      );
      expect(columns.tax_regime).toBe('49');
    });

    it('usa el fiscal_data mergeado, no solo el patch, para resolver el régimen', () => {
      // El patch solo cambia el régimen; las responsabilidades vienen de antes.
      const columns = buildOrganizationFiscalColumns(
        { tax_regime: 'SIMPLIFICADO' },
        { tax_responsibilities: ['O-48'], tax_regime: 'SIMPLIFICADO' },
      );
      expect(columns.tax_regime).toBe('48');
    });

    it('no toca tax_regime cuando el patch no habla de impuestos', () => {
      const columns = buildOrganizationFiscalColumns(
        { legal_name: 'QUICKSS S.A.S.' },
        { tax_responsibilities: ['O-48'] },
      );
      expect('tax_regime' in columns).toBe(false);
    });
  });

  it('traduce un RUT completo de una sola pasada', () => {
    const merged = {
      tax_responsibilities: ['O-48'],
      tax_regime: 'COMUN',
    };
    const columns = buildOrganizationFiscalColumns(
      {
        legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
        nit: '902056589',
        nit_type: 'NIT',
        person_type: 'JURIDICA',
        tax_responsibilities: ['O-48'],
        ciiu_code: '6201',
      },
      merged,
    );

    expect(columns).toEqual({
      legal_name: 'QUICKSS S.A.S. SOLUCIONES RÁPIDAS DE SOFTWARE',
      tax_id: '902056589',
      verification_digit: '9',
      document_type: '31',
      person_type: '1',
      tax_regime: '48',
      fiscal_responsibilities: ['O-48'],
      ciiu_code: '6201',
    });
  });
});
