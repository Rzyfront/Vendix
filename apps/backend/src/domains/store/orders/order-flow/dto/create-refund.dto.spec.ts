import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AllExceptionsFilter } from 'src/common/filters/http-exception.filter';
import { flattenValidationMessages } from 'src/common/validators/bulk-validation.util';
import { CreateRefundDto } from './create-refund.dto';

@Controller('refund-contract')
class RefundContractController {
  constructor(
    @Inject('refundHandler')
    private readonly handler: (dto: CreateRefundDto) => unknown,
  ) {}

  @Post(['preview', 'create'])
  accept(@Body() dto: CreateRefundDto) {
    return this.handler(dto);
  }
}

describe('CreateRefundDto — real HTTP ValidationPipe boundary', () => {
  let app: INestApplication;
  const handler = jest.fn();
  const item = (id: number | string, quantity = 1) => ({
    order_item_id: id,
    quantity,
    inventory_action: 'no_return',
  });
  const payload = (items: ReturnType<typeof item>[]) => ({
    items,
    include_shipping: false,
    refund_method: 'cash',
    reason: 'Customer return',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RefundContractController],
      providers: [{ provide: 'refundHandler', useValue: handler }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) =>
          new BadRequestException({
            statusCode: 400,
            message: flattenValidationMessages(errors),
            error: 'Bad Request',
          }),
      }),
    );
    await app.init();
  });

  beforeEach(() => handler.mockReset().mockReturnValue({ accepted: true }));
  afterAll(async () => {
    await app?.close();
  });

  describe.each(['preview', 'create'])('%s', (endpoint) => {
    it('accepts distinct order_item_ids', async () => {
      await request(app.getHttpServer())
        .post(`/refund-contract/${endpoint}`)
        .send(payload([item(1), item(2)]))
        .expect(201);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeInstanceOf(CreateRefundDto);
    });

    it.each([
      ['separate objects with equal IDs', [item(1), item(1)]],
      [
        'string and number IDs normalized by the real pipe',
        [item(1), item('1')],
      ],
      ['non-adjacent duplicates', [item(1), item(2), item(1)]],
      [
        'conflicting destinations',
        [
          { ...item(1), inventory_action: 'restock', location_id: 7 },
          { ...item(1), inventory_action: 'write_off', location_id: 9 },
        ],
      ],
    ])('rejects %s before the handler', async (_label, items) => {
      const response = await request(app.getHttpServer())
        .post(`/refund-contract/${endpoint}`)
        .send(payload(items))
        .expect(400);
      expect(response.body.error_code).toBe('SYS_VALIDATION_001');
      expect(handler).not.toHaveBeenCalled();
    });

    it.each([0, -1, 1.5])('keeps quantity=%s invalid', async (quantity) => {
      const response = await request(app.getHttpServer())
        .post(`/refund-contract/${endpoint}`)
        .send(payload([item(1, quantity)]))
        .expect(400);
      expect(response.body.error_code).toBe('SYS_VALIDATION_001');
      expect(handler).not.toHaveBeenCalled();
    });

    it('preserves acceptance of an empty items array', async () => {
      await request(app.getHttpServer())
        .post(`/refund-contract/${endpoint}`)
        .send(payload([]))
        .expect(201);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed nested item without turning validation into a 500', async () => {
      const response = await request(app.getHttpServer())
        .post(`/refund-contract/${endpoint}`)
        .send({ ...payload([]), items: [null, {}] })
        .expect(400);
      expect(response.body.error_code).toBe('SYS_VALIDATION_001');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
