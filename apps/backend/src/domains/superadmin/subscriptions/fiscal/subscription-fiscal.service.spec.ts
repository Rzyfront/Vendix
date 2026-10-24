import { HttpException } from '@nestjs/common';

import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { assertNoCrossTenantNumberingOverlap } from '../../../store/invoicing/utils/cross-tenant-numbering-guard.util';
import { archiveResolutionInTx } from '../../../store/invoicing/utils/resolution-archive.util';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import {
  FiscalDocumentValidationInput,
  FiscalDocumentValidator,
} from '../../../store/invoicing/validators/fiscal-document.validator';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
} from '../../../store/invoicing/providers/invoice-provider.interface';

jest.mock('../../../store/invoicing/utils/cross-tenant-numbering-guard.util', () => ({
  assertNoCrossTenantNumberingOverlap: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../store/invoicing/utils/resolution-archive.util', () => ({
  archiveResolutionInTx: jest.fn(),
}));

/**
 * EL CARRIL DE PLATAFORMA — `POST /superadmin/subscriptions/fiscal/sales-invoices`.
 *
 * ## Qué defecto fija esta suite
 *
 * `createPlatformInvoice` empujaba cada impuesto al payload del proveedor con
 * la forma equivocada: `rate` (fracción 0,19) en vez de `tax_rate` (porcentaje
 * '19.00'), y `taxable_amount` tomado del DTO —normalmente ausente— en vez de
 * la base que el propio servidor despeja. El emisor lee `tax_rate` y
 * `taxable_amount`, así que recibía `undefined` y `null`, y
 * `FiscalDocumentValidator` bloqueaba con `TAX_RATE_MISSING` TODA factura con
 * impuestos. El desajuste era invisible porque el constructor del payload
 * cerraba con una aserción de tipo que apagaba al compilador.
 *
 * ## Cómo se ejercita
 *
 * El servicio tiene 17 dependencias inyectadas, pero el tramo bajo prueba —el
 * cálculo por línea, la construcción del payload y la puerta de pre-emisión—
 * sólo toca cuatro: `prisma` (una lectura de resolución y la transacción),
 * `technicalKeyVault`, y los DOS prevalidadores, que se usan REALES porque son
 * `@Injectable()` puros y son justamente lo que hay que ejercitar. Las trece
 * restantes se pasan como objetos vacíos vía `Reflect.construct`, que evita
 * importar y falsear trece contratos que este tramo no ejecuta.
 *
 * La transacción se corta con un centinela: todo lo que esta suite mide ocurre
 * ANTES de `allocateFiscalNumber`, y dejarla correr exigiría montar media base
 * de datos para observar un payload que ya está construido.
 */

/** Corta el flujo justo después de la puerta de pre-emisión. */
const STOP_AFTER_PREVALIDATION = new Error('__stop_after_prevalidation__');

/** ClTec de 64 hex — una de las dos longitudes que la DIAN emite. */
const TECHNICAL_KEY = 'a'.repeat(64);

/** NIT con DV real por módulo 11 (902056589 → 9). */
const VALID_NIT = '902056589';
const VALID_NIT_DV = '9';

/**
 * Vista mínima y tipada de los dos miembros privados que la suite necesita
 * intervenir. Se declara en vez de usar `any` para que un cambio de firma
 * rompa el test en compilación y no en runtime.
 */
interface PlatformFiscalInternals {
  getSettings(): Promise<unknown>;
  buildPlatformProviderData(...args: never[]): ProviderInvoiceData;
}

interface HarnessResult {
  /** El payload que se le habría entregado al emisor DIAN. */
  providerData: ProviderInvoiceData;
  /** Lo que el prevalidador de documento juzgó. */
  documentInput: FiscalDocumentValidationInput;
  /** Códigos de hallazgo bloqueante del prevalidador de documento. */
  documentBlockerCodes: string[];
  /** El error con el que terminó la llamada. */
  error: unknown;
}

/** Familia de hallazgos que habla de impuestos — la que este fix gobierna. */
const TAX_FINDING_CODES = [
  'TAX_RATE_MISSING',
  'TAX_SUBTOTAL_MISMATCH',
  'TAX_SCHEME_RATE_COLLISION',
  'HEADER_TAX_TOTAL_MISMATCH',
];

