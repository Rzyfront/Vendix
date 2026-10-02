import { PayloadTooLargeException } from '@nestjs/common';
import { AccountService } from './account.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from 'src/common/errors';

/**
 * C.8 (R-1 / ADR-06) — regresión permanente para `deriveLineGross`.
 *
 * F-008 (major): `GET /ecommerce/account` (el panel de cuenta del
 * checkout-shell) nunca importó `resolveOrderLineFinals` ni escribió
 * `final_unit_price` — a diferencia de `orders.service.ts#findOne`, que
 * recalcula el bruto en memoria contra las tasas del catálogo en CADA
 * lectura. Para este endpoint, el fallback de ADR-06
 * (`final_unit_price ?? (unit_price + COALESCE(tax_amount_item,0) /
 * line_units)`) es el camino COMÚN, no la excepción: `checkout.service.ts`
 * (F-005) nunca puebla `final_unit_price` al crear la orden.
 *
 * `deriveLineGross` es un método privado y puro (no toca `this.prisma` ni
 * el contexto de request), así que se ejercita instanciando el servicio sin
 * levantar el módulo de Nest — sólo hacen falta stubs para
 * `EcommercePrismaService`/`S3Service`, que este método nunca usa.
 */
describe('AccountService#deriveLineGross — fallback ADR-06', () => {
  const service = new AccountService({} as any, {} as any);
  const deriveLineGross = (item: Record<string, unknown>) =>
    (service as any).deriveLineGross(item);

  it('deriva el bruto desde unit_price + tax_amount_item cuando final_unit_price es null (fila histórica/nunca escrita)', () => {
    // Fila típica de una orden de checkout post-P1: unit_price y
    // total_price ambos NETOS (`total_price = unit_price × quantity`,
    // DB-01), `tax_amount_item` persistido como total DE LA LÍNEA (2
    // unidades), `final_unit_price` NUNCA escrito por este carril (F-005).
    const result = deriveLineGross({
      unit_price: 100,
      total_price: 200, // 100 × 2 (neto, DB-01)
      tax_amount_item: 38, // IVA de LA LÍNEA completa (2 unidades al 19%)
      final_unit_price: null,
      quantity: 2,
    });

    // ADR-06: final_unit_price ausente ⇒ unit_price + tax_amount_item/line_units.
    // line_units cae a `quantity` (no hay price_unit_quantity): 100 + 38/2 = 119.
    expect(result.unit_price_gross).toBe(119);
    // multiplier = netTotal/netUnit = 200/100 = 2 (misma relación que ya
    // vincula total_price con unit_price en la fila, DB-01): 119 × 2 = 238.
    expect(result.line_total_gross).toBe(238);
  });

  it('usa final_unit_price directo cuando SÍ está poblado (no recalcula por encima del valor ya persistido)', () => {
    const result = deriveLineGross({
      unit_price: 100,
      total_price: 200,
      tax_amount_item: 999, // no debe usarse: final_unit_price manda
      final_unit_price: 119,
      quantity: 2,
    });

    expect(result.unit_price_gross).toBe(119);
    expect(result.line_total_gross).toBe(238); // 119 × (200/100)
  });

  it('R-1: el campo aditivo no altera unit_price/total_price — sólo se le añaden al objeto original en el llamador', () => {
    const item = {
      unit_price: 50,
      total_price: 50,
      tax_amount_item: 0,
      final_unit_price: null,
      quantity: 1,
    };
    const result = deriveLineGross(item);

    // deriveLineGross es puro: no muta el item de entrada.
    expect(item.unit_price).toBe(50);
    expect(item.total_price).toBe(50);
    expect(result.unit_price_gross).toBe(50);
    expect(result.line_total_gross).toBe(50);
  });
});

describe('AccountService#kitchenStatusFor — cocina por línea (paridad guest)', () => {
  const service = new AccountService({} as any, {} as any);
  const kitchenStatusFor = (rows: { id: number; status: string }[] | null) =>
    (service as any).kitchenStatusFor(rows);

  it('prefiere la fila in-flight sobre la terminal más reciente', () => {
    expect(
      kitchenStatusFor([
        { id: 79, status: 'delivered' },
        { id: 31, status: 'pending' },
      ]),
    ).toBe('pending');
  });

  it('sin filas in-flight devuelve la más reciente (desc por id)', () => {
    expect(
      kitchenStatusFor([
        { id: 78, status: 'cancelled' },
        { id: 55, status: 'cancelled' },
      ]),
    ).toBe('cancelled');
  });

  it('sin filas (nunca disparado) devuelve null', () => {
    expect(kitchenStatusFor([])).toBeNull();
    expect(kitchenStatusFor(null)).toBeNull();
  });
});

/**
 * Comprobante de transferencia en cuenta (espejo guest/checkout).
 *
 * Mismo contrato que `getGuestPaymentReceiptUrl` /
 * `uploadGuestPaymentReceipt`, con binding por JWT (customer_id +
 * store_id del contexto) en vez de token. El 403 transversal se
 * responde como 404 ciego (`PAY_FIND_001`) para no filtrar existencia.
 */
