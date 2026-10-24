import { InvoicingService } from './invoicing.service';

async function expectNoteSourceError(
  promise: Promise<unknown>,
  details: Record<string, unknown>,
) {
  let caught: any;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(caught.errorCode).toBe('INVOICING_NOTE_SOURCE_001');
  expect(caught.getResponse().details).toMatchObject(details);
}

describe('InvoicingService generic note bypass guards', () => {
  function createService() {
    // Exercise the public method's first guard without constructing the many
    // unrelated collaborators used by ordinary invoice creation and editing.
    const service = Object.create(InvoicingService.prototype) as InvoicingService;
    (service as any).getContext = jest.fn(() => {
      throw new Error('generic note route must reject before reading context');
    });
    (service as any).assertInvoicingAreaActive = jest.fn();
    (service as any).findOne = jest.fn();
    (service as any).prisma = {
      invoices: { update: jest.fn(), create: jest.fn() },
    };
    return service;
  }

  it.each(['credit_note', 'debit_note'] as const)(
    'rejects generic create for %s before context, customer, or number side effects',
    async (invoice_type) => {
      const service = createService();
      await expectNoteSourceError(service.create({ invoice_type } as any), {
        invoice_type,
        required_route: `/store/invoicing/${invoice_type === 'credit_note' ? 'credit-notes' : 'debit-notes'}`,
      });
      expect((service as any).getContext).not.toHaveBeenCalled();
      expect((service as any).assertInvoicingAreaActive).not.toHaveBeenCalled();
      expect((service as any).prisma.invoices.create).not.toHaveBeenCalled();
      expect((service as any).prisma.invoices.update).not.toHaveBeenCalled();
    },
  );

  it('rejects every generic patch of an existing note, including an empty patch', async () => {
    const service = createService();
    (service as any).findOne.mockResolvedValue({
      id: 51,
      invoice_type: 'credit_note',
      status: 'draft',
      contract_id: null,
      financial_account_id: null,
    });

    await expectNoteSourceError(service.update(51, {} as any), {
      invoice_id: 51,
      required_route: '/store/invoicing/credit-notes',
    });
    expect((service as any).prisma.invoices.update).not.toHaveBeenCalled();
  });

  it('rejects a generic patch attempting to change a sales invoice into a note', async () => {
    const service = createService();
    (service as any).findOne.mockResolvedValue({
      id: 52,
      invoice_type: 'sales_invoice',
      status: 'draft',
      contract_id: null,
      financial_account_id: null,
    });

    await expectNoteSourceError(service.update(52, { invoice_type: 'debit_note' } as any), {
      attempted_invoice_type: 'debit_note',
      required_route: '/store/invoicing/debit-notes',
    });
    expect((service as any).prisma.invoices.update).not.toHaveBeenCalled();
  });
});
