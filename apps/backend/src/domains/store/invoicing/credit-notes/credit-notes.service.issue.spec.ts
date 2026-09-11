import { CreditNotesService } from './credit-notes.service';

/**
 * A.1 (`POST :id/issue`) y A.2 (`GET :id/notes`) del plan
 * CP-nc-nd-auto-orden-reembolso.
 *
 * `findFirst → null` representa TANTO fila inexistente COMO fila de otra
 * tienda (el scope las hace indistinguibles a propósito): issue y notes
 * responden 404 en ambos casos, nunca 403 que confirme existencia ajena.
 *
 * F-001: el doble issue concurrente lo frena `validateTransition` — acá se
 * prueba la mitad secuencial (si validate rechaza, send jamás se llama).
 */
describe('CreditNotesService issue/notes (CP-nc-nd-auto-orden-reembolso)', () => {
  function createService(overrides: any = {}) {
    const prisma = {
      invoices: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ...overrides.prisma,
    };

    const invoice_flow = {
      validate: jest.fn().mockImplementation(async (id: number) => ({ id, status: 'validated' })),
      send: jest.fn().mockImplementation(async (id: number) => ({ id, status: 'sent' })),
      ...overrides.invoice_flow,
    };

    const service = new CreditNotesService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      invoice_flow as any,
    );

    return { service, prisma, invoice_flow };
  }

  it('issue sobre nota inexistente responde INVOICING_FIND_001 sin validar ni enviar', async () => {
    const { service, prisma, invoice_flow } = createService({
      prisma: { invoices: { findFirst: jest.fn().mockResolvedValue(null) } },
    });

    const promise = service.issueNote(999);
    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_FIND_001' });
    expect(invoice_flow.validate).not.toHaveBeenCalled();
    expect(invoice_flow.send).not.toHaveBeenCalled();
    expect(prisma.invoices.findFirst).toHaveBeenCalledWith({
      where: { id: 999 },
      select: { id: true, invoice_type: true, status: true },
    });
  });

  it('issue sobre factura de venta responde FISCAL_DOCUMENT_UNSUPPORTED sin efectos', async () => {
    const { service, invoice_flow } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({ id: 7, invoice_type: 'sales_invoice', status: 'draft' }),
        },
      },
    });

    const promise = service.issueNote(7);
    await expect(promise).rejects.toMatchObject({ errorCode: 'FISCAL_DOCUMENT_UNSUPPORTED' });
    expect(invoice_flow.validate).not.toHaveBeenCalled();
    expect(invoice_flow.send).not.toHaveBeenCalled();
  });

  it('issue sobre NC en draft valida y envía en orden y retorna phases', async () => {
    const { service, invoice_flow } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({ id: 5, invoice_type: 'credit_note', status: 'draft' }),
        },
      },
    });

    const order: string[] = [];
    invoice_flow.validate.mockImplementation(async (id: number) => {
      order.push('validate');
      return { id, status: 'validated' };
    });
    invoice_flow.send.mockImplementation(async (id: number) => {
      order.push('send');
      return { id, status: 'sent' };
    });

    const result = await service.issueNote(5);

    expect(order).toEqual(['validate', 'send']);
    expect(invoice_flow.validate).toHaveBeenCalledWith(5);
    expect(invoice_flow.send).toHaveBeenCalledWith(5);
    expect(result).toMatchObject({ phases: { validated: true, sent: true } });
    expect((result as any).invoice).toMatchObject({ id: 5, status: 'sent' });
  });

  it('F-001: si validate rechaza (nota ya emitida), send jamás se llama', async () => {
    const statusError = Object.assign(new Error('ya emitida'), {
      errorCode: 'INVOICING_STATUS_001',
    });
    const { service, invoice_flow } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({ id: 5, invoice_type: 'debit_note', status: 'sent' }),
        },
      },
      invoice_flow: { validate: jest.fn().mockRejectedValue(statusError) },
    });

    const promise = service.issueNote(5);
    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_001' });
    expect(invoice_flow.send).not.toHaveBeenCalled();
  });

  it('notes con factura inexistente responde INVOICING_FIND_001', async () => {
    const { service, prisma } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
        },
      },
    });

    const promise = service.findNotesByRelatedInvoice(999);
    await expect(promise).rejects.toMatchObject({ errorCode: 'INVOICING_FIND_001' });
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
  });

  it('notes filtra por entidad del padre y solo NC/ND ordenadas', async () => {
    const notes = [{ id: 21, invoice_type: 'credit_note' }];
    const findMany = jest.fn().mockResolvedValue(notes);
    const { service } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({ id: 12, accounting_entity_id: 3 }),
          findMany,
        },
      },
    });

    await expect(service.findNotesByRelatedInvoice(12)).resolves.toBe(notes);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          related_invoice_id: 12,
          accounting_entity_id: 3,
          invoice_type: { in: ['credit_note', 'debit_note'] },
        },
        orderBy: { id: 'asc' },
      }),
    );
  });
});
