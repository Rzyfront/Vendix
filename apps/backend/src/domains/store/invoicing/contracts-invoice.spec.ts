import { InvoicingService } from './invoicing.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { buildContractSnapshot } from '../contracts/contracts-snapshot';
import { buildQuotationContractEconomicSnapshot } from '../quotations/quotation-contract-economics';
import { buildDefaultAiuProfileConfig } from './profiles/invoice-profile-config.contract';
import { buildContractAiuDraft } from './contract-invoice';

describe('facturación desde contrato · snapshot económico', () => {
  const profile = {
    profile_id: 4,
    version: 2,
    config: { aiu: { regime: 'et_462_1' } },
  };

  const serviceWith = (historicalConfig = profile.config) => {
    const service = Object.create(InvoicingService.prototype) as any;
    service.prisma = {
      invoice_profiles: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, operation_type: '01', state: 'inactive' }),
      },
      invoice_profile_versions: {
        findFirst: jest.fn().mockResolvedValue({
          version: 2,
          config: historicalConfig,
        }),
      },
    };
    return service;
  };

  it('acepta sólo la versión histórica cuyo JSON coincide con la cotización', async () => {
    const service = serviceWith({ aiu: { regime: 'et_462_1' } });
    await expect(service.assertFrozenContractInvoiceProfile(profile)).resolves.toBeUndefined();
    expect(service.prisma.invoice_profiles.findFirst).toHaveBeenCalledWith({
      where: { id: 4 },
      select: { id: true },
    });
    expect(service.prisma.invoice_profile_versions.findFirst).toHaveBeenCalledWith({
      where: { profile_id: 4, version: 2 },
      select: { version: true, config: true },
    });
  });

  it('rechaza deriva de versión histórica aunque el perfil actual se haya editado', async () => {
    const service = serviceWith({ aiu: { regime: 'decreto_1372_1992' } });
    await expect(service.assertFrozenContractInvoiceProfile(profile)).rejects.toMatchObject({
      errorCode: 'INVOICING_CALC_001',
    });
    expect(service.prisma.invoice_profiles.findFirst.mock.calls[0][0]).toEqual({
      where: { id: 4 },
      select: { id: true },
    });
  });

  it('detecta cualquier diferencia al recalcular la factura congelada', () => {
    const calculator = new InvoiceCalculatorService();
    const result = calculator.calculate({
      items: [
        {
          description: 'Trabajo',
          quantity: 1,
          unit_price: '111.12',
          aiu_component: 'contrato',
          taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
        },
      ],
    } as any);
    const service = Object.create(InvoicingService.prototype) as any;

    expect(() =>
      service.assertContractCalculationMatchesFrozen(result, result, 3),
    ).not.toThrow();
    const modified = JSON.parse(JSON.stringify(result));
    modified.totals.total_amount = '1.00';
    expect(() =>
      service.assertContractCalculationMatchesFrozen(modified, result, 3),
    ).toThrow(/totals.total_amount/);
  });

  it('conecta snapshot económico de cotización → contrato → borrador sin alterar shape', () => {
    const config = buildDefaultAiuProfileConfig('Obra contractual');
    config.aiu!.accounting_model = 'no_sumada';
    config.dian.header_notes = ['Nota congelada del perfil'];
    const quoteEconomic = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-10T12:00:00.000Z',
      invoice_profile: {
        profile_id: 81,
        version: 4,
        name: 'AIU cliente',
        config,
      },
      quotation_profile: null,
      contract_object: 'Construcción y adecuación de bodega industrial',
      due_date: '2026-12-31',
      cost_lines: [
        {
          description: 'Mano de obra',
          quantity: '1',
          unit_price: '100.00',
          discount_amount: '0.00',
          unit_code: '94',
        },
      ],
    });
    const quote = {
      id: 8,
      quotation_number: 'QT-8',
      destination: 'contract',
      status: 'accepted',
      subtotal_amount: quoteEconomic.contract_value,
      discount_amount: '0.00',
      tax_amount: quoteEconomic.calculation.totals.tax_amount,
      grand_total: quoteEconomic.calculation.totals.total_amount,
      valid_until: null,
      notes: 'Condiciones acordadas en versión 4.',
      terms_and_conditions: `Pago contra entrega de cada hito.${' Detalle contractual completo.'.repeat(30)}`,
      accepted_at: '2026-10-10T12:00:00.000Z',
      quotation_items: [],
      contract_economic_snapshot: quoteEconomic,
    };
    const contractSnapshot = buildContractSnapshot(quote);
    quote.notes = 'NOTA EDITADA DESPUÉS DE ACEPTAR';
    quote.terms_and_conditions = 'TÉRMINOS EDITADOS DESPUÉS DE ACEPTAR';

    expect((contractSnapshot.economic as any).schema_version).toBe(1);
    const draft = buildContractAiuDraft(
      contractSnapshot as any,
      'CT-8',
      8,
    );
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].aiu_component).toBe('contrato');
    expect(draft.lines[0].unit_price).toBe(Number(quoteEconomic.contract_value));
    expect(draft.economic.calculation).toEqual(quoteEconomic.calculation);
    expect(draft.agreed_notes).toBe('Condiciones acordadas en versión 4.');
    expect(draft.terms_and_conditions).toBe(
      `Pago contra entrega de cada hito.${' Detalle contractual completo.'.repeat(30)}`,
    );
    expect(draft.contract_object).toBe(
      'Construcción y adecuación de bodega industrial',
    );
    expect(draft.due_date).toBe('2026-12-31');
    // Contract notes/terms survive only through the immutable relationship
    // snapshot; they are not folded into the 500-character DIAN cbc:Note.
    expect((contractSnapshot as any).quotation.terms_and_conditions).toBe(
      draft.terms_and_conditions,
    );
    expect(config.dian.header_notes).toEqual(['Nota congelada del perfil']);
  });
});
