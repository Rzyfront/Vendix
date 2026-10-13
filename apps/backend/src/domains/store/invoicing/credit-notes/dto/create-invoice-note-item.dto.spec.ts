import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateInvoiceNoteItemDto } from './create-invoice-note-item.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});

const validItem = {
  source_invoice_item_id: 12,
  quantity: 1.25,
  unit_price: 2500,
};

const validateItem = (value: Record<string, unknown>) =>
  pipe.transform(value, {
    type: 'body',
    metatype: CreateInvoiceNoteItemDto,
  }) as Promise<CreateInvoiceNoteItemDto>;

describe('CreateInvoiceNoteItemDto', () => {
  it('accepts only the editable note-line contract and trims a DIAN unit code', async () => {
    const result = await validateItem({
      ...validItem,
      discount_amount: '2.50',
      unit_code: ' NIU ',
    });

    expect(result).toBeInstanceOf(CreateInvoiceNoteItemDto);
    expect(result.discount_amount).toBe(2.5);
    expect(result.unit_code).toBe('NIU');
  });

  it('requires a positive integer source line id', async () => {
    await expect(
      validateItem({ ...validItem, source_invoice_item_id: 1.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateItem({ ...validItem, source_invoice_item_id: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['quantity below minimum', { quantity: 0.00001 }],
    ['quantity with excessive scale', { quantity: 1.00001 }],
    ['quantity outside Decimal(12,4)', { quantity: 100000000 }],
    ['non-finite unit price', { unit_price: Number.POSITIVE_INFINITY }],
    ['unit price with excessive scale', { unit_price: 1.001 }],
    ['negative discount', { discount_amount: -0.01 }],
    ['discount outside Decimal(12,2)', { discount_amount: 10000000000 }],
    ['unknown DIAN unit', { unit_code: 'NOT-A-UNIT' }],
  ])('rejects %s', async (_label, replacement) => {
    await expect(validateItem({ ...validItem, ...replacement })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('forbids client-controlled fiscal and unrelated line fields', async () => {
    await expect(
      validateItem({
        ...validItem,
        tax_amount: 100,
        taxes: [{ tax_type: 'IVA', rate: 19 }],
        product_id: 4,
        description: 'client supplied',
        price_unit_quantity: 2,
        account_code: '413595',
        is_inclusive: true,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing required fields', async () => {
    await expect(
      validateItem({ source_invoice_item_id: 12, quantity: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
