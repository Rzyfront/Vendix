import {
  dian_configuration_type_enum,
  fiscal_document_type_enum,
  invoice_type_enum,
} from '@prisma/client';
import {
  DIAN_CONFIGURATION_TYPES,
  FISCAL_DOCUMENT_REQUIREMENTS,
  FISCAL_DOCUMENT_TYPES,
  FiscalDocumentType,
  acceptsTechnicalKey,
  configurationTypeFor,
  defaultDocumentTypeFor,
  documentTypesFor,
  internalSeriesPrefixFor,
  isFiscalDocumentType,
  isSupportDocumentType,
  requirementsFor,
  requiresAuthorizedRange,
  toFiscalDocumentType,
  validateResolutionDraft,
} from './fiscal-document-requirements';

/**
 * Implementaciones LEGADO, copiadas literalmente de sus originales privados. Son
 * el oráculo del test: el contrato sustituye a estas funciones, así que tiene que
 * responder lo mismo que ellas para todo `invoice_type_enum`. Si alguien cambia
 * el contrato y no el legado (o al revés), aquí se ve.
 *
 * Origen: `InvoicingService.toFiscalDocumentType` e
 * `InvoicingService.isSupportDocumentType` en `invoicing.service.ts`.
 */
function legacyToFiscalDocumentType(invoice_type: string) {
  if (invoice_type === 'purchase_invoice') return 'support_document';
  if (invoice_type === 'export_invoice') return 'sales_invoice';
  return invoice_type as
    | 'sales_invoice'
    | 'credit_note'
    | 'debit_note'
    | 'support_document'
    | 'support_adjustment_note';
}

function legacyIsSupportDocumentType(invoice_type: string): boolean {
  return (
    invoice_type === 'purchase_invoice' ||
    invoice_type === 'support_document' ||
    invoice_type === 'support_adjustment_note'
  );
}

/**
 * Réplica de `FiscalProductionReadinessService.defaultDocumentType`, mismo papel
 * de oráculo: el contrato viene a sustituirla.
 */
function legacyDefaultDocumentType(configuration_type: string) {
  if (configuration_type === 'support_document') return 'support_document';
  if (configuration_type === 'payroll') return 'payroll';
  if (configuration_type === 'equivalent_document') {
    return 'pos_equivalent_document';
  }
  return 'sales_invoice';
}

