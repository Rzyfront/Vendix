import { PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { S3Service } from '@common/services/s3.service';
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
      orders: {
        findFirst: jest.fn().mockImplementation(async () => payment ? { ...payment.orders, payments: [payment] } : null),
        update: jest.fn().mockImplementation(async (args) => ({ payments: [{ ...payment, ...args.data.payments.updateMany.data }] })),
      },
      $queryRaw: jest.fn().mockResolvedValue(payment ? [{ id: payment.orders?.id, state: payment.orders?.state }] : []),
      $transaction: jest.fn(),
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
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
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
    expect(prisma.payments.updateMany).not.toHaveBeenCalled();
    expect(prisma.orders.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ORDER_ID, store_id: STORE_ID, customer_id: USER_ID, state: 'pending_payment' },
      data: { payments: { updateMany: {
        where: { id: PAYMENT_ID, state: 'pending', receipt_s3_key: null },
        data: { receipt_s3_key: expect.stringContaining('/receipts/'), receipt_uploaded_at: expect.any(Date) },
      } } },
    }));
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

// Real ecommerce scope registration/hooks, without Prisma's constructor pool.
jest.mock('../../../prisma/base/base-prisma.service', () => ({
  BasePrismaService: class { protected baseClient = { $extends: () => ({}) }; },
}));

