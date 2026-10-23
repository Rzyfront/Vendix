import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTicketDto } from './update-ticket.dto';
import { CloseTicketDto } from './ticket-status.dto';

/**
 * QUI-231 — `customer_satisfied` solo tenía `@IsOptional()`: cualquier valor
 * pasaba la validación y reventaba en Prisma con 500. Se valida igual que el
 * ValidationPipe global (`enableImplicitConversion: true`).
 */
const run = async (Dto: any, payload: Record<string, unknown>) => {
  const instance = plainToInstance(Dto, payload, {
    enableImplicitConversion: true,
  }) as any;
  const errors = await validate(instance);
  return { instance, errors };
};

describe.each([
  ['UpdateTicketDto', UpdateTicketDto],
  ['CloseTicketDto', CloseTicketDto],
])('%s.customer_satisfied', (_name, Dto) => {
  it.each([true, 'true', 1, '1'])('acepta %p como true', async (v) => {
    const { instance, errors } = await run(Dto, { customer_satisfied: v });
    expect(errors).toHaveLength(0);
    expect(instance.customer_satisfied).toBe(true);
  });

  it.each([false, 'false', 0, '0'])('acepta %p como false', async (v) => {
    const { instance, errors } = await run(Dto, { customer_satisfied: v });
    expect(errors).toHaveLength(0);
    expect(instance.customer_satisfied).toBe(false);
  });

  it.each([
    ['ausente', undefined, true],
    ['undefined', undefined, false],
    ['null', null, false],
    ['cadena vacía', '', false],
  ])('trata %s como no enviado', async (_l, v, absent) => {
    const payload = absent ? {} : { customer_satisfied: v };
    const { instance, errors } = await run(Dto, payload);
    expect(errors).toHaveLength(0);
    expect(instance.customer_satisfied).toBeUndefined();
  });

  it.each([['yes'], ['abc'], [2], [{}], [[]]])(
    'rechaza %p con isBoolean',
    async (v) => {
      const { errors } = await run(Dto, { customer_satisfied: v });
      const err = errors.find((e) => e.property === 'customer_satisfied');
      expect(err?.constraints).toHaveProperty('isBoolean');
    },
  );
});
