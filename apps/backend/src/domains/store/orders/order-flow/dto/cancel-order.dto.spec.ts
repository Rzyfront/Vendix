import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelOrderDto } from './cancel-order.dto';

const check = async (plain: Record<string, unknown>) =>
  validate(plainToInstance(CancelOrderDto, { reason: 'cliente se fue', ...plain }), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CancelOrderDto — productionDispositions (S6)', () => {
  it('accepts one choice per production order', async () => {
    const errors = await check({
      productionDispositions: [
        { production_order_id: 100, disposition: 'release' },
        { production_order_id: 101, disposition: 'waste' },
      ],
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown disposition or a missing production order id', async () => {
    expect(await check({ productionDispositions: [{ production_order_id: 1, disposition: 'discard' }] })).not.toHaveLength(0);
    expect(await check({ productionDispositions: [{ disposition: 'release' }] })).not.toHaveLength(0);
  });

  it('keeps accepting the single productionDisposition and an empty body of choices', async () => {
    expect(await check({ productionDisposition: 'waste' })).toHaveLength(0);
    expect(await check({})).toHaveLength(0);
    expect(await check({ productionDisposition: 'nope' })).not.toHaveLength(0);
  });
});