function buildResolutionRow() {
  const now = new Date();
  return {
    id: 77,
    resolution_number: '18760000001',
    prefix: 'FE',
    range_from: 1,
    range_to: 1000,
    current_number: 0,
    valid_from: new Date(now.getFullYear() - 1, 0, 1),
    valid_to: new Date(now.getFullYear() + 1, 11, 31),
    is_active: true,
    technical_key: TECHNICAL_KEY,
    document_type: 'sales_invoice',
  };
}

function buildSettings() {
  return {
    is_enabled: true,
    auto_issue: false,
    environment: 'test',
    platform_organization_id: 1,
    accounting_entity_id: 5,
    dian_configuration_id: 9,
    invoice_resolution_id: 77,
    last_tested_at: null,
    last_test_result: null,
  };
}

/**
 * Cliente nominativo COMPLETO y sin dirección.
 *
 * Sin `address_line` a propósito: `buildPlatformCustomerIdentityInput` fija
 * `city_code: null` siempre, así que cualquier dirección dispara el bloqueante
 * `CITY_CODE_REQUIRED` del prevalidador de identidad. Eso es un defecto aparte
 * (el DTO de plataforma no captura código DANE) y esta suite lo usa a propósito
 * en el caso 4 para provocar un bloqueo real, no para taparlo.
 */
function buildCustomer(): CreatePlatformInvoiceDto['customer'] {
  return {
    legal_name: 'Comercializadora Andina S.A.S.',
    tax_id: VALID_NIT,
    tax_id_dv: VALID_NIT_DV,
    email: 'facturacion@andina.co',
    document_type: '31',
    person_type: '1',
    tax_regime_code: '48',
    fiscal_responsibilities: ['O-13'],
  };
}

/**
 * Corre `createPlatformInvoice` hasta el centinela y devuelve lo que el
 * proveedor y el prevalidador vieron.
 */
async function runPrevalidation(
  dto: CreatePlatformInvoiceDto,
): Promise<HarnessResult> {
  const identityValidator = new CustomerFiscalIdentityValidator();
  const documentValidator = new FiscalDocumentValidator();

  const prisma = {
    withoutScope: () => ({
      invoice_resolutions: {
        findFirst: jest.fn().mockResolvedValue(buildResolutionRow()),
      },
    }),
    $transaction: jest.fn(async () => {
      throw STOP_AFTER_PREVALIDATION;
    }),
  };

  const technicalKeyVault = { reveal: () => TECHNICAL_KEY };
  const unused = {};

  // Orden EXACTO del constructor: prisma(1), technicalKeyVault(13),
  // identityValidator(14), documentValidator(15).
  const service: SubscriptionFiscalService = Reflect.construct(
    SubscriptionFiscalService,
    [
      prisma,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      technicalKeyVault,
      identityValidator,
      documentValidator,
      unused,
      unused,
    ],
  );

  const internals = service as unknown as PlatformFiscalInternals;
  jest
    .spyOn(internals, 'getSettings')
    .mockResolvedValue(buildSettings());
  // `spyOn` llama al original por defecto: se observa el payload REAL, no uno
  // sustituido.
  const builderSpy = jest.spyOn(internals, 'buildPlatformProviderData');
  const documentSpy = jest.spyOn(documentValidator, 'validate');

  let error: unknown = null;
  try {
    await service.createPlatformInvoice(dto);
  } catch (caught) {
    error = caught;
  }

  expect(builderSpy).toHaveBeenCalled();
  expect(documentSpy).toHaveBeenCalled();

  const providerData = builderSpy.mock.results[0].value;
  const documentInput = documentSpy.mock.calls[0][0];
  const documentBlockerCodes = documentSpy.mock.results[0].value.blockers.map(
    (finding) => finding.code,
  );

  return { providerData, documentInput, documentBlockerCodes, error };
}

