import 'reflect-metadata';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { order_state_enum } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
import { AllExceptionsFilter } from '@common/filters/http-exception.filter';
import { ResponseService } from '@common/responses/response.service';
import {
  flattenBulkValidationErrors,
  flattenValidationMessages,
  isBulkValidationError,
} from '@common/validators/bulk-validation.util';
import { BulkTransitionOrdersDto } from './dto/bulk-orders.dto';
import { OrdersBulkController } from './orders-bulk.controller';
import { OrdersBulkService } from './orders-bulk.service';

const EXPECTED_TARGETS: readonly string[] = [
  'finished',
  'shipped',
  'delivered',
  'cancelled',
];
const FORBIDDEN_TARGETS = Object.values(order_state_enum).filter(
  (state) => !EXPECTED_TARGETS.includes(state),
);
const ENDPOINTS = [
  { suffix: 'transition', serviceMethod: 'bulkTransition' },
  { suffix: 'transition/preview', serviceMethod: 'previewTransition' },
] as const;

/**
 * Real Nest HTTP routing, controller, PermissionsGuard, ResponseService,
 * ValidationPipe and exception filter. Only the bulk service/data boundary
 * and authenticated identity are fixtures. This does NOT exercise JWT login,
 * subscription gating or actual order transitions: those require local curl.
 */
