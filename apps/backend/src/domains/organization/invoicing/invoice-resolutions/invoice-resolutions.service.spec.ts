import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import { VendixHttpException } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { ResolutionsService } from '../../../store/invoicing/resolutions/resolutions.service';
import { UpdateOrgInvoiceResolutionDto } from './dto/update-org-invoice-resolution.dto';
import { OrgInvoiceResolutionsService } from './invoice-resolutions.service';

/**
 * Paridad de validación del carril de ORGANIZACIÓN.
 *
 * El carril de tienda quedó validado en el paso 2, pero éste no delega en él:
 * reimplementa la escritura porque aquí `store_id` es opcional y llega en el DTO
 * en vez de en el contexto. Un carril de escritura sin las mismas reglas es por
 * donde entra la configuración que rompe producción: `invoice-flow.service.ts`
 * inyecta `resolution.technical_key` para TODOS los tipos y
 * `dian-direct.provider.ts` la prefiere sobre `config.software_pin`, así que una
 * ClTec guardada en la resolución de un documento soporte hace que su CUDS se
 * firme con la clave equivocada, la DIAN lo rechaza y el consecutivo autorizado
 * que gastó no vuelve.
 *
 * Por eso el bloque central de este archivo no comprueba «el carril de
 * organización rechaza X»: comprueba que rechaza X **con el mismo código, el
 * mismo estado y el mismo texto** que el carril de tienda. Ésa es la propiedad
 * que se degrada sola si alguien edita un lado y no el otro.
 */
