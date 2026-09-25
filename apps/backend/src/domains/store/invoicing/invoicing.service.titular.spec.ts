import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import { ErrorCodes } from 'src/common/errors';

/**
 * BE-2 paso 6 — contrato de titular de facturas.
 *
 * - PATCH customer_id solo en draft: en emitida se rechaza con
 *   INVOICING_STATUS_002 indicando nota crédito como vía de corrección.
 * - En draft, el cambio de titular refresca el snapshot del adquiriente
 *   desde la ficha del nuevo cliente; los campos explícitos del PATCH ganan.
 */
describe('InvoicingService — contrato titular (BE-2)', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const draftInvoice: any = {
    id: 10,
    status: 'draft',
    invoice_type: 'sales_invoice',
    financial_account_id: null,
    accounting_entity_id: 3,
    issue_date: new Date('2026-09-01T00:00:00Z'),
    customer_id: 12,
    customer_name: 'Viejo Titular',
    customer_tax_id: '111',
    invoice_items: [],
    invoice_taxes: [],
    tax_amount: 0,
  };

  const newCustomer = {
    first_name: 'Nuevo',
    last_name: 'Titular',
    legal_name: null,
    email: 'nuevo@example.com',
    phone: '3009990000',
    document_type: 'CC',
    document_number: '1020304050',
    verification_digit: null,
    fiscal_responsibilities: ['O-13'],
  };

  const createService = () => {
    const prisma: any = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue({ ...draftInvoice }),
        update: jest.fn().mockImplementation(({ data }) => ({
          ...draftInvoice,
          ...data,
        })),
      },
      users: { findFirst: jest.fn() },
      fiscal_close_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new InvoicingService(
      prisma,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  };

  it('cambio de titular en draft refresca el snapshot del adquiriente', async () => {
    const { service, prisma } = createService();
    prisma.users.findFirst
      .mockResolvedValueOnce({ id: 217 })
      .mockResolvedValueOnce({ ...newCustomer });

    const result: any = await RequestContextService.run(requestContext, () =>
      service.update(10, { customer_id: 217 } as any),
    );

    expect(prisma.invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
        data: expect.objectContaining({
          customer_id: 217,
          customer_name: 'Nuevo Titular',
          customer_tax_id: '1020304050',
          customer_document_type: 'CC',
          customer_email: 'nuevo@example.com',
          customer_phone: '3009990000',
          customer_fiscal_responsibilities: ['O-13'],
        }),
      }),
    );
    expect(result.customer_id).toBe(217);
  });

  it('un campo explícito del PATCH gana al refresco del snapshot', async () => {
    const { service, prisma } = createService();
    prisma.users.findFirst
      .mockResolvedValueOnce({ id: 217 })
      .mockResolvedValueOnce({ ...newCustomer });

    await RequestContextService.run(requestContext, () =>
      service.update(10, {
        customer_id: 217,
        customer_email: 'override@example.com',
      } as any),
    );

    expect(prisma.invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customer_id: 217,
          customer_email: 'override@example.com',
          customer_name: 'Nuevo Titular',
        }),
      }),
    );
  });

  it.each(['validated', 'accepted', 'sent'])(
    'cambio de titular en emitida (status=%s) exige nota crédito',
    async (status) => {
      const { service, prisma } = createService();
      prisma.invoices.findFirst.mockResolvedValue({
        ...draftInvoice,
        status,
      });
      const err: any = await RequestContextService.run(
        requestContext,
        () =>
          service.update(10, { customer_id: 217 } as any).then(
            () => null,
            (e) => e,
          ),
      );
      expect(err).not.toBeNull();
      expect(err.errorCode).toBe(ErrorCodes.INVOICING_STATUS_002.code);
      expect(String(err.getResponse()?.message || '')).toMatch(
        /nota cr.dito/i,
      );
      expect(prisma.invoices.update).not.toHaveBeenCalled();
    },
  );

  it('titular a null en draft limpia el snapshot huérfano', async () => {
    const { service, prisma } = createService();
    await RequestContextService.run(requestContext, () =>
      service.update(10, { customer_id: null } as any),
    );
    // assertCustomerResolvable retorna early con null: un solo findFirst (el
    // snapshot no consulta porque no hay ficha que leer).
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customer_id: null,
          customer_name: null,
          customer_tax_id: null,
        }),
      }),
    );
  });
});
