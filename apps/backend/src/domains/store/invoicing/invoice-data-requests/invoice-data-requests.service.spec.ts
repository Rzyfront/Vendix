import { InvoiceDataRequestsService } from './invoice-data-requests.service';

describe('InvoiceDataRequestsService (nominative conversion)', () => {
  const REQUEST_ID = 7;
  const STORE_ID = 2;
  const ORDER_ID = 30;
  const CUSTOMER_ID = 50;
  const NEW_INVOICE_ID = 901;
  const CREDIT_NOTE_ID = 555;

  const baseRequest = {
    id: REQUEST_ID,
    store_id: STORE_ID,
    order_id: ORDER_ID,
    invoice_id: null,
    token: 'tok-123',
    first_name: 'Ana',
    last_name: 'Diaz',
    document_type: 'CC',
    document_number: '123456',
    email: 'ana@example.com',
    phone: null,
    status: 'submitted',
    order: {
      id: ORDER_ID,
      customer_id: null,
      stores: { organization_id: 1 },
      order_items: [],
    },
  };

  const acceptedInvoice = {
    id: 100,
    status: 'accepted',
    currency: 'COP',
    invoice_items: [
      {
        product_id: 1,
        product_variant_id: null,
        description: 'Prod',
        quantity: 2,
        unit_price: 100,
        discount_amount: 0,
        tax_amount: 38,
      },
    ],
    invoice_taxes: [
      {
        tax_rate_id: 5,
        tax_name: 'IVA 19%',
        tax_rate: 19,
        taxable_amount: 200,
        tax_amount: 38,
        tax_type: 'iva',
      },
    ],
  };

  const createService = (overrides: any = {}) => {
    const prisma = {
      invoice_data_requests: {
        findFirst: jest.fn().mockResolvedValue(baseRequest),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ ...baseRequest, ...data }),
        ),
        ...overrides.invoice_data_requests,
      },
      users: {
        // Existing customer found, skips creation path
        findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
        create: jest.fn(),
        ...overrides.users,
      },
      roles: {
        findFirst: jest.fn().mockResolvedValue({ id: 4, name: 'customer' }),
        ...overrides.roles,
      },
      orders: {
        update: jest.fn().mockResolvedValue({ id: ORDER_ID }),
        ...overrides.orders,
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 100 }),
        ...overrides.invoices,
      },
    };
    const event_emitter = { emit: jest.fn() };
    const invoicing = {
      createFromOrder: jest.fn().mockResolvedValue({ id: NEW_INVOICE_ID }),
      ...overrides.invoicing,
    };
    const credit_notes = {
      createCreditNote: jest.fn().mockResolvedValue({ id: CREDIT_NOTE_ID }),
      ...overrides.credit_notes,
    };
    const invoice_flow = {
      validate: jest.fn().mockImplementation((id: number) =>
        Promise.resolve({ id, status: 'validated' }),
      ),
      send: jest.fn().mockImplementation((id: number) =>
        Promise.resolve({ id, status: 'sent' }),
      ),
      ...overrides.invoice_flow,
    };

    return {
      service: new InvoiceDataRequestsService(
        prisma as any,
        event_emitter as any,
        invoicing as any,
        credit_notes as any,
        invoice_flow as any,
      ),
      prisma,
      event_emitter,
      invoicing,
      credit_notes,
      invoice_flow,
    };
  };

  const completedUpdateCall = (prisma: any) =>
    prisma.invoice_data_requests.update.mock.calls.find(
      ([args]: any[]) => args.data?.status === 'completed',
    );

  it('aborts silently when another worker already claimed the request (CAS count 0)', async () => {
    const { service, prisma, invoicing } = createService({
      invoice_data_requests: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(
      service.processRequest(REQUEST_ID, STORE_ID),
    ).resolves.toBeNull();

    expect(prisma.invoice_data_requests.updateMany).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, status: 'submitted' },
      data: expect.objectContaining({ status: 'processing' }),
    });
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
    expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    expect(prisma.invoice_data_requests.update).not.toHaveBeenCalled();
  });

  it('issues a new nominative invoice (validate + send) when the order has no invoice', async () => {
    const { service, prisma, invoicing, credit_notes, invoice_flow } =
      createService();

    const result = await service.processRequest(REQUEST_ID, STORE_ID);

    expect(invoicing.createFromOrder).toHaveBeenCalledWith(ORDER_ID);
    expect(invoice_flow.validate).toHaveBeenCalledWith(NEW_INVOICE_ID);
    expect(invoice_flow.send).toHaveBeenCalledWith(NEW_INVOICE_ID);
    expect(credit_notes.createCreditNote).not.toHaveBeenCalled();

    const completed = completedUpdateCall(prisma);
    expect(completed).toBeDefined();
    expect(completed[0].data.new_invoice_id).toBe(NEW_INVOICE_ID);
    expect(result?.status).toBe('completed');
  });

  it('updates a draft invoice in place without credit note or new invoice', async () => {
    const { service, prisma, invoicing, credit_notes } = createService({
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          ...acceptedInvoice,
          status: 'draft',
        }),
        update: jest.fn().mockResolvedValue({ id: 100 }),
      },
    });

    await service.processRequest(REQUEST_ID, STORE_ID);

    expect(prisma.invoices.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        customer_id: CUSTOMER_ID,
        customer_name: 'Ana Diaz',
        customer_tax_id: '123456',
      }),
    });
    expect(credit_notes.createCreditNote).not.toHaveBeenCalled();
    expect(invoicing.createFromOrder).not.toHaveBeenCalled();

    const completed = completedUpdateCall(prisma);
    expect(completed[0].data.new_invoice_id).toBe(100);
  });

  it('issues a full mirror credit note + new nominative invoice for an accepted invoice', async () => {
    const { service, prisma, invoicing, credit_notes, invoice_flow } =
      createService({
        invoices: {
          findFirst: jest.fn().mockResolvedValue(acceptedInvoice),
          update: jest.fn(),
        },
      });

    await service.processRequest(REQUEST_ID, STORE_ID);

    expect(credit_notes.createCreditNote).toHaveBeenCalledWith(
      expect.objectContaining({
        related_invoice_id: 100,
        reason: 'Conversión a factura nominativa por solicitud del cliente',
        items: [
          expect.objectContaining({
            description: 'Prod',
            quantity: 2,
            unit_price: 100,
            tax_amount: 38,
          }),
        ],
        taxes: [
          expect.objectContaining({
            tax_name: 'IVA 19%',
            tax_rate: 19,
            taxable_amount: 200,
            tax_amount: 38,
            tax_type: 'iva',
          }),
        ],
      }),
    );
    expect(invoicing.createFromOrder).toHaveBeenCalledWith(ORDER_ID);
    // Both the mirror credit note and the new invoice are validated and sent
    expect(invoice_flow.validate).toHaveBeenCalledWith(CREDIT_NOTE_ID);
    expect(invoice_flow.validate).toHaveBeenCalledWith(NEW_INVOICE_ID);
    expect(invoice_flow.send).toHaveBeenCalledWith(CREDIT_NOTE_ID);
    expect(invoice_flow.send).toHaveBeenCalledWith(NEW_INVOICE_ID);
    // The original invoice is never mutated
    expect(prisma.invoices.update).not.toHaveBeenCalled();

    const completed = completedUpdateCall(prisma);
    expect(completed[0].data.new_invoice_id).toBe(NEW_INVOICE_ID);
  });

  it('defers (reverts to submitted) when the invoice is sent and awaiting DIAN', async () => {
    const { service, prisma, invoicing, credit_notes } = createService({
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          ...acceptedInvoice,
          status: 'sent',
        }),
        update: jest.fn(),
      },
    });

    const result = await service.processRequest(REQUEST_ID, STORE_ID);

    expect(credit_notes.createCreditNote).not.toHaveBeenCalled();
    expect(invoicing.createFromOrder).not.toHaveBeenCalled();
    expect(prisma.invoices.update).not.toHaveBeenCalled();

    expect(prisma.invoice_data_requests.update).toHaveBeenCalledWith({
      where: { id: REQUEST_ID },
      data: expect.objectContaining({ status: 'submitted' }),
    });
    expect(completedUpdateCall(prisma)).toBeUndefined();
    expect(result?.status).toBe('submitted');
  });

  it('still completes the request when the DIAN transmission fails (best-effort send)', async () => {
    const { service, prisma, invoice_flow } = createService({
      invoice_flow: {
        validate: jest.fn().mockResolvedValue({ id: NEW_INVOICE_ID }),
        send: jest.fn().mockRejectedValue(new Error('DIAN timeout')),
      },
    });

    const result = await service.processRequest(REQUEST_ID, STORE_ID);

    expect(invoice_flow.send).toHaveBeenCalledWith(NEW_INVOICE_ID);
    const completed = completedUpdateCall(prisma);
    expect(completed).toBeDefined();
    expect(completed[0].data.new_invoice_id).toBe(NEW_INVOICE_ID);
    expect(result?.status).toBe('completed');
  });
});
