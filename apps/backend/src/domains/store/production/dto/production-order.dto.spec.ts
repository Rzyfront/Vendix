import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ProductionSuppliesQueryDto, UpdateProductionOrderDto } from './production-order.dto';

/**
 * QUI-1002: the editable estimated time goes through the REAL global pipe
 * options, so an out-of-range value is a 400 instead of a database error.
 */
describe('UpdateProductionOrderDto.estimated_minutes (ValidationPipe real)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (payload: Record<string, unknown>) =>
    pipe.transform(payload, { type: 'body', metatype: UpdateProductionOrderDto });

  it('accepts minutes within the product preparation-time range (0..10080)', async () => {
    await expect(run({ estimated_minutes: 0 })).resolves.toMatchObject({ estimated_minutes: 0 });
    await expect(run({ estimated_minutes: 10080 })).resolves.toMatchObject({
      estimated_minutes: 10080,
    });
  });

  it('accepts null to clear the override', async () => {
    await expect(run({ estimated_minutes: null })).resolves.toMatchObject({
      estimated_minutes: null,
    });
  });

  it('rejects a value above the range with a 400 (the column is a 32-bit INTEGER)', async () => {
    await expect(run({ estimated_minutes: 10081 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ estimated_minutes: 2147483648 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects negative and fractional minutes with a 400', async () => {
    await expect(run({ estimated_minutes: -1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ estimated_minutes: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** S4: the supplies query goes through the real global pipe options. */
describe('ProductionSuppliesQueryDto (ValidationPipe real)', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (payload: Record<string, unknown>) =>
    pipe.transform(payload, { type: 'query', metatype: ProductionSuppliesQueryDto });

  it('accepts a YYYY-MM-DD date and an empty query (today)', async () => {
    await expect(run({ date: '2026-11-10' })).resolves.toMatchObject({ date: '2026-11-10' });
    await expect(run({})).resolves.toEqual({});
  });

  it('rejects a malformed date and any other key (the whole day is aggregated: no page/cursor)', async () => {
    await expect(run({ date: '10/11/2026' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(run({ date: '2026-11-10', limit: 5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