describe('OrdersBulkController — HTTP destination validation', () => {
  let app: INestApplication;
  const bulkService = {
    bulkTransition: jest.fn(),
    previewTransition: jest.fn(),
    previewCashSessionFinish: jest.fn(),
    processCashSessionOrder: jest.fn(),
    finishCashSessionOrders: jest.fn(),
  };
  const transitionResult = {
    total: 1,
    successful: 1,
    failed: 0,
    results: [{ id: 41, status: 'ok', message: 'Orden actualizada' }],
  };
  const previewResult = {
    total: 1,
    ok: 1,
    warnings: 0,
    skipped: 0,
    errors: 0,
    items: [
      {
        id: 41,
        order_number: 'POS-41',
        current_state: 'processing',
        status: 'ok',
      },
    ],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersBulkController],
      providers: [
        ResponseService,
        { provide: OrdersBulkService, useValue: bulkService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use((req: Request, _res: Response, next: NextFunction) => {
      // Test-only identities, not a replacement for the production JWT guard.
      const fixture = req.header('x-test-permission');
      if (fixture) {
        const cashProcessFixtures: Record<
          string,
          { roles: string[]; permissions: string[]; inactive?: string }
        > = {
          'cash-carrier': {
            roles: ['carrier'],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:read',
              'store:orders:read:one',
              'store:dispatch_notes:create',
            ],
          },
          'cash-missing-close': {
            roles: [],
            permissions: [
              'store:orders:update',
              'store:orders:order_flow:create',
            ],
          },
          'cash-missing-update': {
            roles: [],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:order_flow:create',
            ],
          },
          'cash-missing-flow': {
            roles: [],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:update',
            ],
          },
          'cash-inactive-close': {
            roles: [],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:update',
              'store:orders:order_flow:create',
            ],
            inactive: 'store:cash_registers:close_session',
          },
          'cash-inactive-update': {
            roles: [],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:update',
              'store:orders:order_flow:create',
            ],
            inactive: 'store:orders:update',
          },
          'cash-inactive-flow': {
            roles: [],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:update',
              'store:orders:order_flow:create',
            ],
            inactive: 'store:orders:order_flow:create',
          },
          'cash-all': {
            roles: [],
            permissions: [
              'store:cash_registers:close_session',
              'store:orders:update',
              'store:orders:order_flow:create',
            ],
          },
          'cash-super-admin': { roles: ['super_admin'], permissions: [] },
          'cash-route-only': {
            roles: [],
            permissions: ['store:orders:create'],
          },
        };
        const cashProcessFixture = cashProcessFixtures[fixture];
        if (cashProcessFixture) {
          Object.assign(req, {
            user: {
              id: 7,
              roles: cashProcessFixture.roles,
              permissions: cashProcessFixture.permissions.map((name) => ({
                name,
                path:
                  fixture === 'cash-route-only'
                    ? '/api/store/orders/bulk/cash-session-process'
                    : '/api/seeded/permission',
                method: 'POST',
                status:
                  name === cashProcessFixture.inactive ? 'inactive' : 'active',
              })),
            },
          });
          next();
          return;
        }
        const pathOnly = fixture === 'route-only';
        Object.assign(req, {
          user: {
            id: 7,
            roles: [],
            permissions: [
              {
                name:
                  fixture === 'bulk' || fixture === 'inactive'
                    ? 'store:orders:bulk_update'
                    : fixture === 'cash-close'
                      ? 'store:cash_registers:close_session'
                      : 'store:orders:create',
                path: pathOnly ? req.path : '/api/store/orders',
                method: 'POST',
                status: fixture === 'inactive' ? 'inactive' : 'active',
              },
            ],
          },
        });
      }
      next();
    });

    // Mirror main.ts without importing it (which would boot the full app).
    // Keep the real exceptionFactory, including its non-customer bulk branch.
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) => {
          if (isBulkValidationError(errors)) {
            const flat = flattenBulkValidationErrors(errors);
            return new BadRequestException({
              statusCode: 400,
              message: `Se encontraron ${flat.length} error(es) de validación en la carga masiva`,
              error_code: 'CUST_BULK_VALIDATION',
              validationErrors: flat,
            });
          }
          return new BadRequestException({
            statusCode: 400,
            message: flattenValidationMessages(errors),
            error: 'Bad Request',
          });
        },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    bulkService.bulkTransition.mockResolvedValue(transitionResult);
    bulkService.previewTransition.mockResolvedValue(previewResult);
    bulkService.previewCashSessionFinish.mockResolvedValue({
      session_id: 8,
      total: 1,
      eligible: 1,
      ineligible: 0,
      fingerprint: 'a'.repeat(64),
      items: [],
    });
    bulkService.processCashSessionOrder.mockResolvedValue({ processed: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  const expectNoServiceCalls = () => {
    expect(bulkService.bulkTransition).not.toHaveBeenCalled();
    expect(bulkService.previewTransition).not.toHaveBeenCalled();
  };

  describe.each(ENDPOINTS)(
    'POST /api/store/orders/bulk/$suffix',
    ({ suffix, serviceMethod }) => {
      const path = `/api/store/orders/bulk/${suffix}`;

      it.each(EXPECTED_TARGETS)(
        'accepts %s and preserves the success envelope',
        async (targetState) => {
          const body = {
            ids: [41],
            targetState,
            reason: 'Corrección autorizada',
          };
          const response = await request(app.getHttpServer())
            .post(path)
            .set('x-test-permission', 'bulk')
            .send(body);

          expect(response.status).toBe(200);
          expect(response.body).toMatchObject({
            success: true,
            data:
              serviceMethod === 'bulkTransition'
                ? transitionResult
                : previewResult,
          });
          expect(bulkService[serviceMethod]).toHaveBeenCalledTimes(1);
          expect(bulkService[serviceMethod]).toHaveBeenCalledWith(
            expect.objectContaining(body),
          );
          expect(bulkService[serviceMethod].mock.calls[0][0]).toBeInstanceOf(
            BulkTransitionOrdersDto,
          );
          const otherMethod =
            serviceMethod === 'bulkTransition'
              ? 'previewTransition'
              : 'bulkTransition';
          expect(bulkService[otherMethod]).not.toHaveBeenCalled();
        },
      );

      it.each(FORBIDDEN_TARGETS)(
        'rejects Prisma destination %s before the service',
        async (targetState) => {
          const response = await request(app.getHttpServer())
            .post(path)
            .set('x-test-permission', 'bulk')
            .send({ ids: [41], targetState });

          expect(response.status).toBe(400);
          expect(response.body).toMatchObject({
            statusCode: 400,
            error_code: 'SYS_VALIDATION_001',
            details: {
              validationErrors: expect.arrayContaining([
                'targetState debe ser uno de: finished, shipped, delivered, cancelled',
              ]),
            },
          });
          expect(response.body).not.toHaveProperty('success');
          expectNoServiceCalls();
        },
      );

      it.each([
        ['unknown', 'archived'],
        ['missing', undefined],
        ['null', null],
        ['empty', ''],
        ['whitespace', ' finished '],
        ['wrong case', 'FINISHED'],
        ['array', ['finished']],
        ['object', { value: 'finished' }],
      ])(
        'rejects a %s destination with a real HTTP 400',
        async (_label, targetState) => {
          const response = await request(app.getHttpServer())
            .post(path)
            .set('x-test-permission', 'bulk')
            .send({ ids: [41], targetState });

          expect(response.status).toBe(400);
          expect(response.body).toMatchObject({
            statusCode: 400,
            error_code: 'SYS_VALIDATION_001',
            details: {
              validationErrors: expect.arrayContaining([
                expect.stringContaining('targetState'),
              ]),
            },
          });
          expectNoServiceCalls();
        },
      );

      it('keeps the 300-id limit instead of regressing it to 100', async () => {
        const ids = Array.from({ length: 300 }, (_, index) => index + 1);
        const response = await request(app.getHttpServer())
          .post(path)
          .set('x-test-permission', 'bulk')
          .send({ ids, targetState: 'finished' });

        expect(response.status).toBe(200);
        expect(bulkService[serviceMethod]).toHaveBeenCalledWith(
          expect.objectContaining({ ids, targetState: 'finished' }),
        );
      });

      it('rejects 301 ids before the service', async () => {
        const ids = Array.from({ length: 301 }, (_, index) => index + 1);
        const response = await request(app.getHttpServer())
          .post(path)
          .set('x-test-permission', 'bulk')
          .send({ ids, targetState: 'finished' });

        expect(response.status).toBe(400);
        expect(response.body.error_code).toBe('SYS_VALIDATION_001');
        expectNoServiceCalls();
      });

      it('rejects attempts to add an unrelated state or tenant', async () => {
        const response = await request(app.getHttpServer())
          .post(path)
          .set('x-test-permission', 'bulk')
          .send({
            ids: [41],
            targetState: 'finished',
            state: 'refunded',
            store_id: 2,
          });

        expect(response.status).toBe(400);
        expect(response.body.error_code).toBe('SYS_VALIDATION_001');
        expectNoServiceCalls();
      });

      it.each(['create-only', 'inactive', 'route-only'])(
        'still denies the %s permission fixture',
        async (permission) => {
          const response = await request(app.getHttpServer())
            .post(path)
            .set('x-test-permission', permission)
            .send({ ids: [41], targetState: 'finished' });

          expect(response.status).toBe(403);
          expect(response.body.error_code).toBe('AUTH_PERM_001');
          expectNoServiceCalls();
        },
      );

      it('denies requests without an authenticated identity', async () => {
        const response = await request(app.getHttpServer())
          .post(path)
          .send({ ids: [41], targetState: 'finished' });

        expect(response.status).toBe(403);
        expect(response.body.error_code).toBe('AUTH_PERM_001');
        expectNoServiceCalls();
      });
    },
  );

  it('requires the explicit close-session permission name on cash preview', async () => {
    const body = {
      session_id: 8,
      orders: [{ id: 41, version: '2026-10-07T10:00:00.000Z', fingerprint: 'a'.repeat(64) }],
    };
    const allowed = await request(app.getHttpServer())
      .post('/api/store/orders/bulk/cash-session-preview')
      .set('x-test-permission', 'cash-close')
      .send(body);

    expect(allowed.status).toBe(200);
    expect(bulkService.previewCashSessionFinish).toHaveBeenCalledWith(
      expect.objectContaining(body),
    );

    bulkService.previewCashSessionFinish.mockClear();
    const createOnly = await request(app.getHttpServer())
      .post('/api/store/orders/bulk/cash-session-preview')
      .set('x-test-permission', 'create')
      .send(body);
    expect(createOnly.status).toBe(403);
    expect(bulkService.previewCashSessionFinish).not.toHaveBeenCalled();
  });

  it('requires all named permissions before processing a cash-session order', async () => {
    const body = {
      session_id: 8,
      order_id: 41,
      expected_version: '2026-10-07T10:00:00.000Z',
      flow: {},
    };
    const path = '/api/store/orders/bulk/cash-session-process';

    const carrier = await request(app.getHttpServer())
      .post(path)
      .set('x-test-permission', 'cash-carrier')
      .send(body);
    expect(carrier.status).toBe(403);
    expect(carrier.body.error_code).toBe('AUTH_PERM_001');
    expect(bulkService.processCashSessionOrder).not.toHaveBeenCalled();

    for (const fixture of [
      'cash-missing-close',
      'cash-missing-update',
      'cash-missing-flow',
      'cash-inactive-close',
      'cash-inactive-update',
      'cash-inactive-flow',
      'cash-route-only',
    ]) {
      const response = await request(app.getHttpServer())
        .post(path)
        .set('x-test-permission', fixture)
        .send(body);

      expect(response.status).toBe(403);
      expect(response.body.error_code).toBe('AUTH_PERM_001');
      expect(bulkService.processCashSessionOrder).not.toHaveBeenCalled();
    }

    const permitted = await request(app.getHttpServer())
      .post(path)
      .set('x-test-permission', 'cash-all')
      .send(body);
    expect(permitted.status).toBe(200);
    expect(bulkService.processCashSessionOrder).toHaveBeenCalledTimes(1);
    expect(bulkService.processCashSessionOrder).toHaveBeenCalledWith(
      expect.objectContaining(body),
    );

    bulkService.processCashSessionOrder.mockClear();
    const superAdmin = await request(app.getHttpServer())
      .post(path)
      .set('x-test-permission', 'cash-super-admin')
      .send(body);
    expect(superAdmin.status).toBe(200);
    expect(bulkService.processCashSessionOrder).toHaveBeenCalledTimes(1);
  });

  it('finalizes cash-session orders only with close-session permission and the dedicated seam', async () => {
    const result = { finished: 1, order_ids: [41], idempotent: false };
    bulkService.finishCashSessionOrders.mockResolvedValueOnce(result);
    const body = {
      session_id: 8,
      orders: [{ id: 41, version: '2026-10-07T10:00:00.000Z', fingerprint: 'a'.repeat(64) }],
      fingerprint: 'b'.repeat(64),
      reason: 'Cierre de caja',
    };
    const allowed = await request(app.getHttpServer())
      .post('/api/store/orders/bulk/cash-session-finish')
      .set('x-test-permission', 'cash-close')
      .send(body);

    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ success: true, data: result });
    expect(bulkService.finishCashSessionOrders).toHaveBeenCalledWith(
      expect.objectContaining(body),
    );

    bulkService.finishCashSessionOrders.mockClear();
    const createOnly = await request(app.getHttpServer())
      .post('/api/store/orders/bulk/cash-session-finish')
      .set('x-test-permission', 'create')
      .send(body);
    expect(createOnly.status).toBe(403);
    expect(createOnly.body.error_code).toBe('AUTH_PERM_001');
    expect(bulkService.finishCashSessionOrders).not.toHaveBeenCalled();
  });

  it('preserves HTTP 200 for partial failures after a valid transition request', async () => {
    const partial = {
      total: 2,
      successful: 1,
      failed: 1,
      results: [
        { id: 41, status: 'ok' },
        { id: 42, status: 'error', code: 'ORD_BULK_TRANSITION_FAIL' },
      ],
    };
    bulkService.bulkTransition.mockResolvedValueOnce(partial);

    const response = await request(app.getHttpServer())
      .post('/api/store/orders/bulk/transition')
      .set('x-test-permission', 'bulk')
      .send({ ids: [41, 42], targetState: 'finished' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: partial });
    expect(bulkService.bulkTransition).toHaveBeenCalledTimes(1);
  });
});