describe('OrgInvoiceResolutionsService (paridad de validación con el carril de tienda)', () => {
  const ORGANIZATION_ID = 1;
  const STORE_ID = 7;
  const ACCOUNTING_ENTITY_ID = 42;

  /** ClTec de ejemplo con la forma que entrega la DIAN (hex de 40 caracteres). */
  const CLTEC = 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c';

  // ---------------------------------------------------------------------------
  // Dobles del carril de organización
  // ---------------------------------------------------------------------------

  const createOrgPrismaMock = (
    overrides: {
      resolution?: Record<string, unknown> | null;
      duplicate?: Record<string, unknown> | null;
    } = {},
  ) => {
    const unscoped = {
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(overrides.duplicate ?? null),
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
    };

    return {
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(overrides.resolution ?? null),
      },
      stores: { findFirst: jest.fn().mockResolvedValue({ id: STORE_ID }) },
      withoutScope: jest.fn().mockReturnValue(unscoped),
      __unscoped: unscoped,
    };
  };

  type OrgPrismaMock = ReturnType<typeof createOrgPrismaMock>;

  /**
   * Doble de `TechnicalKeyVaultService`. La ClTec ya no se escribe a pelo:
   * los dos carriles esparcen sobre el `data` de Prisma la terna que devuelve
   * `sealForWrite` (claro, cifrado, huella). Un `jest.fn()` sin retorno
   * esparciría `undefined` y borraría las tres columnas sin que la prueba lo
   * note.
   */
  const createTechnicalKeyVaultDouble = () => ({
    sealForWrite: jest.fn((raw: string | null | undefined) => ({
      technical_key: raw ?? null,
      technical_key_encrypted: raw ? `enc:${raw}` : null,
      technical_key_fingerprint: raw ? `fp:${raw}` : null,
    })),
  });

  const createOrgService = (
    overrides: Parameters<typeof createOrgPrismaMock>[0] & {
      fiscal_scope?: 'STORE' | 'ORGANIZATION';
    } = {},
  ): { service: OrgInvoiceResolutionsService; prisma: OrgPrismaMock } => {
    const prisma = createOrgPrismaMock(overrides);
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest
        .fn()
        .mockResolvedValue({ id: ACCOUNTING_ENTITY_ID }),
      requireFiscalScope: jest
        .fn()
        .mockResolvedValue(overrides.fiscal_scope ?? 'ORGANIZATION'),
    };
    const service = new OrgInvoiceResolutionsService(
      prisma as any,
      fiscalScope as any,
      createTechnicalKeyVaultDouble() as any,
    );
    return { service, prisma };
  };

  // ---------------------------------------------------------------------------
  // Doble del carril de tienda, sólo para confrontar sus rechazos con los de acá
  // ---------------------------------------------------------------------------

  const createStoreService = (): ResolutionsService => {
    const prisma = {
      invoice_resolutions: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 100, ...data }),
          ),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      invoices: { count: jest.fn().mockResolvedValue(0) },
      withoutScope: jest.fn().mockReturnValue({
        invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    };
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest
        .fn()
        .mockResolvedValue({ id: ACCOUNTING_ENTITY_ID }),
    };
    return new ResolutionsService(
      prisma as any,
      fiscalScope as any,
      createTechnicalKeyVaultDouble() as any,
    );
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
  const capturarError = async (run: () => Promise<unknown>): Promise<any> => {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error('Se esperaba un rechazo y la operación se guardó.');
  };

  const codigosDeViolacion = (error: VendixHttpException): string[] => {
    const body = error.getResponse() as any;
    return (body?.details?.violations ?? []).map((v: any) => v.code);
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getOrganizationId')
      .mockReturnValue(ORGANIZATION_ID);
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: ORGANIZATION_ID,
      store_id: STORE_ID,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------

  describe('rechaza lo mismo, y con el mismo texto, que el carril de tienda', () => {
    /**
     * Cada caso es una configuración que la DIAN rechazaría. Se manda por los dos
     * carriles y se confronta el rechazo entero: código, estado HTTP, mensaje y
     * violaciones. Si alguien vuelve a escribir las reglas por separado, la
     * primera divergencia de redacción rompe esta prueba.
     */
    const casosIlegales: Array<[string, Record<string, unknown>]> = [
      [
        'clave técnica en documento soporte',
        {
          document_type: 'support_document',
          prefix: 'DSJL',
          technical_key: CLTEC,
        },
      ],
      [
        'clave técnica en documento equivalente POS',
        {
          document_type: 'pos_equivalent_document',
          prefix: 'POS',
          technical_key: CLTEC,
        },
      ],
      [
        'clave técnica en nota crédito',
        { document_type: 'credit_note', prefix: 'NC', technical_key: CLTEC },
      ],
      ['factura de venta sin clave técnica', { technical_key: undefined }],
      [
        'documento soporte sin número de resolución',
        {
          document_type: 'support_document',
          prefix: 'DSJL',
          resolution_number: undefined,
          technical_key: undefined,
        },
      ],
      ['rango invertido', { range_from: 9000, range_to: 100 }],
      ['rango por debajo de 1', { range_from: 0, range_to: 100 }],
      ['rango no entero', { range_from: 1000.5, range_to: 5000 }],
      [
        'vigencia invertida',
        { valid_from: '2027-01-15', valid_to: '2026-01-15' },
      ],
      ['resolución de nómina electrónica', { document_type: 'payroll' }],
      ['tipo de documento inventado', { document_type: 'factura_inventada' }],
    ];

    it.each(casosIlegales)('%s', async (_titulo, mutacion) => {
      const { service: orgService, prisma } = createOrgService();
      const storeService = createStoreService();
      const payload = { ...facturaVentaValida(), ...mutacion };

      const errorOrg = await capturarError(() =>
        orgService.create(payload as any),
      );
      const errorTienda = await capturarError(() =>
        storeService.create(payload as any),
      );

      expect(errorOrg).toBeInstanceOf(VendixHttpException);
      expect(errorOrg.errorCode).toBe(errorTienda.errorCode);
      expect(errorOrg.getStatus()).toBe(errorTienda.getStatus());
      // El texto también: es lo que lee quien está parado frente al formulario.
      expect(errorOrg.message).toBe(errorTienda.message);
      expect(codigosDeViolacion(errorOrg)).toEqual(
        codigosDeViolacion(errorTienda),
      );

      // Y nada tocó la base.
      expect(prisma.__unscoped.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    it('la clave técnica en documento soporte se rechaza con 008/422 y la violación nombrada', async () => {
      const { service } = createOrgService();

      const error = await capturarError(() =>
        service.create({
          ...facturaVentaValida(),
          document_type: 'support_document',
          prefix: 'DSJL',
          technical_key: CLTEC,
        } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
      expect(error.getStatus()).toBe(422);
      expect(codigosDeViolacion(error)).toContain('TECHNICAL_KEY_NOT_APPLICABLE');
      // Nombra la corrección concreta, no sólo el fallo.
      expect(error.message).toContain('Clave técnica');
    });
  });

  // ---------------------------------------------------------------------------

  describe('el hueco que este carril tenía abierto', () => {
    /**
     * `invoice_resolutions.resolution_number` es NOT NULL y las notas no tienen
     * número DIAN que poner, así que este carril respondía con un error de base
     * (500) en vez de guardar la fila rotulada como interna — que es justo la
     * fila sin la que `generateNextNumber` no puede emitir ninguna nota.
     */
    it('acepta una nota crédito sin número de resolución y la rotula como interna', async () => {
      const { service, prisma } = createOrgService();

      await service.create({
        ...facturaVentaValida(),
        document_type: 'credit_note',
        prefix: 'NC',
        resolution_number: undefined,
        technical_key: undefined,
      } as any);

      const create = prisma.__unscoped.invoice_resolutions.create;
      expect(create).toHaveBeenCalledTimes(1);
      const { data } = create.mock.calls[0][0];
      expect(data.document_type).toBe('credit_note');
      expect(data.resolution_number).toBe('INTERNA-NC');
      expect(data.technical_key).toBeNull();
    });

    it('acepta una nota débito sin número de resolución', async () => {
      const { service, prisma } = createOrgService();

      await service.create({
        ...facturaVentaValida(),
        document_type: 'debit_note',
        prefix: 'ND',
        resolution_number: undefined,
        technical_key: undefined,
      } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.create.mock.calls[0][0];
      expect(data.resolution_number).toBe('INTERNA-ND');
    });
  });

  // ---------------------------------------------------------------------------

  describe('prefijo duplicado', () => {
    const duplicado = {
      id: 88,
      resolution_number: '18764000001234',
      document_type: 'sales_invoice',
      is_active: false,
    };

    it('responde VendixHttpException con INVOICING_RESOLUTION_007, no ConflictException crudo', async () => {
      const { service, prisma } = createOrgService({ duplicate: duplicado });

      const error = await capturarError(() =>
        service.create(facturaVentaValida() as any),
      );

      // El fondo del arreglo: un ConflictException crudo no lleva `error_code`,
      // así que el frontend no podía mapear el error ni señalar el campo.
      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error).not.toBeInstanceOf(ConflictException);
      expect(error.errorCode).toBe('INVOICING_RESOLUTION_007');
      expect(error.getStatus()).toBe(409);
      expect(error.message).toContain(
        'La DIAN autoriza el prefijo por NIT',
      );
      expect((error.getResponse() as any).details).toMatchObject({
        resolution_id: 88,
        prefix: 'FE',
        is_active: false,
      });
      expect(prisma.__unscoped.invoice_resolutions.create).not.toHaveBeenCalled();
    });

    it('mira el mismo eje del índice único y con el mismo cliente que escribe', async () => {
      const { service, prisma } = createOrgService({ duplicate: duplicado });

      await capturarError(() => service.create(facturaVentaValida() as any));

      // `(accounting_entity_id, prefix)` — sin `document_type`, sin `is_active`,
      // que es como está declarado `invoice_resolutions_entity_prefix_uidx`.
      const [args] =
        prisma.__unscoped.invoice_resolutions.findFirst.mock.calls[0];
      expect(args.where).toEqual({
        accounting_entity_id: ACCOUNTING_ENTITY_ID,
        prefix: 'FE',
      });
      expect(prisma.withoutScope).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------

  describe('PATCH que no menciona is_active', () => {
    const resolucionRetirada = {
      id: 55,
      organization_id: ORGANIZATION_ID,
      store_id: null,
      accounting_entity_id: ACCOUNTING_ENTITY_ID,
      document_type: 'support_document',
      resolution_number: '18764000001234',
      resolution_date: new Date('2026-01-15'),
      prefix: 'DSJL',
      range_from: 1,
      range_to: 5000,
      current_number: 0,
      valid_from: new Date('2026-01-15'),
      valid_to: new Date('2027-01-15'),
      is_active: false,
      technical_key: null,
      _count: { invoices: 0 },
    };

    /**
     * Prueba directa del defecto de `PartialType`: `@nestjs/mapped-types` copia
     * los inicializadores de propiedad del DTO base a través de toda la cadena de
     * herencia. Si alguien vuelve a poner un `is_active = true` en
     * `CreateResolutionDto` o en `CreateOrgInvoiceResolutionDto`, aparecería aquí
     * como clave propia de una instancia vacía — y el servicio lo escribiría.
     */
    it('el DTO de actualización no materializa ningún defecto', () => {
      expect(Object.keys(new UpdateOrgInvoiceResolutionDto())).toEqual([]);

      const dto = plainToInstance(UpdateOrgInvoiceResolutionDto, {
        technical_key: null,
      });
      expect(dto.is_active).toBeUndefined();
      expect(dto.document_type).toBeUndefined();
    });

    it('no reactiva una resolución desactivada', async () => {
      const { service, prisma } = createOrgService({
        resolution: resolucionRetirada,
      });

      await service.update(55, { technical_key: null } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.update.mock.calls[0][0];
      // Las tres columnas del vault se limpian juntas (ver el caso homónimo del
      // carril de tienda); lo que este caso vigila es que `is_active` NO viaje.
      expect(data).toEqual({
        technical_key: null,
        technical_key_encrypted: null,
        technical_key_fingerprint: null,
      });
      expect(data).not.toHaveProperty('is_active');
    });

    it('sigue permitiendo activarla cuando el PATCH sí lo pide', async () => {
      const { service, prisma } = createOrgService({
        resolution: resolucionRetirada,
      });

      await service.update(55, { is_active: true } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.update.mock.calls[0][0];
      expect(data).toEqual({ is_active: true });
    });
  });

  // ---------------------------------------------------------------------------

  describe('mover el rango de una resolución que todavía no ha emitido', () => {
    /**
     * Fila intacta: `current_number` vale `range_from - 1`, que es como nace en
     * `create`. Nada se ha numerado todavía, así que el rango entero es
     * corregible.
     */
    const sinConsumir = {
      id: 55,
      organization_id: ORGANIZATION_ID,
      store_id: null,
      accounting_entity_id: ACCOUNTING_ENTITY_ID,
      document_type: 'support_document',
      resolution_number: '18764000001234',
      resolution_date: new Date('2026-01-15'),
      prefix: 'DSJL',
      range_from: 1000,
      range_to: 5000,
      current_number: 999,
      valid_from: new Date('2026-01-15'),
      valid_to: new Date('2027-01-15'),
      is_active: true,
      technical_key: null,
      _count: { invoices: 0 },
    };

    it('re-siembra el consecutivo en el piso nuevo', async () => {
      const { service, prisma } = createOrgService({ resolution: sinConsumir });

      await service.update(55, { range_from: 8000, range_to: 9000 } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.update.mock.calls[0][0];
      // Sin esto, el siguiente documento saldría con el 1000 —el piso viejo—,
      // que el rango nuevo ya no cubre: numeración no autorizada emitida por
      // una corrección que el comerciante creyó inofensiva.
      expect(data.current_number).toBe(7999);
    });

    it('no lo toca cuando el piso no se mueve', async () => {
      const { service, prisma } = createOrgService({ resolution: sinConsumir });

      await service.update(55, { range_to: 9000 } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('current_number');
    });

    it('no re-siembra una resolución que ya numeró: ahí el piso es inmutable', async () => {
      const { service } = createOrgService({
        resolution: { ...sinConsumir, current_number: 1200 },
      });

      const error = await capturarError(() =>
        service.update(55, { range_from: 8000 } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_005');
    });
  });

  // ---------------------------------------------------------------------------

  describe('edición de una resolución ya consumida', () => {
    /**
     * Fila deliberadamente sucia: documento soporte CON clave técnica —del tipo
     * que existía antes de esta validación— y ya consumida (`current_number` pasó
     * de `range_from`). Es el caso real de la resolución SETP de habilitación,
     * que no se puede borrar porque quemó numeración.
     */
    const consumidaSucia = {
      id: 55,
      organization_id: ORGANIZATION_ID,
      store_id: null,
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
      _count: { invoices: 3 },
    };

    it('bloquea cambiar los campos que fijan su identidad fiscal', async () => {
      const { service, prisma } = createOrgService({
        resolution: consumidaSucia,
      });

      const error = await capturarError(() =>
        service.update(55, { prefix: 'OTRO' } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_005');
      expect(error.message).toContain('prefijo');
      expect(
        prisma.__unscoped.invoice_resolutions.update,
      ).not.toHaveBeenCalled();
    });

    it('bloquea bajar el techo del rango por debajo de lo ya numerado', async () => {
      const { service, prisma } = createOrgService({
        resolution: consumidaSucia,
      });

      const error = await capturarError(() =>
        service.update(55, { range_to: 10 } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_009');
      expect(
        prisma.__unscoped.invoice_resolutions.update,
      ).not.toHaveBeenCalled();
    });

    it('permite desactivarla aunque incumpla el contrato', async () => {
      const { service, prisma } = createOrgService({
        resolution: consumidaSucia,
      });

      await service.update(55, { is_active: false } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.update.mock.calls[0][0];
      expect(data).toEqual({ is_active: false });
    });

    it('permite borrar la clave técnica mal guardada', async () => {
      const { service, prisma } = createOrgService({
        resolution: consumidaSucia,
      });

      await service.update(55, { technical_key: null } as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.update.mock.calls[0][0];
      expect(data).toEqual({
        technical_key: null,
        technical_key_encrypted: null,
        technical_key_fingerprint: null,
      });
    });

    it('rechaza añadirle una clave técnica al reeditarla', async () => {
      const { service } = createOrgService({
        resolution: { ...consumidaSucia, technical_key: null },
      });

      const error = await capturarError(() =>
        service.update(55, { technical_key: CLTEC } as any),
      );

      expect(error.errorCode).toBe('INVOICING_RESOLUTION_008');
      expect(codigosDeViolacion(error)).toContain('TECHNICAL_KEY_NOT_APPLICABLE');
    });

    it('no la deja borrar: es el único registro de qué números se consumieron', async () => {
      const { service, prisma } = createOrgService({
        resolution: consumidaSucia,
      });

      const error = await capturarError(() => service.remove(55));

      expect(error).toBeInstanceOf(VendixHttpException);
      expect(error.errorCode).toBe('INVOICING_RESOLUTION_003');
      expect(error).not.toBeInstanceOf(ConflictException);
      expect(
        prisma.__unscoped.invoice_resolutions.delete,
      ).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------

  describe('store_id sigue siendo opcional (lo propio de este carril)', () => {
    it('con fiscal_scope=ORGANIZATION guarda sin tienda y sin exigirla', async () => {
      const { service, prisma } = createOrgService({
        fiscal_scope: 'ORGANIZATION',
      });

      await service.create(facturaVentaValida() as any);

      const { data } =
        prisma.__unscoped.invoice_resolutions.create.mock.calls[0][0];
      expect(data.store_id).toBeNull();
      expect(data.organization_id).toBe(ORGANIZATION_ID);
      expect(data.accounting_entity_id).toBe(ACCOUNTING_ENTITY_ID);
      // El cursor arranca justo antes del rango autorizado.
      expect(data.current_number).toBe(0);
      expect(prisma.stores.findFirst).not.toHaveBeenCalled();
    });

    it('con fiscal_scope=STORE exige la tienda', async () => {
      const { service } = createOrgService({ fiscal_scope: 'STORE' });

      const error = await capturarError(() =>
        service.create(facturaVentaValida() as any),
      );

      expect(error).toBeInstanceOf(BadRequestException);
    });

    it('con fiscal_scope=STORE valida que la tienda sea de la organización', async () => {
      const { service, prisma } = createOrgService({ fiscal_scope: 'STORE' });

      await service.create({
        ...facturaVentaValida(),
        store_id: STORE_ID,
      } as any);

      expect(prisma.stores.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: STORE_ID,
            organization_id: ORGANIZATION_ID,
          }),
        }),
      );
      const { data } =
        prisma.__unscoped.invoice_resolutions.create.mock.calls[0][0];
      expect(data.store_id).toBe(STORE_ID);
    });
  });
});
