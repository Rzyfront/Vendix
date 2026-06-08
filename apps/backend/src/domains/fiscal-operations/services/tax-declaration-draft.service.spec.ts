import { RequestContextService } from '@common/context/request-context.service';
import { TaxDeclarationDraftService } from './tax-declaration-draft.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

describe('TaxDeclarationDraftService VAT calculation', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: 2,
    fiscal_scope: 'STORE',
    operating_scope: 'STORE',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
    can_read: true,
    can_write: true,
  } as any;

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = () => {
    let draftData: any;
    let createdLines: any[] = [];
    const tx = {
      tax_declaration_drafts: {
        create: jest.fn().mockImplementation(({ data }) => {
          draftData = { id: 10, ...data };
          return draftData;
        }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => ({
          ...draftData,
          lines: createdLines,
          obligation: null,
          evidence: null,
        })),
      },
      tax_declaration_lines: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation(({ data }) => {
          createdLines = data;
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      invoices: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            invoice_type: 'sales_invoice',
            invoice_number: 'FV1',
            status: 'accepted',
            dian_status: 'accepted',
            supplier_id: null,
            customer_id: 10,
            customer_name: 'Cliente Uno',
            customer_tax_id: '900111222',
            subtotal_amount: 1000,
            issue_date: new Date('2026-03-10T10:00:00.000Z'),
            invoice_taxes: [{ tax_amount: 190 }],
            supplier: null,
          },
          {
            id: 2,
            invoice_type: 'sales_invoice',
            invoice_number: 'FV2',
            status: 'validated',
            dian_status: 'pending',
            supplier_id: null,
            customer_id: 11,
            customer_name: 'Cliente Dos',
            customer_tax_id: '900333444',
            subtotal_amount: 1000,
            issue_date: new Date('2026-03-11T10:00:00.000Z'),
            invoice_taxes: [{ tax_amount: 190 }],
            supplier: null,
          },
          {
            id: 3,
            invoice_type: 'support_document',
            invoice_number: 'DS1',
            status: 'accepted',
            dian_status: 'accepted',
            supplier_id: 50,
            customer_id: null,
            customer_name: null,
            customer_tax_id: null,
            subtotal_amount: 500,
            issue_date: new Date('2026-03-12T10:00:00.000Z'),
            invoice_taxes: [{ tax_amount: 95 }],
            supplier: { name: 'Proveedor Uno', tax_id: '123456789' },
          },
        ]),
      },
      fiscal_rule_sets: { findFirst: jest.fn().mockResolvedValue(null) },
      tax_declaration_drafts: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { logForResource: jest.fn() };

    return {
      service: new TaxDeclarationDraftService(prisma as any, audit as any),
      prisma,
      tx,
      getDraftData: () => draftData,
      getCreatedLines: () => createdLines,
    };
  };

  it('uses only DIAN-accepted fiscal documents and records skipped sources as warnings', async () => {
    const { service, getDraftData, getCreatedLines } = createService();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 3,
      }),
    );

    const draft = getDraftData();
    expect(draft.generated_tax_amount).toBe(190);
    expect(draft.deductible_tax_amount).toBe(95);
    expect(draft.balance_due).toBe(95);
    expect(draft.total_payable).toBe(95);
    expect(draft.source_snapshot).toMatchObject({
      invoice_count: 3,
      counted_invoice_ids: [1, 3],
      skipped_invoice_ids: [2],
    });
    expect(draft.validation_summary).toMatchObject({
      warnings: [
        expect.objectContaining({
          code: 'DIAN_NOT_ACCEPTED',
          invoice_id: 2,
          dian_status: 'pending',
        }),
      ],
    });
    expect(getCreatedLines()).toHaveLength(2);
  });
});
