import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import type { NoteSourceInvoiceSnapshot, NoteSourceItemSnapshot } from './note-source-resolver.util';
import { resolveEmittedNoteUnitCodes } from './note-source-xml.util';
import { UBL_NAMESPACES } from '../providers/dian-direct/xml/xml-namespaces';

function sourceItem(overrides: Partial<NoteSourceItemSnapshot> = {}): NoteSourceItemSnapshot {
  return {
    id: 17,
    invoice_id: 90,
    product_id: 4,
    product_variant_id: null,
    description: 'Widget & cable',
    quantity: new Prisma.Decimal('1.25'),
    unit_price: new Prisma.Decimal('100.00'),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal('12.50'),
    total_amount: new Prisma.Decimal('75.00'),
    is_inclusive: false,
    price_unit_quantity: 10,
    unit_code: null,
    account_code: null,
    stock_units_consumed: null,
    serial_numbers_snapshot: null,
    aiu_component: null,
    financial_source_line_id: null,
    ...overrides,
  };
}

function source(items: readonly NoteSourceItemSnapshot[]): NoteSourceInvoiceSnapshot {
  return {
    id: 90,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 3,
    invoice_items: items,
    invoice_taxes: [],
    subtotal_amount: new Prisma.Decimal(0),
    discount_amount: new Prisma.Decimal(0),
    tax_amount: new Prisma.Decimal(0),
    total_amount: new Prisma.Decimal(0),
  };
}

function invoiceXml(lines: string[], namespace = UBL_NAMESPACES.INVOICE): string {
  return `<Invoice xmlns="${namespace}" xmlns:cac="${UBL_NAMESPACES.CAC}" xmlns:cbc="${UBL_NAMESPACES.CBC}">
    ${lines.join('\n')}
  </Invoice>`;
}

function invoiceLine(options: {
  id: string;
  description?: string;
  quantity?: string;
  amount?: string;
  unitCode?: string;
  divisorPrice?: string;
}): string {
  return `<cac:InvoiceLine>
    <cbc:ID>${options.id}</cbc:ID>
    ${options.quantity === undefined ? '' : `<cbc:InvoicedQuantity unitCode="${options.unitCode ?? 'EA'}">${options.quantity}</cbc:InvoicedQuantity>`}
    ${options.amount === undefined ? '' : `<cbc:LineExtensionAmount>${options.amount}</cbc:LineExtensionAmount>`}
    <cac:Item><cbc:Description>${options.description ?? 'Widget &amp; cable'}</cbc:Description></cac:Item>
    ${options.divisorPrice === undefined ? '' : `<cac:Price><cbc:PriceAmount>${options.divisorPrice}</cbc:PriceAmount><cbc:BaseQuantity>10</cbc:BaseQuantity></cac:Price>`}
  </cac:InvoiceLine>`;
}

describe('resolveEmittedNoteUnitCodes', () => {
  it('matches escaped descriptions, fractional quantity and net base; accepts valid raw NIU despite unit-price divisor', () => {
    const sourceInvoice = source([sourceItem()]);
    const xml = invoiceXml([
      invoiceLine({
        id: '1',
        description: 'Widget &amp; cable',
        quantity: '1.250',
        amount: '62.500',
        unitCode: 'NIU',
        divisorPrice: '999999.00',
      }),
    ]);

    expect(resolveEmittedNoteUnitCodes(sourceInvoice, xml)).toEqual(new Map([[17, 'NIU']]));
  });

  it('uses fingerprints rather than XML order or cbc:ID', () => {
    const first = sourceItem({ id: 17, description: 'First', unit_code: null });
    const second = sourceItem({
      id: 29,
      description: 'Second',
      quantity: new Prisma.Decimal('0.5'),
      total_amount: new Prisma.Decimal('50'),
      tax_amount: new Prisma.Decimal(0),
      unit_code: null,
    });
    const xml = invoiceXml([
      invoiceLine({ id: '17', description: 'Second', quantity: '0.50', amount: '50.00', unitCode: 'EA' }),
      invoiceLine({ id: '999', description: 'First', quantity: '1.25', amount: '62.5', unitCode: 'NIU' }),
    ]);

    expect(resolveEmittedNoteUnitCodes(source([first, second]), xml)).toEqual(
      new Map([[17, 'NIU'], [29, 'EA']]),
    );
  });

  it('leaves duplicate source fingerprints unresolved instead of guessing', () => {
    const first = sourceItem({ id: 17, unit_code: null });
    const second = sourceItem({ id: 29, unit_code: 'INVALID' });
    const xml = invoiceXml([
      invoiceLine({ id: '1', quantity: '1.25', amount: '62.50', unitCode: 'NIU' }),
    ]);

    expect(resolveEmittedNoteUnitCodes(source([first, second]), xml).size).toBe(0);
  });

  it('fails closed for malformed XML, DTD/entity declarations, and a non-Invoice root', () => {
    const sourceInvoice = source([sourceItem()]);
    const invalidXml = [
      '<Invoice><cac:InvoiceLine>',
      `<Invoice xmlns="${UBL_NAMESPACES.INVOICE}" xmlns:cac="${UBL_NAMESPACES.CAC}" xmlns:cbc="${UBL_NAMESPACES.CBC}"><cac:InvoiceLine><cbc:InvoicedQuantity unitCode="NIU">1.25</cbc:InvoicedQuantity>`,
      `<!DOCTYPE Invoice [<!ENTITY x "unsafe">]>${invoiceXml([])}`,
      invoiceXml([], UBL_NAMESPACES.CREDIT_NOTE),
    ];

    for (const xml of invalidXml) {
      try {
        resolveEmittedNoteUnitCodes(sourceInvoice, xml);
        fail('expected fail-closed XML rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(VendixHttpException);
        expect((error as VendixHttpException).errorCode).toBe(
          ErrorCodes.INVOICING_NOTE_SOURCE_001.code,
        );
        expect((error as Error).message).not.toContain(xml);
      }
    }
  });

  it('does not return invalid raw XML unit codes', () => {
    const sourceInvoice = source([sourceItem()]);
    const invalidCodes = ['NOT-A-UNIT', ' NIU '];
    for (const unitCode of invalidCodes) {
      expect(
        resolveEmittedNoteUnitCodes(
          sourceInvoice,
          invoiceXml([invoiceLine({ id: '1', quantity: '1.25', amount: '62.50', unitCode })]),
        ).size,
      ).toBe(0);
    }
  });

  it('does not match XML lines missing quantity or line extension amount', () => {
    const sourceInvoice = source([sourceItem()]);
    const missingQuantity = invoiceLine({ id: '1', amount: '62.50', unitCode: 'NIU' });
    const missingAmount = invoiceLine({ id: '2', quantity: '1.25', unitCode: 'NIU' });

    expect(resolveEmittedNoteUnitCodes(sourceInvoice, invoiceXml([missingQuantity, missingAmount])).size).toBe(0);
  });
});
