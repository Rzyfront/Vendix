import { ContractsController } from './contracts.controller';
import {
  contractAlreadyInvoiced,
  contractNotReadyForInvoice,
} from '../invoicing/contract-invoice.errors';

/**
 * D.2 (FB-08, ERR-07) — `POST /store/contracts/:id/invoice` es cableado
 * delgado: delega en `InvoicingService.createInvoiceFromContract` (D.1) y
 * responde `created`. Lo que se prueba aca es el CONTRATO del cableado —
 * que el duplicado 409 `CONTRACT_INVOICE_001` (y el 422/404 del servicio)
 * SALGA del handler para que `AllExceptionsFilter` lo emita con su status
 * real, en vez de tragarse en un `try/catch` (ver skill
 * `vendix-error-handling`: `responseService.error` responderia 200).
 */
describe('D.2 · POST /store/contracts/:id/invoice', () => {
  const createController = (overrides: any = {}) => {
    const invoicingService = {
      createInvoiceFromContract: jest.fn(),
      ...overrides.invoicing,
    } as any;
    const responseService = {
      created: jest.fn((data: unknown, message: string) => ({
        data,
        message,
      })),
    } as any;
    const controller = new ContractsController(
      {} as any,
      invoicingService,
      responseService,
    );
    return { controller, invoicingService, responseService };
  };

  it('delega en createInvoiceFromContract y responde created', async () => {
    const invoice = { id: 9, invoice_number: 'FV-9', contract_id: 7 };
    const { controller, invoicingService, responseService } =
      createController();
    invoicingService.createInvoiceFromContract.mockResolvedValue(invoice);

    const result = await controller.createInvoiceFromContract(7);

    expect(invoicingService.createInvoiceFromContract).toHaveBeenCalledWith(7);
    expect(responseService.created).toHaveBeenCalledWith(
      invoice,
      'Factura creada exitosamente',
    );
    expect(result).toEqual({
      data: invoice,
      message: 'Factura creada exitosamente',
    });
  });

  it('el duplicado 409 CONTRACT_INVOICE_001 sale del handler (no se traga)', async () => {
    const { controller, invoicingService, responseService } =
      createController();
    invoicingService.createInvoiceFromContract.mockRejectedValue(
      contractAlreadyInvoiced(7, 9, 'FV-9'),
    );

    await expect(controller.createInvoiceFromContract(7)).rejects.toMatchObject(
      { errorCode: 'CONTRACT_INVOICE_001' },
    );
    expect(responseService.created).not.toHaveBeenCalled();
  });

  it('el 422 de contrato no-active tambien propaga intacto', async () => {
    const { controller, invoicingService, responseService } =
      createController();
    invoicingService.createInvoiceFromContract.mockRejectedValue(
      contractNotReadyForInvoice(7, 'draft'),
    );

    await expect(controller.createInvoiceFromContract(7)).rejects.toMatchObject(
      { errorCode: 'CONTRACT_STATUS_001' },
    );
    expect(responseService.created).not.toHaveBeenCalled();
  });
});
