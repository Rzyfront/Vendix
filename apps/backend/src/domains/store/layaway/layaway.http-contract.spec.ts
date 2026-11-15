import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// `import * as request`: esModuleInterop is off in apps/backend/tsconfig.json.
import * as request from 'supertest';

import { LayawayController } from './layaway.controller';
import { LayawayService } from './layaway.service';
import { ResponseService } from '@common/responses/response.service';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * QUI-893 — layaway transport contract, measured on the real HTTP stack.
 *
 * Every handler used to catch the service exception and RETURN
 * `responseService.error(...)`, so Nest answered 200/201 with
 * `success:false` and no `error_code`. The UI only reads the status line, so a
 * cancellation blocked by CASH_SESSION_REQUIRED_001 showed the green
 * "Plan cancelado" toast while the plan stayed untouched.
 *
 * Here the exception must leave the handler: the global `AllExceptionsFilter`
 * (same pipe + filter as `main.ts`) emits the real status and `error_code`.
 * Only `LayawayService` and the permissions guard are mocked.
 */
describe('layaway — HTTP contract (real global pipe + filter)', () => {
  let app: INestApplication;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    getStats: jest.fn(),
    findOne: jest.fn(),
    makePayment: jest.fn(),
    modifyInstallments: jest.fn(),
    cancel: jest.fn(),
    complete: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LayawayController],
      providers: [
        ResponseService,
        { provide: LayawayService, useValue: service },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => jest.resetAllMocks());

  const BASE = '/api/store/layaway';
  const http = () => request(app.getHttpServer());

  describe(`POST ${BASE}/:id/cancel`, () => {
    const body = { cancellation_reason: 'Cliente desiste', refund_method: 'cash' };

    it.each([
      ['CASH_SESSION_REQUIRED_001', ErrorCodes.CASH_SESSION_REQUIRED_001, 409],
      [
        'LAY_REFUND_METHOD_REQUIRED_001',
        ErrorCodes.LAY_REFUND_METHOD_REQUIRED_001,
        400,
      ],
      ['LAY_STATE_001', ErrorCodes.LAY_STATE_001, 409],
    ])(
      '%s → real status + error_code, never a 201 envelope',
      async (code, entry, status) => {
        service.cancel.mockRejectedValue(new VendixHttpException(entry));

        const res = await http().post(`${BASE}/5/cancel`).send(body);

        expect(res.status).toBe(status);
        expect(res.body.error_code).toBe(code);
        expect(res.body.success).not.toBe(true);
        expect(res.body.message).toBeTruthy();
      },
    );

    it('success → 201 with the cancelled plan', async () => {
      service.cancel.mockResolvedValue({ id: 5, state: 'cancelled' });

      const res = await http().post(`${BASE}/5/cancel`).send(body);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ id: 5, state: 'cancelled' });
      expect(service.cancel).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ refund_method: 'cash' }),
      );
    });
  });

  it(`POST ${BASE}/:id/payment — CASH_SESSION_REQUIRED_001 → 409`, async () => {
    service.makePayment.mockRejectedValue(
      new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
    );

    const res = await http().post(`${BASE}/5/payment`).send({ amount: 1000 });

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('CASH_SESSION_REQUIRED_001');
  });

  it(`POST ${BASE}/:id/payment — LAY_PAYMENT_001 → 400`, async () => {
    service.makePayment.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_PAYMENT_001),
    );

    const res = await http().post(`${BASE}/5/payment`).send({ amount: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('LAY_PAYMENT_001');
  });

  it(`POST ${BASE}/:id/complete — LAY_STATE_001 → 409`, async () => {
    service.complete.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_STATE_001),
    );

    const res = await http().post(`${BASE}/5/complete`).send({});

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('LAY_STATE_001');
  });

  it(`PATCH ${BASE}/:id/installments — LAY_STATE_001 → 409`, async () => {
    service.modifyInstallments.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_STATE_001),
    );

    const res = await http()
      .patch(`${BASE}/5/installments`)
      .send({ installments: [{ amount: 1000, due_date: '2026-12-01' }] });

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('LAY_STATE_001');
  });

  it(`POST ${BASE} — create error → real status + error_code`, async () => {
    service.create.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_PAYMENT_001),
    );

    const res = await http()
      .post(BASE)
      .send({
        customer_id: 3,
        items: [
          { product_id: 1, product_name: 'Casco', quantity: 1, unit_price: 1000 },
        ],
        installments: [{ amount: 1000, due_date: '2026-12-01' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('LAY_PAYMENT_001');
  });

  it(`GET ${BASE}/:id — LAY_FIND_001 → 404`, async () => {
    service.findOne.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_FIND_001),
    );

    const res = await http().get(`${BASE}/999`);

    expect(res.status).toBe(404);
    expect(res.body.error_code).toBe('LAY_FIND_001');
  });

  it(`GET ${BASE} and ${BASE}/stats — errors keep their status`, async () => {
    service.findAll.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_STATE_001),
    );
    service.getStats.mockRejectedValue(
      new VendixHttpException(ErrorCodes.LAY_STATE_001),
    );

    const list = await http().get(BASE);
    const stats = await http().get(`${BASE}/stats`);

    expect(list.status).toBe(409);
    expect(list.body.error_code).toBe('LAY_STATE_001');
    expect(stats.status).toBe(409);
    expect(stats.body.error_code).toBe('LAY_STATE_001');
  });
});
