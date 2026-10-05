import { create } from 'xmlbuilder2';

import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import {
  FiscalDocumentValidationInput,
  FiscalDocumentValidator,
} from '../../../store/invoicing/validators/fiscal-document.validator';
import { ProviderInvoiceData } from '../../../store/invoicing/providers/invoice-provider.interface';
import { UblCommonBuilder } from '../../../store/invoicing/providers/dian-direct/xml/ubl-common.builder';
import { DianTotalsValidator } from '../../../store/invoicing/providers/dian-direct/xml/dian-totals.validator';
import { UBL_NAMESPACES } from '../../../store/invoicing/providers/dian-direct/xml/xml-namespaces';
import { InvoiceCalculatorService } from '../../../store/invoicing/services/invoice-calculator.service';

/**
 * FACTURA DE PLATAFORMA CON DESCUENTO DE LÍNEA.
 *
 * ## El defecto
 *
 * `buildPlatformProviderData` declaraba el descuento de cabecera como la suma
 * de los descuentos CAPTURADOS en el DTO. En una línea con impuesto incluido
 * `createPlatformInvoice` despeja precio y descuento (`clearInclusiveLine`):
 * los 10.000 capturados viajan en la línea como 8.403,36. El remanente
 * (1.596,64) lo leían `FiscalDocumentValidator.computeTotals` y
 * `UblCommonBuilder.documentDiscount` como un descuento DE PIE adicional, así
 * que el XML descontaba dos veces y la puerta de pre-emisión cortaba con
 * `INVOICING_VALIDATE_001` / `PAYABLE_AMOUNT_MISMATCH` («el documento declara
 * un total de 109999.99, pero sus propias partes dan 108403.35»).
 *
 * ## Cómo se ejercita
 *
 * La ruta real hasta la puerta de pre-emisión (mismo arnés que
 * `subscription-fiscal.service.spec.ts`), y el payload resultante se pasa por
 * el MISMO builder UBL y por `DianTotalsValidator`, que es la compuerta que
 * corre antes de firmar. La referencia del riel tienda es
 * `InvoiceCalculatorService`, que produce los totales que tienda persiste.
 */

const STOP_AFTER_PREVALIDATION = new Error('__stop_after_prevalidation__');
const TECHNICAL_KEY = 'a'.repeat(64);

interface PlatformFiscalInternals {
  getSettings(): Promise<unknown>;
  buildPlatformProviderData(...args: never[]): ProviderInvoiceData;
}

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

async function runPrevalidation(items: CreatePlatformInvoiceDto['items']) {
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
  const unused = {};
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
      { reveal: () => TECHNICAL_KEY },
      identityValidator,
      documentValidator,
      unused,
      unused,
    ],
  );
  const internals = service as unknown as PlatformFiscalInternals;
  jest.spyOn(internals, 'getSettings').mockResolvedValue({
    is_enabled: true,
    platform_organization_id: 1,
    accounting_entity_id: 5,
    dian_configuration_id: 9,
    invoice_resolution_id: 77,
  });
  const builderSpy = jest.spyOn(internals, 'buildPlatformProviderData');
  const documentSpy = jest.spyOn(documentValidator, 'validate');

  let error: unknown = null;
  try {
    await service.createPlatformInvoice({
      customer: {
        legal_name: 'Comercializadora Andina S.A.S.',
        tax_id: '902056589',
        tax_id_dv: '9',
        email: 'facturacion@andina.co',
        document_type: '31',
        person_type: '1',
        tax_regime_code: '48',
        fiscal_responsibilities: ['O-13'],
      },
      items,
    } as CreatePlatformInvoiceDto);
  } catch (caught) {
    error = caught;
  }

  const providerData = builderSpy.mock.results[0].value as ProviderInvoiceData;
  const documentInput = documentSpy.mock.calls[0][0] as FiscalDocumentValidationInput;
  const documentResult = documentSpy.mock.results[0].value;
  return {
    providerData,
    documentInput,
    blockerCodes: documentResult.blockers.map((f: { code: string }) => f.code),
    computed: documentResult.computed,
    error,
  };
}

/** Emite el documento en el orden de `ubl-invoice.builder.ts` y lo valida. */
function emitAndValidate(data: ProviderInvoiceData) {
  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(
    UBL_NAMESPACES.INVOICE,
    'Invoice',
    {
      'xmlns:cac': UBL_NAMESPACES.CAC,
      'xmlns:cbc': UBL_NAMESPACES.CBC,
      'xmlns:ext': UBL_NAMESPACES.EXT,
    },
  );
  UblCommonBuilder.buildDocumentAllowanceCharge(doc, data as any, 'COP');
  UblCommonBuilder.buildTaxTotals(doc, data.taxes, 'COP');
  UblCommonBuilder.buildLegalMonetaryTotal(doc, data as any, 'COP');
  UblCommonBuilder.buildInvoiceLines(doc, data.items as any, data.taxes, 'COP');
  const xml = doc.end({ prettyPrint: false });

  const totals: Record<string, string> = {};
  const group = xml.match(
    /<cac:LegalMonetaryTotal>(.*?)<\/cac:LegalMonetaryTotal>/,
  );
  for (const n of (group?.[1] ?? '').matchAll(
    /<cbc:(\w+) currencyID="COP">([^<]*)<\/cbc:\1>/g,
  )) {
    totals[n[1]] = n[2];
  }
  const documentAllowances = (
    xml.replace(/<cac:InvoiceLine>.*?<\/cac:InvoiceLine>/g, '').match(
      /<cac:AllowanceCharge>/g,
    ) ?? []
  ).length;
  const result = DianTotalsValidator.validate(xml);
  return {
    totals,
    documentAllowances,
    violations: result.violations.map((v) => `${v.rule}: ${v.message}`),
  };
}

