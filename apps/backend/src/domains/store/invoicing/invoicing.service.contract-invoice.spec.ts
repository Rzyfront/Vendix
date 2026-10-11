import { VendixHttpException } from 'src/common/errors';
import { buildContractAiuDraft } from './contract-invoice';

describe('buildContractAiuDraft · economía congelada', () => {
  const economic = () => ({
    schema_version: 1,
    invoice_profile: {
      profile_id: 7,
      version: 3,
      config: {
        aiu: {
          regime: 'et_462_1',
          taxable_basis: 'aiu',
          components_basis: 'aiu',
          components: { administracion: '5', imprevistos: '2', utilidad: '3' },
          minimum_percent: '10',
          enforce_minimum: true,
        },
        accounting: {
          revenue_account_by_bucket: { costo: '4135', administracion: '4140' },
        },
      },
    },
    invoice_lines: [
      {
        description: 'Mano de obra + administración',
        quantity: '1',
        unit_price: '111.12',
        discount_amount: '0.00',
        unit_code: 'EA',
        bucket: 'contrato',
        aiu_component: 'contrato',
        taxes: [{ tax_name: 'IVA', tax_rate: '19', tax_type: 'iva', is_inclusive: false }],
      },
    ],
    calculation: { lines: [{ line_extension_amount: '111.12' }] },
    direct_cost: '100.00',
    contract_value: '111.12',
    aiu_value: '11.12',
    contract_object: 'Construcción y adecuación de bodega industrial.',
    due_date: '2026-12-31',
  });

  it('mantiene la línea cotizada exacta, sin recrear modo, tarifas ni A/I/U', () => {
    const draft = buildContractAiuDraft({ economic: economic() }, 'CT-1', 1);

    expect(draft.lines).toEqual([
      {
        description: 'Mano de obra + administración',
        quantity: 1,
        unit_price: 111.12,
        discount_amount: 0,
        aiu_component: 'contrato',
        unit_code: 'EA',
        account_code: '4135',
        taxes: [
          { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva', is_inclusive: false },
        ],
      },
    ]);
    expect(draft.invoice_profile.version).toBe(3);
    expect(draft.contract_object).toBe(economic().contract_object);
    expect(draft.due_date).toBe('2026-12-31');
  });

  it('bloquea acuerdos legacy sin snapshot.economic antes de emitir', () => {
    expect(() => buildContractAiuDraft({} as any, 'CT-1', 1)).toThrow(
      VendixHttpException,
    );
    try {
      buildContractAiuDraft({} as any, 'CT-1', 1);
    } catch (error: any) {
      expect(error.errorCode).toBe('INVOICING_CALC_001');
      expect(error.getResponse().message).toContain('nueva revisión');
    }
  });

  it('exige objeto explícito acordado; nunca toma notas como fallback', () => {
    const frozen = economic() as any;
    delete frozen.contract_object;
    expect(() =>
      buildContractAiuDraft({ economic: frozen }, 'CT-1', 1),
    ).toThrow(VendixHttpException);
  });

  it('bloquea referencias a precio vivo de catálogo', () => {
    const frozen = economic() as any;
    frozen.invoice_lines[0].product_id = 99;
    expect(() =>
      buildContractAiuDraft({ economic: frozen }, 'CT-1', 1),
    ).toThrow(/precio de catálogo vivo/);
  });

  it.each([
    ['quantity', null],
    ['unit_price', null],
    ['unit_price', ''],
    ['tax_rate', null],
    ['tax_rate', ''],
  ])('rechaza %s ausente/vacío en vez de convertirlo silenciosamente a cero', (field, value) => {
    const frozen = economic() as any;
    if (field === 'tax_rate') frozen.invoice_lines[0].taxes[0].tax_rate = value;
    else frozen.invoice_lines[0][field] = value;

    expect(() => buildContractAiuDraft({ economic: frozen }, 'CT-1', 1)).toThrow(
      VendixHttpException,
    );
  });

  it('acepta el descuento omitido como cero, pero no descuento null explícito', () => {
    const omitted = economic() as any;
    delete omitted.invoice_lines[0].discount_amount;
    expect(buildContractAiuDraft({ economic: omitted }, 'CT-1', 1).lines[0].discount_amount).toBe(0);

    const explicitNull = economic() as any;
    explicitNull.invoice_lines[0].discount_amount = null;
    expect(() => buildContractAiuDraft({ economic: explicitNull }, 'CT-1', 1)).toThrow(
      VendixHttpException,
    );
  });
});