describe('SubscriptionFiscalService · createPlatformInvoice · impuestos al proveedor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('IVA 19 % INCLUSIVO: declara la tarifa en porcentaje y la base despejada', async () => {
    const { providerData, documentInput, documentBlockerCodes } =
      await runPrevalidation({
        customer: buildCustomer(),
        items: [
          {
            description: 'Implementación Vendix',
            quantity: 1,
            unit_price: 1190,
            taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: true }],
          },
        ],
      } as CreatePlatformInvoiceDto);

    expect(providerData.taxes).toHaveLength(1);
    const [tax] = providerData.taxes;
    // Fracción 0,19 en el DTO → porcentaje '19.00' en el contrato del emisor.
    expect(tax.tax_rate).toBe('19.00');
    // Base DESPEJADA: 1190 / 1,19 = 1000. La del DTO ni se mira.
    expect(tax.taxable_amount).toBe('1000.00');
    expect(tax.tax_amount).toBe('190.00');
    expect(tax.tax_type).toBe('IVA');

    // Lo que el prevalidador realmente lee: antes llegaba `undefined` / `null`.
    expect(documentInput.taxes?.[0].tax_rate).toBe('19.00');
    expect(documentInput.taxes?.[0].taxable_amount).toBe('1000.00');

    // EL PRECIO TAMBIÉN SE DESPEJA, no sólo la base del tributo. Con el precio
    // bruto la línea declaraba `LineExtensionAmount` 1.190 contra una base de
    // 1.000, y la cabecera cerraba en 1.380 por una venta de 1.190: aritmética
    // internamente consistente, así que la DIAN podía ACEPTAR una factura por
    // un importe que nadie pagó.
    expect(providerData.items[0].unit_price).toBe('1000.000000');
    expect(providerData.items[0].discount_amount).toBe('0.00');
    expect(providerData.subtotal_amount).toBe('1000.00');
    expect(providerData.total_amount).toBe('1190.00');

    expect(
      documentBlockerCodes.filter((code) => TAX_FINDING_CODES.includes(code)),
    ).toEqual([]);
  });

  it('IVA 19 % EXCLUSIVO: la base es el neto de la línea', async () => {
    const { providerData, documentBlockerCodes } = await runPrevalidation({
      customer: buildCustomer(),
      items: [
        {
          description: 'Consultoría fiscal',
          quantity: 1,
          unit_price: 1000,
          taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: false }],
        },
      ],
    } as CreatePlatformInvoiceDto);

    expect(providerData.taxes).toHaveLength(1);
    const [tax] = providerData.taxes;
    expect(tax.tax_rate).toBe('19.00');
    expect(tax.taxable_amount).toBe('1000.00');
    expect(tax.tax_amount).toBe('190.00');

    expect(
      documentBlockerCodes.filter((code) => TAX_FINDING_CODES.includes(code)),
    ).toEqual([]);
  });

  it('línea SIN impuestos: el payload no declara ninguno', async () => {
    const { providerData, documentBlockerCodes } = await runPrevalidation({
      customer: buildCustomer(),
      items: [
        {
          description: 'Servicio excluido art. 476 num. 21 ET',
          quantity: 1,
          unit_price: 1000,
        },
      ],
    } as CreatePlatformInvoiceDto);

    expect(providerData.taxes).toEqual([]);
    expect(providerData.tax_amount).toBe('0.00');
    expect(
      documentBlockerCodes.filter((code) => TAX_FINDING_CODES.includes(code)),
    ).toEqual([]);
  });

  it('el impuesto que viaja cumple `ProviderInvoiceTax`, sin las claves legadas', async () => {
    const { providerData } = await runPrevalidation({
      customer: buildCustomer(),
      items: [
        {
          description: 'Capacitación',
          quantity: 2,
          unit_price: 500,
          taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: false }],
        },
      ],
    } as CreatePlatformInvoiceDto);

    // ASERCIÓN DE TIPO, no de valor: la asignación sólo compila si el array
    // que el servicio construye satisface el contrato del emisor.
    const taxes: ProviderInvoiceTax[] = providerData.taxes;

    // Y la de forma en runtime, que es la que denuncia una regresión al
    // payload legado: `rate` y `is_inclusive` no pertenecen al contrato.
    expect(Object.keys(taxes[0]).sort()).toEqual([
      'tax_amount',
      'tax_name',
      'tax_rate',
      'tax_type',
      'taxable_amount',
    ]);
  });
});