/** Totales que el riel tienda persiste para los mismos números. */
function storeTotals(taxes: Array<{ rate: number; is_inclusive: boolean }>) {
  const calc = new InvoiceCalculatorService().calculate({
    items: [
      {
        description: 'Servicio',
        quantity: 3,
        unit_price: 40000,
        discount_amount: 10000,
        is_inclusive: taxes.some((t) => t.is_inclusive),
        taxes: taxes.map((t) => ({
          tax_name: 'IVA',
          tax_type: 'iva',
          tax_rate: t.rate * 100,
          is_inclusive: t.is_inclusive,
        })),
      },
    ],
  } as any);
  return calc.totals;
}

const LINE = {
  description: 'Servicio',
  quantity: 3,
  unit_price: 40000,
  discount_amount: 10000,
  unit_code: 'NIU',
};

describe('createPlatformInvoice · descuento de línea (3 × 40.000 − 10.000)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('SIN impuestos: emite y cuadra igual que el riel tienda', async () => {
    const r = await runPrevalidation([{ ...LINE, taxes: [] }]);

    expect(r.blockerCodes).toEqual([]);
    expect(r.error).toBe(STOP_AFTER_PREVALIDATION);
    expect(r.providerData.subtotal_amount).toBe('110000.00');
    expect(r.providerData.discount_amount).toBe('10000.00');
    expect(r.providerData.total_amount).toBe('110000.00');
    expect(r.computed.allowance_total_amount).toBe('0.00');

    const store = storeTotals([]);
    expect(r.providerData.subtotal_amount).toBe(store.total_before_tax);
    expect(r.providerData.discount_amount).toBe(store.discount_amount);
    expect(r.providerData.total_amount).toBe(store.total_amount);

    const xml = emitAndValidate(r.providerData);
    expect(xml.violations).toEqual([]);
    expect(xml.documentAllowances).toBe(0);
    expect(xml.totals.PayableAmount).toBe('110000.00');
  });

  it('IVA 19 % EXCLUSIVO: base = neto, emite y cuadra igual que tienda', async () => {
    const r = await runPrevalidation([
      { ...LINE, taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: false }] },
    ] as CreatePlatformInvoiceDto['items']);

    expect(r.blockerCodes).toEqual([]);
    expect(r.error).toBe(STOP_AFTER_PREVALIDATION);
    expect(r.providerData.taxes[0].taxable_amount).toBe('110000.00');
    expect(r.providerData.tax_amount).toBe('20900.00');
    expect(r.providerData.total_amount).toBe('130900.00');

    const store = storeTotals([{ rate: 0.19, is_inclusive: false }]);
    expect(r.providerData.subtotal_amount).toBe(store.total_before_tax);
    expect(r.providerData.discount_amount).toBe(store.discount_amount);
    expect(r.providerData.tax_amount).toBe(store.tax_amount);
    expect(r.providerData.total_amount).toBe(store.total_amount);

    const xml = emitAndValidate(r.providerData);
    expect(xml.violations).toEqual([]);
    expect(xml.documentAllowances).toBe(0);
    expect(xml.totals.PayableAmount).toBe('130900.00');
  });

  it('IVA 19 % INCLUIDO: el descuento de cabecera es el DESPEJADO, sin descuento de pie fantasma', async () => {
    const r = await runPrevalidation([
      { ...LINE, taxes: [{ tax_type: 'IVA', rate: 0.19, is_inclusive: true }] },
    ] as CreatePlatformInvoiceDto['items']);

    // Antes: ['PAYABLE_AMOUNT_MISMATCH'] y 400 INVOICING_VALIDATE_001.
    expect(r.blockerCodes).toEqual([]);
    expect(r.error).toBe(STOP_AFTER_PREVALIDATION);

    // La línea viaja despejada y la cabecera descuenta EXACTAMENTE lo mismo.
    expect(r.providerData.items[0].discount_amount).toBe('8403.36');
    expect(r.providerData.discount_amount).toBe('8403.36');
    expect(r.documentInput.discount_amount).toBe('8403.36');
    expect(r.computed.allowance_total_amount).toBe('0.00');
    expect(r.providerData.subtotal_amount).toBe(r.computed.line_extension_amount);
    expect(r.providerData.total_amount).toBe(r.computed.payable_amount);

    const xml = emitAndValidate(r.providerData);
    expect(xml.violations).toEqual([]);
    // Ningún `cac:AllowanceCharge` de documento: antes salía uno por 1.596,64.
    expect(xml.documentAllowances).toBe(0);
    expect(xml.totals.AllowanceTotalAmount).toBe('0.00');
    expect(xml.totals.PayableAmount).toBe(r.providerData.total_amount);

    // Contra tienda: la base y el total quedan a ≤ 1 centavo. La diferencia
    // residual es de REDONDEO del despeje (la plataforma redondea base y cuota;
    // tienda busca la base que cierra exacto con cuotas truncadas), no del
    // descuento — ver el reporte del fix.
    const store = storeTotals([{ rate: 0.19, is_inclusive: true }]);
    expect(
      Math.abs(Number(r.providerData.total_amount) - Number(store.total_amount)),
    ).toBeLessThanOrEqual(0.01);
    expect(
      Math.abs(
        Number(r.providerData.subtotal_amount) - Number(store.total_before_tax),
      ),
    ).toBeLessThanOrEqual(0.01);
  });
});