describe('AccountService receipt authorization and post-S3 lifecycle races', () => {
  type Payment = { id: number; order_id: number; customer_id: number | null; state: string; receipt_s3_key: string | null; receipt_uploaded_at: Date | null; store_payment_method: { system_payment_method: { type: string } } };
  type Order = { id: number; store_id: number; customer_id: number; state: string; payments: Payment[] };
  type Args = { where?: { id?: number; store_id?: number; customer_id?: number; state?: string; payments?: { some: { id: number } } }; select?: { payments?: { where: { id: number } } }; data?: { payments: { updateMany: { where: { id: number; state: string; receipt_s3_key: string | null }; data: { receipt_s3_key: string; receipt_uploaded_at: Date } } } } };
  type Hook = (input: { args: Args; query: (args: Args) => Promise<unknown> }) => Promise<unknown>;
  type Extensions = { orders: { findFirst: Hook; update: Hook }; payments: { findFirst: Hook } };
  const file = (overrides: Partial<Express.Multer.File> = {}) => ({ buffer: Buffer.from('receipt'), mimetype: 'image/jpeg', originalname: 'pago banco.jpg', size: 7, ...overrides } as Express.Multer.File);
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => resolve = done); return { promise, resolve }; };
  const clone = (order: Order): Order => ({ ...order, payments: order.payments.map(payment => ({ ...payment, store_payment_method: { system_payment_method: { ...payment.store_payment_method.system_payment_method } } })) });

  function fixture() {
    const order: Order = { id: 95, store_id: 5, customer_id: 28, state: 'pending_payment', payments: [{ id: 63, order_id: 95, customer_id: null, state: 'pending', receipt_s3_key: 'previous-key', receipt_uploaded_at: null, store_payment_method: { system_payment_method: { type: 'bank_transfer' } } }] };
    const control: { noApply?: boolean; dbError?: Error; beforeCallbackError?: Error; commitError?: Error; lockError?: Error } = {};
    const scoped = new EcommercePrismaService() as unknown as { createEcommerceQueryExtensions(): Extensions };
    const extensions = scoped.createEcommerceQueryExtensions();
    const trace: string[] = [];
    const lookup = async (args: Args) => {
      const where = args.where ?? {};
      if (where.store_id !== order.store_id || where.customer_id !== order.customer_id || (where.id !== undefined && where.id !== order.id)) return null;
      const wanted = where.payments?.some.id;
      if (wanted !== undefined && !order.payments.some(payment => payment.id === wanted && payment.order_id === order.id)) return null;
      const result = clone(order);
      const paymentId = args.select?.payments?.where.id;
      if (paymentId !== undefined) result.payments = result.payments.filter(payment => payment.id === paymentId);
      return result;
    };
    const read = jest.fn((args: Args) => extensions.orders.findFirst({ args, query: lookup }));
    const write = jest.fn((args: Args) => extensions.orders.update({ args, query: async scopedArgs => {
      if (control.dbError) throw control.dbError;
      const where = scopedArgs.where!;
      if (where.id !== order.id || where.store_id !== order.store_id || where.customer_id !== order.customer_id || where.state !== order.state) throw new Error('order CAS mismatch');
      const update = scopedArgs.data!.payments.updateMany;
      const payment = order.payments.find(payment => payment.id === update.where.id && payment.order_id === order.id && payment.state === update.where.state && payment.receipt_s3_key === update.where.receipt_s3_key);
      if (payment && !control.noApply) Object.assign(payment, update.data);
      trace.push('write');
      return { payments: order.payments.filter(payment => payment.id === args.select?.payments?.where.id).map(payment => ({ receipt_s3_key: payment.receipt_s3_key })) };
    } }));
    // Actual lock helper runs its two SQL statements. This transport emulates
    // order-first serialization only; it is not a PostgreSQL/DB lock test.
    const raw = jest.fn(async (strings: TemplateStringsArray, id: number, storeId?: number) => {
      if (control.lockError) throw control.lockError;
      const sql = strings.join('?');
      if (sql.includes('FROM orders')) {
        trace.push('lock-order');
        return id === order.id && storeId === order.store_id ? [{ id: order.id, state: order.state }] : [];
      }
      expect(sql).toContain('ORDER BY id FOR UPDATE');
      trace.push('lock-payments'); return order.payments.map(payment => ({ id: payment.id }));
    });
    const tx = { orders: { findFirst: read, update: write }, $queryRaw: raw };
    let queue = Promise.resolve();
    const transaction = jest.fn(async (callback: (client: Prisma.TransactionClient) => Promise<void>) => {
      const previous = queue; const released = deferred(); queue = released.promise;
      await previous;
      const before = clone(order); let completed = false;
      try {
        if (control.beforeCallbackError) throw control.beforeCallbackError;
        await callback(tx as unknown as Prisma.TransactionClient); completed = true;
        if (control.commitError) throw control.commitError;
      } catch (error) {
        if (!completed || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) Object.assign(order, before);
        throw error;
      } finally { released.resolve(); }
    });
    const payments = {
      findFirst: jest.fn((args: Args) => extensions.payments.findFirst({ args, query: async scopedArgs => order.payments.find(payment => payment.id === scopedArgs.where?.id && payment.customer_id === scopedArgs.where?.customer_id) ?? null })),
      updateMany: jest.fn(),
    };
    const s3 = { uploadFile: jest.fn().mockResolvedValue(undefined), deleteFile: jest.fn().mockResolvedValue(undefined), getPresignedUrl: jest.fn().mockResolvedValue('https://signed.example/receipt'), headObject: jest.fn().mockResolvedValue({ contentType: 'image/jpeg' }), signUrl: jest.fn().mockResolvedValue(null) };
    const prisma = { orders: { findFirst: read, update: write }, payments, stores: { findUnique: jest.fn().mockResolvedValue({ id: 5, slug: 'shop', organization_id: 1, organizations: { id: 1, slug: 'org' } }) }, $transaction: transaction, withoutScope: jest.fn() };
    const service = new AccountService(prisma as unknown as EcommercePrismaService, s3 as unknown as S3Service);
    return { service, prisma, s3, order, control, trace, read, write, raw };
  }

  beforeEach(() => jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ user_id: 28, store_id: 5, is_super_admin: false, is_owner: false }));
  afterEach(() => jest.restoreAllMocks());

  it('reads and replaces a valid receipt whose payment.customer_id is null through its authoritative scoped order', async () => {
    const f = fixture();
    expect(await f.prisma.payments.findFirst({ where: { id: 63 } })).toBeNull(); // actual old scope excludes it
    f.prisma.payments.findFirst.mockClear();
    expect((await f.service.getPaymentReceiptUrl(63)).url).toContain('signed.example');
    await f.service.uploadPaymentReceipt(63, file());
    expect(f.order.payments[0].receipt_s3_key).toContain('/receipts/');
    expect(f.prisma.payments.findFirst).not.toHaveBeenCalled(); expect(f.prisma.payments.updateMany).not.toHaveBeenCalled(); expect(f.prisma.withoutScope).not.toHaveBeenCalled();
    expect(f.trace).toEqual(['lock-order', 'lock-payments', 'write']);
    expect(f.write.mock.calls[0][0].data?.payments.updateMany.where.receipt_s3_key).toBe('previous-key');
    expect(f.s3.deleteFile).not.toHaveBeenCalled(); // replaced key remains for offline purge
  });

  it.each([{ user_id: 29, store_id: 5 }, { user_id: 28, store_id: 6 }, { user_id: undefined, store_id: 5 }, { user_id: 28, store_id: undefined }, undefined])('returns blind PAY_FIND for absent/wrong owner-store context %#', async context => {
    const f = fixture(); jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context ? { ...context, is_super_admin: false, is_owner: false } : undefined);
    await expect(f.service.getPaymentReceiptUrl(63)).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_FIND_001.code });
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_FIND_001.code });
    expect(f.s3.uploadFile).not.toHaveBeenCalled();
    if (!context?.user_id || !context?.store_id) expect(f.read).not.toHaveBeenCalled();
  });

  it('does not reveal a missing/unbound payment', async () => {
    const f = fixture();
    await expect(f.service.getPaymentReceiptUrl(999)).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_FIND_001.code });
    f.order.payments[0].order_id = 200;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_FIND_001.code });
  });

  it.each(['cancelled', 'refunded', 'finished', 'delivered'])('rejects terminal order %s before S3', async state => {
    const f = fixture(); f.order.state = state;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_VALIDATE_001.code });
    expect(f.s3.uploadFile).not.toHaveBeenCalled();
  });
  it.each(['succeeded', 'captured', 'refunded', 'cancelled'])('rejects terminal payment %s before S3', async state => {
    const f = fixture(); f.order.payments[0].state = state;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_VALIDATE_001.code });
    expect(f.s3.uploadFile).not.toHaveBeenCalled();
  });
  it.each(['cash', 'card', 'credit_sale', 'payment_gateway'])('rejects unsupported canonical method %s', async type => {
    const f = fixture(); f.order.payments[0].store_payment_method.system_payment_method.type = type;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_VALIDATE_001.code });
    expect(f.s3.uploadFile).not.toHaveBeenCalled();
  });
  it.each(['bank_transfer', 'voucher'])('accepts method %s and exact5MB PDF contract', async type => {
    const f = fixture(); f.order.payments[0].store_payment_method.system_payment_method.type = type;
    const result = await f.service.uploadPaymentReceipt(63, file({ mimetype: 'application/pdf', size: 5 * 1024 * 1024 }));
    expect(result.receipt_content_type).toBe('application/pdf');
  });

  it.each([
    { mutate: (order: Order) => { order.state = 'cancelled'; }, code: ErrorCodes.PAY_VALIDATE_001.code },
    { mutate: (order: Order) => { order.payments[0].state = 'succeeded'; }, code: ErrorCodes.PAY_VALIDATE_001.code },
    { mutate: (order: Order) => { order.payments[0].store_payment_method.system_payment_method.type = 'cash'; }, code: ErrorCodes.PAY_VALIDATE_001.code },
    { mutate: (order: Order) => { order.customer_id = 29; }, code: ErrorCodes.PAY_FIND_001.code },
    { mutate: (order: Order) => { order.store_id = 6; }, code: ErrorCodes.PAY_FIND_001.code },
    { mutate: (order: Order) => { order.payments[0].order_id = 200; }, code: ErrorCodes.PAY_FIND_001.code },
  ])('revalidates changes during S3, compensating only the newly uploaded object %#', async ({ mutate, code }) => {
    const f = fixture(), uploaded = deferred(), proceed = deferred();
    f.s3.uploadFile.mockImplementation(async () => { uploaded.resolve(); await proceed.promise; });
    const pending = f.service.uploadPaymentReceipt(63, file());
    const settled = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    const began = await Promise.race([uploaded.promise.then(() => true), settled.then(() => false)]);
    expect(began).toBe(true); // A red baseline which rejects early must not hang waiting for S3.
    if (!began) return;
    mutate(f.order); proceed.resolve();
    expect((await settled).error).toMatchObject({ errorCode: code });
    expect(f.write).not.toHaveBeenCalled();
    expect(f.s3.deleteFile).toHaveBeenCalledWith(f.s3.uploadFile.mock.calls[0][1]);
    expect(f.order.payments[0].receipt_s3_key).toBe('previous-key');
  });

  it('detects nested CASzero even when orders.update resolves successfully', async () => {
    const f = fixture(); f.control.noApply = true;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_FIND_001.code });
    expect(f.write).toHaveBeenCalledTimes(1); expect(f.s3.deleteFile).toHaveBeenCalledTimes(1);
    expect(f.order.payments[0].receipt_s3_key).toBe('previous-key');
  });

  it('preserves the original validation error when cleanup itself fails', async () => {
    const f = fixture(); f.control.noApply = true; f.s3.deleteFile.mockRejectedValue(new Error('cleanup unavailable'));
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_FIND_001.code });
  });

  it.each(['dbError', 'beforeCallbackError', 'lockError'] as const)('cleans newkey on definitive precommit %s and preserves infrastructure error', async field => {
    const f = fixture(), error = new Error(field); f.control[field] = error;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toBe(error);
    expect(f.s3.deleteFile).toHaveBeenCalledWith(f.s3.uploadFile.mock.calls[0][1]);
    expect(f.order.payments[0].receipt_s3_key).toBe('previous-key');
  });

  it('does NOT delete a potentially committed receipt when commit acknowledgement is ambiguous', async () => {
    const f = fixture(), error = new Error('connection lost after commit'); f.control.commitError = error;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toBe(error);
    expect(f.order.payments[0].receipt_s3_key).toBe(f.s3.uploadFile.mock.calls[0][1]);
    expect(f.s3.deleteFile).not.toHaveBeenCalled();
  });

  it('can compensate a confirmed transaction abort P2034 even after callback completion', async () => {
    const f = fixture(), error = new Prisma.PrismaClientKnownRequestError('write conflict', { code: 'P2034', clientVersion: '7' }); f.control.commitError = error;
    await expect(f.service.uploadPaymentReceipt(63, file())).rejects.toBe(error);
    expect(f.order.payments[0].receipt_s3_key).toBe('previous-key'); expect(f.s3.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent replacements using the fresh previous key under the existing lifecycle lock', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 10 }, () => f.service.uploadPaymentReceipt(63, file())));
    const keys = f.write.mock.calls.map(([args]) => args.data!.payments.updateMany.data.receipt_s3_key);
    expect(new Set(keys).size).toBe(10);
    expect(f.write.mock.calls.map(([args]) => args.data!.payments.updateMany.where.receipt_s3_key)).toEqual(['previous-key', ...keys.slice(0, -1)]);
    expect(f.order.payments[0].receipt_s3_key).toBe(keys[9]);
    expect(f.trace).toEqual(Array.from({ length: 10 }, () => ['lock-order', 'lock-payments', 'write']).flat());
    expect(f.s3.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects empty content, invalid MIME and oversized actual bytes before S3', async () => {
    const f = fixture();
    await expect(f.service.uploadPaymentReceipt(63, file({ buffer: Buffer.alloc(0) }))).rejects.toMatchObject({ errorCode: ErrorCodes.PAY_VALIDATE_001.code });
    await expect(f.service.uploadPaymentReceipt(63, file({ mimetype: 'text/plain' }))).rejects.toMatchObject({ errorCode: ErrorCodes.VALIDATION_FILE_TYPE.code });
    await expect(f.service.uploadPaymentReceipt(63, file({ size: 1, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }))).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(f.s3.uploadFile).not.toHaveBeenCalled();
  });
});