describe('SubscriptionFiscalService · createPlatformInvoice · puerta de pre-emisión', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('con identidad de adquiriente incompleta lanza 400 con `details.blockers`', async () => {
    const { error } = await runPrevalidation({
      customer: {
        ...buildCustomer(),
        // Con dirección, y el carril no sabe mapear código DANE de municipio:
        // `CITY_CODE_REQUIRED` es bloqueante.
        address_line: 'Calle 100 # 15-20',
        city: 'Medellín',
        department_code: '05',
      },
      items: [
        {
          description: 'Implementación Vendix',
          quantity: 1,
          unit_price: 1000,
        },
      ],
    } as CreatePlatformInvoiceDto);

    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    // El mismo 400 que devolvía el `BadRequestException` anterior; lo que
    // cambia es que ahora lleva `error_code` y los bloqueadores donde el
    // filtro global y el frontend saben leerlos.
    expect(exception.getStatus()).toBe(400);

    const body = exception.getResponse() as {
      error_code?: string;
      details?: { blockers?: Array<Record<string, unknown>> };
    };
    expect(body.error_code).toBe('INVOICING_VALIDATE_001');

    const blockers = body.details?.blockers;
    expect(Array.isArray(blockers)).toBe(true);
    expect(blockers?.length).toBeGreaterThan(0);
    // `code`, `problem` y `fix` son lo que `readApiBlockers` (frontend) pinta.
    for (const blocker of blockers ?? []) {
      expect(typeof blocker.code).toBe('string');
      expect(typeof blocker.problem).toBe('string');
      expect(typeof blocker.fix).toBe('string');
    }
    expect(blockers?.some((b) => b.code === 'CITY_CODE_REQUIRED')).toBe(true);
  });

  it('con dirección y código DANE válido no bloquea por CITY_CODE_REQUIRED y viaja en customer_address', async () => {
    const { providerData, error } = await runPrevalidation({
      customer: {
        ...buildCustomer(),
        address_line: 'Calle 100 # 15-20',
        city: 'Medellín',
        city_code: '05001',
        department_code: '05',
      },
      items: [
        {
          description: 'Implementación Vendix',
          quantity: 1,
          unit_price: 1000,
        },
      ],
    } as CreatePlatformInvoiceDto);

    // La pre-validación pasó y llegó al centinela de la transacción
    expect(error).toBe(STOP_AFTER_PREVALIDATION);
    expect(providerData.customer_address).toEqual({
      line: 'Calle 100 # 15-20',
      city: 'Medellín',
      city_code: '05001',
      department_code: '05',
      country_code: 'CO',
    });
  });
});

