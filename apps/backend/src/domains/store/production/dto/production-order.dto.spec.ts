import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateProductionOrderDto } from './production-order.dto';

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