describe('AccountService detail physical ETA and canonical payment payload', () => {
  const item = (type: string | null, prep: number | null = null, variantPrep: number | null = null, cancelled = false) => ({
    id: 1, product_id: 10, product_name: 'Producto', quantity: 1, unit_price: 100, total_price: 100,
    cancelled_at: cancelled ? new Date() : null, products: { product_type: type, preparation_time_minutes: prep, product_images: [] },
    product_variants: variantPrep == null ? null : { preparation_time_minutes: variantPrep }, kitchen_ticket_items: [],
  });
  const detail = async (items: ReturnType<typeof item>[]) => {
    const raw = { id: 95, state: 'pending_payment', order_items: items, order_promotions: [], coupon_uses: [], bookings: [],
      payments: [{ id: 63, state: 'pending', receipt_s3_key: null, store_payment_method: { system_payment_method: { display_name: 'Mi transferencia', type: 'bank_transfer' } } }],
      stores: { id: 5, name: 'Tienda', logo_url: null, store_settings: { settings: { operations: { default_preparation_time_minutes: 15 } } } },
    };
    const service = new AccountService({ orders: { findFirst: jest.fn().mockResolvedValue(raw) } } as unknown as EcommercePrismaService, { signUrl: jest.fn(), headObject: jest.fn() } as unknown as S3Service);
    return service.getOrderDetail(95);
  };
  it('does not manufacture preparation15 for service-only orders', async () => {
    expect((await detail([item('service')])).prep_minutes_max).toBeNull();
  });
  it('keeps physical default preparation for legacy physical lines', async () => {
    expect((await detail([item('physical')])).prep_minutes_max).toBe(15);
  });
  it('excludes service duration from a mixed physical/prepared ETA', async () => {
    expect((await detail([item('service', 999), item('physical', 20), item('prepared', 30, 25)])).prep_minutes_max).toBe(25);
  });
  it('ignores cancelled physical lines and treats unknown historical product types compatibly', async () => {
    expect((await detail([item('service'), item('prepared', 40, null, true)])).prep_minutes_max).toBeNull();
    expect((await detail([item(null)])).prep_minutes_max).toBe(15);
  });
  it('publishes canonical method_type separately from localized display name', async () => {
    const result = await detail([item('physical')]);
    expect(result.payments[0].method).toBe('Mi transferencia');
    expect(result.payments[0].method_type).toBe('bank_transfer');
    expect(result.items[0].product_type).toBe('physical');
    expect(result.items[0].unit_price_gross).toBe(100);
  });
});