describe('SubscriptionFiscalService · resoluciones · archivado lógico', () => {
  const unused = {};

  function buildService(model: Record<string, jest.Mock>, tx: unknown = {}) {
    const prisma = {
      withoutScope: () => ({
        invoice_resolutions: model,
        $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
      }),
    };
    const service: SubscriptionFiscalService = Reflect.construct(
      SubscriptionFiscalService,
      [prisma, ...Array(16).fill(unused)],
    );
    const internals = service as unknown as Record<string, jest.Mock>;
    jest.spyOn(internals as never, 'resolvePlatformOrganizationId').mockResolvedValue(1 as never);
    jest.spyOn(internals as never, 'resolvePlatformAccountingEntityId').mockResolvedValue(5 as never);
    jest.spyOn(internals as never, 'getSettings').mockResolvedValue({ environment: 'test' } as never);
    return service;
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('listResolutions excluye archivadas por defecto y las incluye con include_archived', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = buildService({ findMany });

    await service.listResolutions({});
    expect(findMany.mock.calls[0][0].where.archived_at).toBeNull();

    await service.listResolutions({ include_archived: true });
    expect(findMany.mock.calls[1][0].where).not.toHaveProperty('archived_at');
  });

  it('archiveResolution de una resolución inexistente o ajena a plataforma lanza INVOICING_FIND_002', async () => {
    const service = buildService({ findFirst: jest.fn().mockResolvedValue(null) });

    const error = await service.archiveResolution(999, {}).catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      error_code: 'INVOICING_FIND_002',
    });
    expect(archiveResolutionInTx).not.toHaveBeenCalled();
  });

  it('updateResolution sobre una archivada lanza INVOICING_RESOLUTION_016', async () => {
    const service = buildService({
      findFirst: jest.fn().mockResolvedValue({
        ...buildResolutionRow(),
        archived_at: new Date(),
        _count: { invoices: 0 },
      }),
    });

    const error = await service.updateResolution(77, {} as never).catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      error_code: 'INVOICING_RESOLUTION_016',
    });
  });

  it('archiveResolution delega en archiveResolutionInTx dentro de la transacción y devuelve replacement_resolution_id', async () => {
    const current = {
      ...buildResolutionRow(),
      id: 77,
      organization_id: 1,
      archived_at: null,
      _count: { invoices: 0 },
    };
    const tx = { marker: 'tx' };
    const service = buildService(
      { findFirst: jest.fn().mockResolvedValue(current) },
      tx,
    );
    (archiveResolutionInTx as jest.Mock).mockResolvedValue({
      archived: { id: 77, archived_at: new Date() },
      replacement: { id: 78 },
    });

    const result = await service.archiveResolution(77, { replacement_prefix: 'VS2' });

    expect(archiveResolutionInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        resolution: current,
        replacement_prefix: 'VS2',
        organization_id: 1,
      }),
    );
    expect(result).toMatchObject({
      id: 77,
      environment: 'test',
      replacement_resolution_id: 78,
    });
  });

  it('createResolution de credit_note sin resolution_number ni ClTec: rótulo INTERNA-<prefijo>, vigencia de 100 años y desactiva la otra activa', async () => {
    const create = jest
      .fn()
      .mockImplementation(({ data }: any) => Promise.resolve({ id: 100, ...data }));
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([{ id: 7 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      invoice_resolutions: { create, findMany, updateMany },
    };
    const service = buildService({ findFirst }, tx);
    const technicalKeyVault = {
      sealForWrite: (raw: string | null) => ({ technical_key: raw ?? null }),
    };
    (service as any).technicalKeyVault = technicalKeyVault;

    const result: any = await service.createResolution({
      prefix: 'NCP',
      document_type: 'credit_note',
      environment: 'test',
      rango_inicial: 1,
      rango_final: 1000,
    } as never);

    expect(result.resolution_number).toBe('INTERNA-NCP');
    expect(result).toMatchObject({ technical_key_set: false, technical_key_length: 0 });
    expect(result.valid_to.getUTCFullYear()).toBeGreaterThanOrEqual(
      new Date().getUTCFullYear() + 99,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        accounting_entity_id: 5,
        document_type: 'credit_note',
        is_active: true,
        id: { not: 100 },
      },
      data: { is_active: false },
    });
    expect(result.deactivated_resolution_ids).toEqual([7]);

    const conClave = await service
      .createResolution({
        prefix: 'NCQ',
        document_type: 'credit_note',
        environment: 'test',
        rango_inicial: 1,
        rango_final: 1000,
        technical_key: 'a'.repeat(64),
      } as never)
      .catch((e) => e);
    expect((conClave as HttpException).getResponse()).toMatchObject({
      error_code: 'INVOICING_RESOLUTION_008',
    });
  });

  it('updateResolution: editar el prefijo de una nota de plataforma usada lanza INVOICING_RESOLUTION_005', async () => {
    const service = buildService({
      findFirst: jest.fn().mockResolvedValue({
        ...buildResolutionRow(),
        document_type: 'credit_note',
        prefix: 'NCP',
        accounting_entity_id: 5,
        archived_at: null,
        current_number: 3,
        range_from: 1,
        _count: { invoices: 0 },
      }),
    });

    const error = await service
      .updateResolution(77, { prefix: 'NCZ' } as never)
      .catch((e) => e);

    expect((error as HttpException).getResponse()).toMatchObject({
      error_code: 'INVOICING_RESOLUTION_005',
    });
  });
});

