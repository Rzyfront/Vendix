import { EcommerceInvoiceDataController } from './ecommerce-invoice-data.controller';

describe('EcommerceInvoiceDataController (paso 4: comprobante guest)', () => {
  const TOKEN = 'tok-guest-1';
  const PAYMENT_ID = 895;

  const createController = (overrides: any = {}) => {
    const invoiceDataService = {
      getOrderSummaryByToken: jest.fn(),
      getByToken: jest.fn(),
      submitData: jest.fn(),
      getGuestPaymentReceiptUrl: jest.fn(),
      uploadGuestPaymentReceipt: jest.fn(),
      ...overrides.invoiceDataService,
    };
    // ResponseService real: success(data, message?) envuelve; el stub
    // replica el envelope para que el spec fije el contrato observado.
    const responseService = {
      success: jest.fn((data: any, message?: string) => ({
        success: true,
        ...(message ? { message } : {}),
        data,
      })),
    };
    return {
      controller: new EcommerceInvoiceDataController(
        invoiceDataService as any,
        responseService as any,
      ),
      invoiceDataService,
      responseService,
    };
  };

  it('GET receipt-url delega (token, paymentId) y envuelve en success', async () => {
    const payload = {
      url: 'https://s3/signed',
      expires_at: '2026-09-25T05:16:32.000Z',
      content_type: 'image/png',
    };
    const { controller, invoiceDataService } = createController({
      invoiceDataService: {
        getGuestPaymentReceiptUrl: jest.fn().mockResolvedValue(payload),
      },
    });

    const res = await controller.getGuestPaymentReceiptUrl(TOKEN, PAYMENT_ID);

    expect(invoiceDataService.getGuestPaymentReceiptUrl).toHaveBeenCalledWith(
      TOKEN,
      PAYMENT_ID,
    );
    expect(res).toEqual({ success: true, data: payload });
  });

  it('POST receipt delega (token, paymentId, file) con mensaje ES', async () => {
    const payload = {
      payment_id: PAYMENT_ID,
      has_receipt: true,
      receipt_content_type: 'image/png',
      receipt_uploaded_at: new Date('2026-09-25T05:11:32.000Z'),
    };
    const file = {
      originalname: 'soporte.png',
      mimetype: 'image/png',
      size: 1234,
      buffer: Buffer.from('fake'),
    } as any;
    const { controller, invoiceDataService } = createController({
      invoiceDataService: {
        uploadGuestPaymentReceipt: jest.fn().mockResolvedValue(payload),
      },
    });

    const res = await controller.uploadGuestPaymentReceipt(
      TOKEN,
      PAYMENT_ID,
      file,
    );

    expect(invoiceDataService.uploadGuestPaymentReceipt).toHaveBeenCalledWith(
      TOKEN,
      PAYMENT_ID,
      file,
    );
    expect(res.success).toBe(true);
    expect(res.data).toEqual(payload);
    expect(res.message).toContain('Comprobante recibido');
  });

  it('propaga el 404 ciego del binding sin envolverlo', async () => {
    const blind404 = Object.assign(new Error('Payment not found'), {
      status: 404,
    });
    const { controller } = createController({
      invoiceDataService: {
        getGuestPaymentReceiptUrl: jest.fn().mockRejectedValue(blind404),
      },
    });

    await expect(
      controller.getGuestPaymentReceiptUrl(TOKEN, 999999),
    ).rejects.toBe(blind404);
  });
});
