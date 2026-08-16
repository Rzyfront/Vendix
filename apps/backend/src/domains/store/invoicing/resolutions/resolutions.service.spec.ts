import { VendixHttpException } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResolutionsService } from './resolutions.service';

/**
 * Validación cruzada de resoluciones DIAN.
 *
 * Lo que estas pruebas protegen no es una regla de formulario: es un consecutivo
 * autorizado. `invoice-flow.service.ts` inyecta `resolution.technical_key` para
 * TODOS los tipos de documento y `dian-direct.provider.ts` la prefiere sobre
 * `config.software_pin`; una ClTec guardada en la resolución de un documento
 * soporte hace que su CUDS se firme con la clave equivocada, la DIAN lo rechaza
 * y el número que gastó no vuelve. El único punto donde eso se puede impedir es
 * al guardar la resolución, que es lo que se prueba aquí.
 *
 * El servicio es además el cuello común del panel del comerciante y de la
 * consola de super admin (`TenantResolutionsController` lo reusa vía
 * `TenantContextRunner`), así que probarlo cubre las dos consolas.
 */
describe('ResolutionsService (validación fiscal por tipo de documento)', () => {
  const ORGANIZATION_ID = 1;
  const STORE_ID = 7;
  const ACCOUNTING_ENTITY_ID = 42;

  /** ClTec de ejemplo con la forma que entrega la DIAN (hex de 40 caracteres). */
  const CLTEC = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

  const createPrismaMock = (overrides: {
    resolution?: Record<string, unknown> | null;
    duplicate?: Record<string, unknown> | null;
  } = {}) => {
    const withoutScopeFindFirst = jest
      .fn()
      .mockResolvedValue(overrides.duplicate ?? null);

    return {
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides.resolution === undefined ? null : overrides.resolution,
          ),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 100, ...data }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ where, data }: any) =>
            Promise.resolve({ id: where.id, ...data }),
          ),
        delete: jest.fn().mockResolvedValue({}),
      },
      invoices: { count: jest.fn().mockResolvedValue(0) },
      withoutScope: jest.fn().mockReturnValue({
        invoice_resolutions: { findFirst: withoutScopeFindFirst },
      }),
      __withoutScopeFindFirst: withoutScopeFindFirst,
    };
  };

  type PrismaMock = ReturnType<typeof createPrismaMock>;

  const createService = (
    overrides: Parameters<typeof createPrismaMock>[0] = {},
  ): { service: ResolutionsService; prisma: PrismaMock } => {
    const prisma = createPrismaMock(overrides);
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest
        .fn()
        .mockResolvedValue({ id: ACCOUNTING_ENTITY_ID }),
    };
    // La ClTec ya no se escribe a pelo: pasa por `TechnicalKeyVaultService`,
    // que devuelve la terna (claro, cifrado, huella) que el servicio esparce
    // sobre el `data` de Prisma. El doble reproduce esa forma —no un `jest.fn()`
    // vacío— porque un `undefined` esparcido borraría las tres columnas y la
    // prueba pasaría sobre una escritura que en producción pierde la clave.
    const technicalKeyVault = {
      sealForWrite: jest.fn((raw: string | null | undefined) => ({
        technical_key: raw ?? null,
        technical_key_encrypted: raw ? `enc:${raw}` : null,
        technical_key_fingerprint: raw ? `fp:${raw}` : null,
      })),
    };
    const service = new ResolutionsService(
      prisma as any,
      fiscalScope as any,
      technicalKeyVault as any,
    );
    return { service, prisma };
  };

  /** Alta válida de factura electrónica de venta, sobre la que cada caso muta un campo. */
  const facturaVentaValida = () => ({
    resolution_number: '18764000001234',
    document_type: 'sales_invoice' as const,
    resolution_date: '2026-01-15',
    prefix: 'FE',
    range_from: 1,
    range_to: 5000,
    valid_from: '2026-01-15',
    valid_to: '2027-01-15',
    technical_key: CLTEC,
  });

  /** Ejecuta y devuelve la excepción, fallando si la operación pasó. */
  const capturarError = async (
    run: () => Promise<unknown>,
  ): Promise<VendixHttpException> => {
    try {
      await run();
    } catch (error) {
      return error as VendixHttpException;
    }
    throw new Error('Se esperaba un rechazo y la operación se guardó.');
  };

  const codigosDeViolacion = (error: VendixHttpException): string[] => {
    const body = error.getResponse() as any;
    return (body?.details?.violations ?? []).map((v: any) => v.code);
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: ORGANIZATION_ID,
      store_id: STORE_ID,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('clave técnica', () => {
    // El documento soporte y el documento equivalente POS SÍ cuelgan de un rango
    // autorizado, y aun así su clave lleva el Software-PIN como 14º campo. Son
    // exactamente los casos donde una ClTec guardada quema numeración real.
    it.each([
      ['support_document', 'DSJL'],
      ['pos_equivalent_document', 'POS'],
      ['credit_note', 'NC'],
    ])(
      'rechaza guardar una clave técnica en %s',
      async (document_type, prefix) => {
        const { service, prisma } = createService();

        const error = await capturarError(() =>
          service.create({
            ...facturaVentaValida(),
            document_type: document_type as any,
            prefix,
            technical_key: CLTEC,
          } as any),
        );

        expect(error).toBeInstanceOf(VendixHttpException);
        expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
        expect(error.getStatus()).toBe(422);
        expect(codigosDeViolacion(error)).toContain(
          'TECHNICAL_KEY_NOT_APPLICABLE',
        );
        // Nombra la corrección, no solo el fallo.
        expect(error.message).toContain('Clave técnica');
        expect(prisma.invoice_resolutions.create).not.toHaveBeenCalled();
      },
    );

    it('rechaza una factura electrónica de venta sin clave técnica', async () => {
      const { service, prisma } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          technical_key: undefined,
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
      expect(error.getStatus()).toBe(422);
      expect(codigosDeViolacion(error)).toContain('TECHNICAL_KEY_REQUIRED');
      expect(prisma.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    it('acepta una factura electrónica de venta completa', async () => {
      const { service, prisma } = createService();

      await service.create(facturaVentaValida() as any);

      expect(prisma.invoice_resolutions.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.invoice_resolutions.create.mock.calls[0][0];
      expect(data.document_type).toBe('sales_invoice');
      expect(data.technical_key).toBe(CLTEC);
      // El cursor arranca justo antes del rango autorizado.
      expect(data.current_number).toBe(0);
    });
  });

  describe('número de resolución', () => {
    // Zanjado por evidencia: la DIAN autorizó a un cliente real el rango `DSJL`
    // bajo modalidad «DOCUMENTO SOPORTE» código 6. Que el XML omita
    // `sts:InvoiceControl` es otra cuestión.
    it('exige número de resolución al documento soporte', async () => {
      const { service, prisma } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          document_type: 'support_document',
          prefix: 'DSJL',
          resolution_number: undefined,
          technical_key: undefined,
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
      expect(codigosDeViolacion(error)).toContain('RESOLUTION_NUMBER_REQUIRED');
      expect(prisma.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    // La DIAN no autoriza rango para las notas, pero `generateNextNumber` sigue
    // exigiendo su fila por `document_type`: sin ella lanza
    // `FISCAL_RESOLUTION_MISSING` y no se puede emitir ninguna nota.
    it('acepta una nota crédito sin número de resolución y la rotula como interna', async () => {
      const { service, prisma } = createService();

      await service.create({
        ...facturaVentaValida(),
        document_type: 'credit_note',
        prefix: 'NC',
        resolution_number: undefined,
        technical_key: undefined,
      } as any);

      expect(prisma.invoice_resolutions.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.invoice_resolutions.create.mock.calls[0][0];
      expect(data.document_type).toBe('credit_note');
      expect(data.resolution_number).toBe('INTERNA-NC');
      expect(data.technical_key).toBeNull();
    });
  });

  describe('rango y vigencia', () => {
    it('rechaza un rango invertido', async () => {
      const { service, prisma } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          range_from: 9000,
          range_to: 100,
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_009');
      expect(error.getStatus()).toBe(400);
      expect(prisma.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    it('rechaza un rango que arranca por debajo de 1', async () => {
      const { service } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          range_from: 0,
          range_to: 100,
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_009');
    });

    it('rechaza una vigencia invertida', async () => {
      const { service, prisma } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          valid_from: '2027-01-15',
          valid_to: '2026-01-15',
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_010');
      expect(error.getStatus()).toBe(400);
      expect(prisma.invoice_resolutions.create).not.toHaveBeenCalled();
    });
  });

  describe('edición de una resolución ya consumida', () => {
    /**
     * Fila deliberadamente sucia: documento soporte CON clave técnica, del tipo
     * que existía antes de esta validación, y ya consumida (`current_number`
     * pasó de `range_from`) — el caso real de la resolución SETP de habilitación,
     * que no se puede borrar porque quemó numeración.
     */
    const resolucionConsumidaSucia = {
      id: 55,
      organization_id: ORGANIZATION_ID,
      store_id: STORE_ID,
      accounting_entity_id: ACCOUNTING_ENTITY_ID,
      document_type: 'support_document',
      resolution_number: '18764000001234',
      resolution_date: new Date('2026-01-15'),
      prefix: 'DSJL',
      range_from: 1,
      range_to: 5000,
      current_number: 37,
      valid_from: new Date('2026-01-15'),
      valid_to: new Date('2027-01-15'),
      is_active: true,
      technical_key: CLTEC,
    };

    it('permite desactivarla aunque incumpla el contrato', async () => {
      const { service, prisma } = createService({
        resolution: resolucionConsumidaSucia,
      });

      await service.update(55, { is_active: false } as any);

      expect(prisma.invoice_resolutions.update).toHaveBeenCalledTimes(1);
      const { data } = prisma.invoice_resolutions.update.mock.calls[0][0];
      expect(data).toEqual({ is_active: false });
    });

    it('permite borrar la clave técnica mal guardada', async () => {
      const { service, prisma } = createService({
        resolution: resolucionConsumidaSucia,
      });

      await service.update(55, { technical_key: null } as any);

      const { data } = prisma.invoice_resolutions.update.mock.calls[0][0];
      // Borrar la clave limpia las TRES columnas, no sólo el texto plano. Dejar
      // la copia cifrada sería peor que no borrar nada: el vault prefiere la
      // cifrada al revelar, así que el emisor seguiría hasheando la ClTec que el
      // comerciante creyó haber quitado.
      expect(data).toEqual({
        technical_key: null,
        technical_key_encrypted: null,
        technical_key_fingerprint: null,
      });
    });

    it('bloquea cambiar los campos que fijan su identidad fiscal', async () => {
      const { service, prisma } = createService({
        resolution: resolucionConsumidaSucia,
      });

      const error = await capturarError(() =>
        service.update(55, { prefix: 'OTRO' } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_005');
      expect(prisma.invoice_resolutions.update).not.toHaveBeenCalled();
    });

    it('bloquea bajar el techo del rango por debajo de lo ya numerado', async () => {
      const { service, prisma } = createService({
        resolution: resolucionConsumidaSucia,
      });

      const error = await capturarError(() =>
        service.update(55, { range_to: 10 } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_009');
      expect(prisma.invoice_resolutions.update).not.toHaveBeenCalled();
    });

    it('rechaza añadirle una clave técnica al reeditarla', async () => {
      const { service, prisma } = createService({
        resolution: {
          ...resolucionConsumidaSucia,
          technical_key: null,
        },
      });

      const error = await capturarError(() =>
        service.update(55, { technical_key: CLTEC } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
      expect(codigosDeViolacion(error)).toContain(
        'TECHNICAL_KEY_NOT_APPLICABLE',
      );
      expect(prisma.invoice_resolutions.update).not.toHaveBeenCalled();
    });
  });

  describe('tipo de documento', () => {
    it('rechaza un tipo que no está en el contrato', async () => {
      const { service } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          document_type: 'factura_inventada',
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
    });

    // La nómina electrónica numera con su propio `NumNE`: registrarle una
    // resolución no habilita nada y sugiere un rango autorizado inexistente.
    it('rechaza registrar una resolución de nómina electrónica', async () => {
      const { service } = createService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          document_type: 'payroll',
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
      expect(error.message).toContain('NumNE');
    });
  });
});
