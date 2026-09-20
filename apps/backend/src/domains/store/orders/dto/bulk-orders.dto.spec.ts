import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { order_state_enum } from '@prisma/client';
import {
  BulkTransitionOrdersDto,
  MAX_BULK_ORDERS_IDS,
} from './bulk-orders.dto';

// Independent contract oracle: do not derive expected states from the DTO's
// allowlist, or widening production would also widen the test expectation.
const EXPECTED_TARGETS: readonly string[] = [
  'finished',
  'shipped',
  'delivered',
  'cancelled',
];

describe('BulkTransitionOrdersDto — runtime transition contract', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const parse = (
    body: Record<string, unknown>,
  ): Promise<BulkTransitionOrdersDto> =>
    pipe.transform(body, { type: 'body', metatype: BulkTransitionOrdersDto });

  it.each(Object.values(order_state_enum))(
    'validates Prisma destination %s against the four published bulk targets',
    async (targetState) => {
      const operation = parse({ ids: [41], targetState });

      if (EXPECTED_TARGETS.includes(targetState)) {
        await expect(operation).resolves.toMatchObject({
          ids: [41],
          targetState,
        });
      } else {
        await expect(operation).rejects.toMatchObject({
          response: {
            statusCode: 400,
            message: expect.arrayContaining([
              'targetState debe ser uno de: finished, shipped, delivered, cancelled',
            ]),
          },
        });
      }
    },
  );

  it.each([
    ['unknown', 'archived'],
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', ' processing '],
    ['wrong case', 'FINISHED'],
    ['number', 1],
    ['array', ['finished']],
    ['object', { value: 'finished' }],
  ])('rejects a %s destination', async (_label, targetState) => {
    await expect(parse({ ids: [41], targetState })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('preserves the 300-id cap and existing numeric id transformation', async () => {
    expect(MAX_BULK_ORDERS_IDS).toBe(300);
    const ids = Array.from({ length: 300 }, (_, index) => String(index + 1));
    const parsed = await parse({ ids, targetState: 'finished' });

    expect(parsed).toBeInstanceOf(BulkTransitionOrdersDto);
    expect(parsed.ids).toEqual(
      Array.from({ length: 300 }, (_, index) => index + 1),
    );
  });

  it.each([
    ['empty', []],
    ['oversized', Array.from({ length: 301 }, (_, index) => index + 1)],
  ])('rejects an %s id batch', async (_label, ids) => {
    await expect(
      parse({ ids, targetState: 'finished' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the optional reason unchanged at its 500-character boundary', async () => {
    const reason = 'x'.repeat(500);
    await expect(
      parse({ ids: [41], targetState: 'delivered', reason }),
    ).resolves.toMatchObject({ reason });
  });

  it('rejects a reason longer than 500 characters', async () => {
    await expect(
      parse({ ids: [41], targetState: 'delivered', reason: 'x'.repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still rejects additional state or tenant fields', async () => {
    await expect(
      parse({
        ids: [41],
        targetState: 'finished',
        state: 'refunded',
        store_id: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