describe('AccountService#comprobante — visor y subida (espejo guest)', () => {
  const USER_ID = 28;
  const STORE_ID = 5;
  const ORDER_ID = 95;
  const PAYMENT_ID = 63;

  const basePayment = (overrides: any = {}) => ({
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    state: 'pending',
    receipt_s3_key: null,
    receipt_uploaded_at: null,
    store_payment_method: {
      system_payment_method: { type: 'bank_transfer' },
    },
    orders: {
      id: ORDER_ID,
      state: 'pending_payment',
      store_id: STORE_ID,
      customer_id: USER_ID,
    },
    ...overrides,
  });

  const createService = (payment: any) => {
    const prisma = {
      payments: {
        findFirst: jest.fn().mockResolvedValue(payment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      stores: {
        findUnique: jest.fn().mockResolvedValue({
          id: STORE_ID,
          slug: 'nike-test',
          organization_id: 1,
          organizations: { id: 1, slug: 'org-test' },
        }),
      },
    };
    const s3 = {
      getPresignedUrl: jest
        .fn()
        .mockResolvedValue('https://signed.example/receipt.jpg'),
      headObject: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }),
      uploadFile: jest.fn().mockResolvedValue(undefined),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AccountService(prisma as any, s3 as any);
    return { service, prisma, s3 };
  };

  const receiptFile = (overrides: any = {}) =>
    ({
      buffer: Buffer.from('fake-image-bytes'),
      mimetype: 'image/jpeg',
      size: 1024,
      originalname: 'pago banco.jpg',
      ...overrides,
    }) as any;

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: USER_ID, store_id: STORE_ID } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('visor: firma la URL con TTL 5 min y expone el content-type del HEAD', async () => {
    const key = 'org/1/store/5/receipts/2026/10/uuid-pago.jpg';
    const { service, s3 } = createService(basePayment({ receipt_s3_key: key }));

    const res = await service.getPaymentReceiptUrl(PAYMENT_ID);

    expect(s3.getPresignedUrl).toHaveBeenCalledWith(key, 300);
    expect(res.url).toBe('https://signed.example/receipt.jpg');
    expect(res.content_type).toBe('image/jpeg');
    expect(Date.parse(res.expires_at)).toBeGreaterThan(Date.now());
  });

  it('visor: sin comprobante responde PAY_RECEIPT_NOT_FOUND_001', async () => {
    const { service } = createService(basePayment({ receipt_s3_key: null }));

    const err = await service
      .getPaymentReceiptUrl(PAYMENT_ID)
      .then(
        () => null,
        (e) => e,
      );
    expect(err?.errorCode).toBe(ErrorCodes.PAY_RECEIPT_NOT_FOUND_001.code);
  });

  it('binding: pago de otro customer responde 404 ciego (PAY_FIND_001)', async () => {
    const other = basePayment({
      orders: {
        id: ORDER_ID,
        state: 'pending_payment',
        store_id: STORE_ID,
        customer_id: USER_ID + 1,
      },
    });
    const { service } = createService(other);

    const err = await service
      .getPaymentReceiptUrl(PAYMENT_ID)
      .then(
        () => null,
        (e) => e,
      );
    expect(err?.errorCode).toBe(ErrorCodes.PAY_FIND_001.code);
  });

  it('subida: transferencia pendiente persiste key y marca has_receipt', async () => {
    const { service, prisma, s3 } = createService(basePayment());

    const res = await service.uploadPaymentReceipt(
      PAYMENT_ID,
      receiptFile(),
    );

    expect(s3.uploadFile).toHaveBeenCalledTimes(1);
    expect(prisma.payments.updateMany).toHaveBeenCalledWith({
      where: { id: PAYMENT_ID, order_id: ORDER_ID },
      data: {
        receipt_s3_key: expect.stringContaining('/receipts/'),
        receipt_uploaded_at: expect.any(Date),
      },
    });
    expect(res).toMatchObject({
      payment_id: PAYMENT_ID,
      has_receipt: true,
      receipt_content_type: 'image/jpeg',
    });
  });

  it('subida: método distinto de transferencia/voucher responde PAY_VALIDATE_001', async () => {
    const cash = basePayment({
      store_payment_method: { system_payment_method: { type: 'cash' } },
    });
    const { service } = createService(cash);

    const err = await service
      .uploadPaymentReceipt(PAYMENT_ID, receiptFile())
      .then(
        () => null,
        (e) => e,
      );
    expect(err?.errorCode).toBe(ErrorCodes.PAY_VALIDATE_001.code);
  });

  it('subida: orden terminal (cancelada) responde PAY_VALIDATE_001', async () => {
    const terminal = basePayment({
      orders: {
        id: ORDER_ID,
        state: 'cancelled',
        store_id: STORE_ID,
        customer_id: USER_ID,
      },
    });
    const { service } = createService(terminal);

    const err = await service
      .uploadPaymentReceipt(PAYMENT_ID, receiptFile())
      .then(
        () => null,
        (e) => e,
      );
    expect(err?.errorCode).toBe(ErrorCodes.PAY_VALIDATE_001.code);
  });

  it('subida: pago terminal (succeeded) responde PAY_VALIDATE_001', async () => {
    const { service } = createService(basePayment({ state: 'succeeded' }));

    const err = await service
      .uploadPaymentReceipt(PAYMENT_ID, receiptFile())
      .then(
        () => null,
        (e) => e,
      );
    expect(err?.errorCode).toBe(ErrorCodes.PAY_VALIDATE_001.code);
  });

  it('subida: MIME fuera de imagen/PDF responde VALIDATION_FILE_TYPE', async () => {
    const { service } = createService(basePayment());

    const err = await service
      .uploadPaymentReceipt(
        PAYMENT_ID,
        receiptFile({ mimetype: 'text/plain' }),
      )
      .then(
        () => null,
        (e) => e,
      );
    expect(err?.errorCode).toBe(ErrorCodes.VALIDATION_FILE_TYPE.code);
  });

  it('subida: archivo mayor a 5 MB responde 413', async () => {
    const { service } = createService(basePayment());

    await expect(
      service.uploadPaymentReceipt(
        PAYMENT_ID,
        receiptFile({ size: 5 * 1024 * 1024 + 1 }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
