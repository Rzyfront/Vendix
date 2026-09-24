import { ValidationPipe } from '@nestjs/common';
import { CancelOrderItemDto } from './cancel-order-item.dto';

describe('CancelOrderItemDto — canonical cancellation vocabulary', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: CancelOrderItemDto });

  it.each(['before_fire', 'after_fire_reused', 'after_fire_waste'])(
    'accepts %s within VarChar(20)', async (type) => {
      expect(type.length).toBeLessThanOrEqual(20);
      await expect(validate({ reason: 'motivo válido', cancellation_type: type }))
        .resolves.toMatchObject({ cancellation_type: type });
    },
  );

  it('keeps omitted disposition valid for backend derivation', async () => {
    await expect(validate({ reason: 'motivo válido' })).resolves.toMatchObject({
      reason: 'motivo válido',
    });
  });

  it.each(['inventado', 'delivered_restock', 'delivered_waste'])(
    'rejects non-writable value %s with validation details', async (type) => {
      await expect(validate({ reason: 'motivo válido', cancellation_type: type }))
        .rejects.toMatchObject({ response: expect.objectContaining({
          message: expect.arrayContaining([expect.stringContaining('cancellation_type')]),
        }) });
    },
  );
});
