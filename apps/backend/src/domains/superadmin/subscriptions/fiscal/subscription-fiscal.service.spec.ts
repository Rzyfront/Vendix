import { HttpException } from '@nestjs/common';

import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import {
  FiscalDocumentValidationInput,
  FiscalDocumentValidator,
} from '../../../store/invoicing/validators/fiscal-document.validator';
import {
  ProviderInvoiceData,
  ProviderInvoiceTax,
} from '../../../store/invoicing/providers/invoice-provider.interface';

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
});
