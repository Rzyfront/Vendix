import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { ManualReceivedDocumentDto } from './received-document.dto';

const manualPayload = (tax: Record<string, unknown>) => ({
  document_type: 'invoice',
  invoice_number: 'F-100',
  issuer_tax_id: '900123456',
  issuer_name: 'Proveedor SAS',
  receiver_tax_id: '800123456',
  receiver_name: 'Comprador SAS',
  issue_date: '2026-09-30',
  currency: 'COP',
  subtotal_amount: '100.00',
  discount_amount: '0.00',
  tax_amount: '1.00',
  total_amount: '101.00',
  taxes: [],
  items: [{
    description: 'Bebida',
    quantity: '1',
    unit_price: '100.00',
    discount_amount: '0.00',
    net_amount: '100.00',
    total_amount: '101.00',
    taxes: [tax],
  }],
});

function nestedTaxError(errors: ValidationError[], field: string): ValidationError | undefined {
  const tax = errors.find((error) => error.property === 'items')?.children
    ?.find((error) => error.property === '0')?.children
    ?.find((error) => error.property === 'taxes')?.children
    ?.find((error) => error.property === '0');
  return tax?.children?.find((error) => error.property === field);
}

describe('ReceivedDocumentTaxDto nominal IBUA shape', () => {
  it('whitelists nested nominal facts and accepts omitted rate/base for unit basis', async () => {
    const dto = plainToInstance(ManualReceivedDocumentDto, manualPayload({
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit',
      base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00',
    }));
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
    expect(dto.items[0].taxes?.[0]).toMatchObject({
      tax_basis_type: 'unit', base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10',
    });
  });

  it('accepts explicit null nominal qualifiers on monetary rows', async () => {
    const dto = plainToInstance(ManualReceivedDocumentDto, manualPayload({
      tax_type: 'iva', scheme_code: '01', tax_name: 'IVA', tax_basis_type: 'monetary',
      base_quantity: null, base_unit_code: null, per_unit_amount: null,
      rate: '19', base_amount: '100.00', amount: '19.00',
    }));
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });

  it('rejects nominal source precision beyond Decimal(15,2)', async () => {
    const dto = plainToInstance(ManualReceivedDocumentDto, manualPayload({
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit',
      base_quantity: '1000.001', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00',
    }));
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const baseQuantityError = nestedTaxError(errors, 'base_quantity');
    expect(baseQuantityError?.property).toBe('base_quantity');
    expect(baseQuantityError?.constraints).toHaveProperty('matches');
  });

  it('rejects nominal integer overflow at the exact nested quantity field', async () => {
    const dto = plainToInstance(ManualReceivedDocumentDto, manualPayload({
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit',
      base_quantity: '10000000000000.00', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00',
    }));
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const baseQuantityError = nestedTaxError(errors, 'base_quantity');
    expect(baseQuantityError?.property).toBe('base_quantity');
    expect(baseQuantityError?.constraints).toHaveProperty('matches');
  });

  it('forbids tenant and review-status fields in nested tax DTOs', async () => {
    const dto = plainToInstance(ManualReceivedDocumentDto, manualPayload({
      tax_type: 'ibua', scheme_code: '34', tax_name: 'IBUA', tax_basis_type: 'unit',
      base_quantity: '1000.00', base_unit_code: 'ML', per_unit_amount: '0.10', amount: '1.00',
      organization_id: 7, review_status: 'reviewed', accepted: true,
    }));
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    const taxError = nestedTaxError(errors, 'organization_id');
    expect(taxError?.constraints).toHaveProperty('whitelistValidation');
    expect(nestedTaxError(errors, 'review_status')?.constraints).toHaveProperty('whitelistValidation');
    expect(nestedTaxError(errors, 'accepted')?.constraints).toHaveProperty('whitelistValidation');
  });
});
