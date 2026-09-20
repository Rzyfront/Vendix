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