describe('fiscal-document-requirements', () => {
  describe('cobertura del enum', () => {
    /**
     * Lista LITERAL, no derivada del contrato: si se derivara, un tipo que
     * faltara en la tabla también faltaría en la lista y el test pasaría sin
     * comprobar nada.
     */
    const EXPECTED_DOCUMENT_TYPES = [
      'sales_invoice',
      'credit_note',
      'debit_note',
      'support_document',
      'support_adjustment_note',
      'payroll',
      'payroll_adjustment',
      'pos_equivalent_document',
      'equivalent_adjustment_note',
    ];

    it('declara exactamente los 9 tipos esperados', () => {
      expect(Object.keys(FISCAL_DOCUMENT_REQUIREMENTS).sort()).toEqual(
        [...EXPECTED_DOCUMENT_TYPES].sort(),
      );
      expect([...FISCAL_DOCUMENT_TYPES]).toEqual(EXPECTED_DOCUMENT_TYPES);
    });

    /**
     * El guardia de verdad: se compara contra el enum GENERADO por Prisma, no
     * contra una copia. Añadir un valor a `fiscal_document_type_enum` sin
     * declarar sus requisitos rompe aquí (y, por el `Record<>`, ya habría roto
     * la compilación).
     */
    it('cubre todo fiscal_document_type_enum de Prisma, sin sobras', () => {
      expect(Object.keys(FISCAL_DOCUMENT_REQUIREMENTS).sort()).toEqual(
        Object.values(fiscal_document_type_enum).sort(),
      );
    });

    it('cubre todo dian_configuration_type_enum de Prisma', () => {
      expect([...DIAN_CONFIGURATION_TYPES].sort()).toEqual(
        Object.values(dian_configuration_type_enum).sort(),
      );
    });

    it('cada entrada se identifica a sí misma bajo su clave', () => {
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        expect(FISCAL_DOCUMENT_REQUIREMENTS[document_type].document_type).toBe(
          document_type,
        );
      }
    });

    it('cada entrada trae un rótulo no vacío para la UI', () => {
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        expect(
          FISCAL_DOCUMENT_REQUIREMENTS[document_type].label.trim().length,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe('clave técnica', () => {
    it('sales_invoice es el ÚNICO que acepta clave técnica', () => {
      const accepting = FISCAL_DOCUMENT_TYPES.filter((document_type) =>
        acceptsTechnicalKey(document_type),
      );
      expect(accepting).toEqual(['sales_invoice']);
    });

    it('solo la factura de venta arma un CUFE; el resto no usa ClTec', () => {
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        const requirements = requirementsFor(document_type);
        expect(requirements.key_algorithm === 'CUFE').toBe(
          requirements.accepts_technical_key,
        );
      }
    });

    it('asigna a cada documento el algoritmo de clave que emite su proveedor', () => {
      const expected: Record<FiscalDocumentType, string> = {
        sales_invoice: 'CUFE',
        credit_note: 'CUDE',
        debit_note: 'CUDE',
        support_document: 'CUDS',
        support_adjustment_note: 'CUDS',
        payroll: 'CUNE',
        payroll_adjustment: 'CUNE',
        pos_equivalent_document: 'CUDE',
        equivalent_adjustment_note: 'CUDE',
      };
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        expect(requirementsFor(document_type).key_algorithm).toBe(
          expected[document_type],
        );
      }
    });
  });

  describe('autorización de numeración', () => {
    it('solo factura de venta, documento soporte y documento equivalente POS exigen rango autorizado', () => {
      const requiring = FISCAL_DOCUMENT_TYPES.filter((document_type) =>
        requiresAuthorizedRange(document_type),
      );
      expect([...requiring].sort()).toEqual(
        ['pos_equivalent_document', 'sales_invoice', 'support_document'].sort(),
      );
    });

    /**
     * EL INVARIANTE QUE PROTEGE LA NUMERACIÓN AUTORIZADA.
     *
     * `internal_series_prefix` es lo único que autoriza a `generateNextNumber` a
     * crear una fila de `invoice_resolutions` y a ampliarle el rango. Dárselo a
     * un documento con Autorización de Numeración haría que el sistema fabricara
     * consecutivos fuera de la autorización: la DIAN los rechaza uno por uno y
     * cada rechazo quema un número que no se recupera.
     *
     * Se comprueba como implicación en un solo sentido —autorizado ⇒ sin
     * prefijo— y no como equivalencia, porque el recíproco es falso a propósito:
     * `payroll` y `payroll_adjustment` tampoco exigen rango autorizado y aun así
     * van sin prefijo, ya que no numeran contra `invoice_resolutions` en
     * absoluto.
     */
    it('ningún documento con rango autorizado por la DIAN admite serie interna', () => {
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        if (!requiresAuthorizedRange(document_type)) continue;
        expect(internalSeriesPrefixFor(document_type)).toBeNull();
      }
    });

    it('la serie interna la abren exactamente las cuatro notas de ajuste', () => {
      const withSeries = FISCAL_DOCUMENT_TYPES.filter(
        (document_type) => internalSeriesPrefixFor(document_type) !== null,
      );
      expect([...withSeries].sort()).toEqual(
        [
          'credit_note',
          'debit_note',
          'equivalent_adjustment_note',
          'support_adjustment_note',
        ].sort(),
      );
    });

    it('dos documentos no comparten prefijo de serie interna', () => {
      const prefixes = FISCAL_DOCUMENT_TYPES.map((document_type) =>
        internalSeriesPrefixFor(document_type),
      ).filter((prefix): prefix is string => prefix !== null);
      // Compartirlo emitiría `NC1` dos veces bajo el mismo NIT: cada tipo lleva
      // su propio cursor, y el número que se imprime es `prefijo + cursor`.
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });

    /**
     * `payroll` fuera del rango no es un olvido: el DSPNE numera con su propio
     * consecutivo NumNE y `FiscalProductionReadinessService` lo excluye de
     * `assertResolutionReady`. Exigirle rango bloquearía la habilitación de
     * nómina de forma permanente.
     */
    it('nómina no exige rango autorizado', () => {
      expect(requiresAuthorizedRange('payroll')).toBe(false);
      expect(requiresAuthorizedRange('payroll_adjustment')).toBe(false);
    });

    it('ninguna nota de ajuste exige rango autorizado', () => {
      for (const document_type of [
        'credit_note',
        'debit_note',
        'support_adjustment_note',
        'payroll_adjustment',
        'equivalent_adjustment_note',
      ] as const) {
        expect(requiresAuthorizedRange(document_type)).toBe(false);
      }
    });
  });

  describe('documento ↔ habilitación', () => {
    it('mapea cada documento a la habilitación que lo cubre', () => {
      const expected: Record<FiscalDocumentType, string> = {
        sales_invoice: 'invoicing',
        credit_note: 'invoicing',
        debit_note: 'invoicing',
        support_document: 'support_document',
        support_adjustment_note: 'support_document',
        payroll: 'payroll',
        payroll_adjustment: 'payroll',
        pos_equivalent_document: 'equivalent_document',
        equivalent_adjustment_note: 'equivalent_document',
      };
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        expect(configurationTypeFor(document_type)).toBe(expected[document_type]);
      }
    });

    /**
     * La parte que se equivoca sola: caer a `sales_invoice` aquí reportaría una
     * configuración de documento equivalente lista sobre la fuerza de un rango
     * FEV que jamás debe consumir.
     */
    it('defaultDocumentTypeFor("equivalent_document") es pos_equivalent_document', () => {
      expect(defaultDocumentTypeFor('equivalent_document')).toBe(
        'pos_equivalent_document',
      );
      expect(defaultDocumentTypeFor('equivalent_document')).not.toBe(
        'sales_invoice',
      );
    });

    it('defaultDocumentTypeFor replica al legado para las 4 habilitaciones', () => {
      for (const configuration_type of DIAN_CONFIGURATION_TYPES) {
        expect(defaultDocumentTypeFor(configuration_type)).toBe(
          legacyDefaultDocumentType(configuration_type),
        );
      }
    });

    it('el documento por defecto de una habilitación pertenece a esa habilitación', () => {
      for (const configuration_type of DIAN_CONFIGURATION_TYPES) {
        expect(
          configurationTypeFor(defaultDocumentTypeFor(configuration_type)),
        ).toBe(configuration_type);
      }
    });

    it('documentTypesFor reparte los 9 documentos entre las 4 habilitaciones sin perder ninguno', () => {
      const covered = DIAN_CONFIGURATION_TYPES.flatMap((configuration_type) =>
        documentTypesFor(configuration_type),
      );
      expect([...covered].sort()).toEqual([...FISCAL_DOCUMENT_TYPES].sort());
      expect(documentTypesFor('equivalent_document')).toEqual([
        'pos_equivalent_document',
        'equivalent_adjustment_note',
      ]);
    });
  });

  describe('paridad con las implementaciones actuales de invoicing.service.ts', () => {
    const INVOICE_TYPES = Object.values(invoice_type_enum);

    it('cubre los 9 valores de invoice_type_enum', () => {
      expect(INVOICE_TYPES.length).toBe(9);
    });

    it('toFiscalDocumentType devuelve lo mismo que el legado para todo invoice_type_enum', () => {
      for (const invoice_type of INVOICE_TYPES) {
        expect(toFiscalDocumentType(invoice_type)).toBe(
          legacyToFiscalDocumentType(invoice_type),
        );
      }
    });

    it('traduce las dos entradas que no son identidad', () => {
      expect(toFiscalDocumentType('purchase_invoice')).toBe('support_document');
      expect(toFiscalDocumentType('export_invoice')).toBe('sales_invoice');
    });

    it('isSupportDocumentType devuelve lo mismo que el legado para todo invoice_type_enum', () => {
      for (const invoice_type of INVOICE_TYPES) {
        expect(isSupportDocumentType(invoice_type)).toBe(
          legacyIsSupportDocumentType(invoice_type),
        );
      }
    });

    it('reconoce exactamente los tres invoice_type de documento soporte', () => {
      const support = INVOICE_TYPES.filter((invoice_type) =>
        isSupportDocumentType(invoice_type),
      );
      expect([...support].sort()).toEqual(
        ['purchase_invoice', 'support_adjustment_note', 'support_document'].sort(),
      );
    });

    /**
     * Divergencia DELIBERADA con el legado, y la única: el original hacía un cast
     * a una unión de 5 tipos, así que devolvía la basura tal cual y la dejaba
     * llegar a la numeración. Numerar un documento sin requisitos declarados
     * gasta un consecutivo autorizado que no se recupera.
     */
    it('lanza ante un invoice_type desconocido en vez de castearlo', () => {
      expect(() => toFiscalDocumentType('tiquete_inventado')).toThrow(
        /No hay tipo de documento fiscal/,
      );
      expect(legacyToFiscalDocumentType('tiquete_inventado')).toBe(
        'tiquete_inventado',
      );
    });
  });

  describe('isFiscalDocumentType', () => {
    it('acepta los 9 tipos declarados', () => {
      for (const document_type of FISCAL_DOCUMENT_TYPES) {
        expect(isFiscalDocumentType(document_type)).toBe(true);
      }
    });

    it('rechaza invoice_type que no son documento fiscal, y basura', () => {
      expect(isFiscalDocumentType('purchase_invoice')).toBe(false);
      expect(isFiscalDocumentType('export_invoice')).toBe(false);
      expect(isFiscalDocumentType('')).toBe(false);
      expect(isFiscalDocumentType(null)).toBe(false);
      expect(isFiscalDocumentType(undefined)).toBe(false);
      expect(isFiscalDocumentType(42)).toBe(false);
    });

    it('no confunde propiedades heredadas de Object con tipos de documento', () => {
      expect(isFiscalDocumentType('toString')).toBe(false);
      expect(isFiscalDocumentType('constructor')).toBe(false);
    });
  });

  describe('validateResolutionDraft', () => {
    it('acepta una factura de venta con número de resolución y clave técnica', () => {
      expect(
        validateResolutionDraft({
          document_type: 'sales_invoice',
          resolution_number: '18760000001',
          technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
        }),
      ).toEqual([]);
    });

    it('exige número de resolución donde hay rango autorizado', () => {
      for (const document_type of [
        'sales_invoice',
        'support_document',
        'pos_equivalent_document',
      ] as const) {
        const violations = validateResolutionDraft({
          document_type,
          resolution_number: '   ',
          technical_key:
            document_type === 'sales_invoice' ? 'clave-tecnica' : null,
        });
        expect(violations.map((violation) => violation.code)).toContain(
          'RESOLUTION_NUMBER_REQUIRED',
        );
      }
    });

    it('exige clave técnica solo a la factura de venta', () => {
      expect(
        validateResolutionDraft({
          document_type: 'sales_invoice',
          resolution_number: '18760000001',
          technical_key: null,
        }).map((violation) => violation.code),
      ).toEqual(['TECHNICAL_KEY_REQUIRED']);

      expect(
        validateResolutionDraft({
          document_type: 'pos_equivalent_document',
          resolution_number: '18760000001',
          technical_key: null,
        }),
      ).toEqual([]);
    });

    it('rechaza una clave técnica en un documento que firma con Software-PIN', () => {
      const violations = validateResolutionDraft({
        document_type: 'pos_equivalent_document',
        resolution_number: '18760000001',
        technical_key: 'clave-que-nadie-va-a-usar',
      });
      expect(violations.map((violation) => violation.code)).toEqual([
        'TECHNICAL_KEY_NOT_APPLICABLE',
      ]);
    });

    /**
     * Una resolución de notas SÍ puede existir: es la fuente del consecutivo
     * interno que `generateNextNumber` exige. Lo que no se le puede pedir es
     * número de resolución DIAN ni clave técnica.
     */
    it('acepta una resolución de notas sin número DIAN ni clave técnica', () => {
      for (const document_type of [
        'credit_note',
        'debit_note',
        'support_adjustment_note',
        'payroll_adjustment',
        'equivalent_adjustment_note',
      ] as const) {
        expect(
          validateResolutionDraft({ document_type, resolution_number: null }),
        ).toEqual([]);
      }
    });

    it('no exige nada a nómina, que numera con su propio NumNE', () => {
      expect(validateResolutionDraft({ document_type: 'payroll' })).toEqual([]);
    });
  });
});