describe('SubscriptionFiscalService · resoluciones · revisión F3/F5/F6', () => {
  const unused = {};
  const SECRET = {
    technical_key: 'a'.repeat(40),
    technical_key_encrypted: 'cipher',
    technical_key_fingerprint: 'fp',
  };
  const vault = {
    sealForWrite: (raw: string | null) => ({
      technical_key: raw ?? null,
      technical_key_encrypted: null,
      technical_key_fingerprint: null,
    }),
  };

  function buildService(model: Record<string, jest.Mock>, tx: unknown = {}) {
    const prisma = {
      withoutScope: () => ({
        invoice_resolutions: model,
        $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
      }),
    };
    const service: SubscriptionFiscalService = Reflect.construct(
      SubscriptionFiscalService,
      [prisma, ...Array(16).fill(unused)],
    );
    const internals = service as unknown as Record<string, jest.Mock>;
    jest.spyOn(internals as never, 'resolvePlatformOrganizationId').mockResolvedValue(1 as never);
    jest.spyOn(internals as never, 'resolvePlatformAccountingEntityId').mockResolvedValue(5 as never);
    jest.spyOn(internals as never, 'getSettings').mockResolvedValue({ environment: 'test' } as never);
    (service as any).technicalKeyVault = vault;
    return service;
  }

  afterEach(() => jest.clearAllMocks());

  const expectNoSecrets = (out: any) => {
    expect(out).not.toHaveProperty('technical_key');
    expect(out).not.toHaveProperty('technical_key_encrypted');
    expect(out).not.toHaveProperty('technical_key_fingerprint');
  };

  it('F3-H1: listado, archivado, DELETE, create y update no devuelven la ClTec ni su cifrado', async () => {
    const fila = {
      ...buildResolutionRow(),
      id: 77,
      organization_id: 1,
      archived_at: null,
      _count: { invoices: 0 },
      ...SECRET,
    };
    const tx = {
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      invoice_resolutions: {
        create: jest.fn().mockResolvedValue({ ...fila, is_active: false }),
        update: jest.fn().mockResolvedValue({ ...fila, is_active: false }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
    };
    const service = buildService(
      {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([fila]),
      },
      tx,
    );
    (archiveResolutionInTx as jest.Mock).mockResolvedValue({
      archived: { ...fila, archived_at: new Date() },
      replacement: null,
    });
    jest
      .spyOn(service as any, 'findPlatformResolution')
      .mockResolvedValue(fila);

    const outs = [
      (await service.listResolutions({}))[0],
      await service.archiveResolution(77, {}),
      await service.deleteResolution(77),
      await service.createResolution({
        prefix: 'SETP',
        document_type: 'sales_invoice',
        environment: 'test',
        rango_inicial: 1,
        rango_final: 100,
        technical_key: 'a'.repeat(40),
      } as never),
      await service.updateResolution(77, { rango_final: 500 } as never),
    ];
    for (const out of outs) {
      expectNoSecrets(out);
      expect(out).toMatchObject({ technical_key_set: true, technical_key_length: 40 });
    }
  });

  it('F3-FU1: getStatus no expone la ClTec ni su cifrado en resolution', async () => {
    const fila = {
      ...buildResolutionRow(),
      id: 77,
      organization_id: 1,
      archived_at: null,
      _count: { invoices: 0 },
      ...SECRET,
    };
    const service = buildService({
      findUnique: jest.fn().mockResolvedValue(fila),
    });
    jest
      .spyOn(service as any, 'getSettings')
      .mockResolvedValue({ environment: 'test', invoice_resolution_id: 77 } as never);
    jest.spyOn(service as any, 'countTransmissions').mockResolvedValue(0 as never);
    jest.spyOn(service as any, 'buildSuggestedConfig').mockResolvedValue({} as never);
    jest.spyOn(service as any, 'buildHabilitationReadiness').mockReturnValue({} as never);

    const status: any = await service.getStatus();

    expectNoSecrets(status.resolution);
    expect(status.resolution).toMatchObject({
      technical_key_set: true,
      technical_key_length: 40,
    });
  });

  it('SEC-L1: maskConfig de plataforma tiene el mismo saneo que tienda y organizacion', () => {
    const service = buildService({});
    const out: any = (service as any).maskConfig({
      id: 1,
      software_pin_encrypted: 'enc:pin',
      certificate_password_encrypted: 'enc:pwd',
      certificate_s3_key: 'dian/certs/1/firma.p12',
      certificate_kms_key_id: 'arn:aws:kms:us-east-1:123456789012:key/abc',
      enablement_inherited_from_id: 99,
      last_test_result: { success: true, note_phase: { deferred: [{ xml: '<x/>' }] } },
      enablement_evidence: {
        note_phase: { deferred: [] },
        inheritance: { from_dian_configuration_id: 99, source_environment: 'production' },
      },
    });
    expect(out).not.toHaveProperty('certificate_s3_key');
    expect(out).not.toHaveProperty('certificate_kms_key_id');
    expect(out).not.toHaveProperty('enablement_inherited_from_id');
    expect(out.enablement_inherited).toBe(true);
    expect(out.has_certificate).toBe(true);
    expect(out.certificate_present).toBe(true);
    expect(out.software_pin_encrypted).toBe('****');
    expect(out.certificate_password_encrypted).toBe('****');
    expect(out.last_test_result).toEqual({ success: true });
    expect(out.enablement_evidence).toEqual({
      inheritance: { source_environment: 'production' },
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain('firma.p12');
    expect(json).not.toContain('arn:aws');
    expect(json).not.toContain('from_dian_configuration_id');
  });

  it('F3-H2: listResolutions filtra is_active=false', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = buildService({ findMany });
    await service.listResolutions({ is_active: false });
    expect(findMany.mock.calls[0][0].where.is_active).toBe(false);
  });

  it('F5-H2: createResolution toma la guarda entre cuentas con el tx y lock_in_transaction', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn(),
      invoice_resolutions: {
        create: jest.fn().mockResolvedValue({ id: 1, is_active: true, ...SECRET }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
    };
    const service = buildService({ findFirst: jest.fn().mockResolvedValue(null) }, tx);
    await service.createResolution({
      prefix: 'SETP',
      document_type: 'sales_invoice',
      environment: 'test',
      rango_inicial: 1,
      rango_final: 100,
      technical_key: 'a'.repeat(40),
    } as never);
    expect(assertNoCrossTenantNumberingOverlap).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ lock_in_transaction: true, prefix: 'SETP' }),
    );
  });

  it('F5-H2: updateResolution toma la guarda con el tx y lock_in_transaction', async () => {
    const fila = {
      ...buildResolutionRow(),
      id: 77,
      accounting_entity_id: 5,
      archived_at: null,
      current_number: 0,
      range_from: 1,
      range_to: 100,
      _count: { invoices: 0 },
    };
    const tx = {
      $executeRawUnsafe: jest.fn(),
      invoice_resolutions: {
        update: jest.fn().mockResolvedValue({ ...fila, range_to: 200 }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
    };
    const service = buildService({ findFirst: jest.fn().mockResolvedValue(fila) }, tx);
    await service.updateResolution(77, { rango_final: 200 } as never);
    expect(assertNoCrossTenantNumberingOverlap).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ lock_in_transaction: true, exclude_resolution_id: 77 }),
    );
  });

  it('F6-L2: factura sin uso -> nota limpia la ClTec y rotula el número como interno', async () => {
    const fila = {
      ...buildResolutionRow(),
      id: 77,
      document_type: 'sales_invoice',
      prefix: 'SETP',
      resolution_number: '18760000001',
      accounting_entity_id: 5,
      archived_at: null,
      current_number: 0,
      range_from: 1,
      range_to: 100,
      is_active: true,
      _count: { invoices: 0 },
      ...SECRET,
    };
    const update = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...fila, ...data }));
    const tx = {
      $executeRawUnsafe: jest.fn(),
      invoice_resolutions: { update, findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    };
    const service = buildService({ findFirst: jest.fn().mockResolvedValue(fila) }, tx);
    await service.updateResolution(77, { document_type: 'credit_note' } as never);
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      resolution_number: 'INTERNA-SETP',
      technical_key: null,
      technical_key_encrypted: null,
      technical_key_fingerprint: null,
    });
  });
  it('SEC-2: resolutions-for-emission conserva cltec_status/emittable y no devuelve technical_key_fingerprint', async () => {
    const base = { ...buildResolutionRow(), document_type: 'sales_invoice' };
    const service = buildService({
      findMany: jest.fn().mockResolvedValue([
        { ...base, id: 1, technical_key_fingerprint: 'fp-sha256' },
        { ...base, id: 2, technical_key_fingerprint: null },
      ]),
    });

    const out = await service.listResolutionsForEmission({
      organizationId: 1,
      accountingEntityId: 5,
      documentType: 'sales_invoice',
    });

    const [con, sin] = out.data as any[];
    expect(con).toMatchObject({ id: 1, cltec_status: 'present', emittable: true });
    expect(sin).toMatchObject({ id: 2, cltec_status: 'absent', emittable: false });
    for (const row of out.data) {
      expect(row).not.toHaveProperty('technical_key_fingerprint');
    }
    expect(JSON.stringify(out)).not.toContain('fp-sha256');
    expect(out.meta).toMatchObject({ total: 2, rejected_for_missing_cltec: 1 });
  });
});
