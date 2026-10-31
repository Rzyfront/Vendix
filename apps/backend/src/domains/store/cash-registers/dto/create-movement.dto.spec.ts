import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMovementDto } from './create-movement.dto';

const errorsFor = async (plain: Record<string, unknown>) =>
  (await validate(plainToInstance(CreateMovementDto, plain))).map(
    (e) => e.property,
  );

describe('CreateMovementDto (B13)', () => {
  it('accepts a positive amount with up to 2 decimals', async () => {
    expect(await errorsFor({ type: 'cash_in', amount: 1250.5 })).toEqual([]);
  });

  it.each([0, -1, 1.234, 1_000_000_001])('rejects amount %p', async (amount) => {
    expect(await errorsFor({ type: 'cash_in', amount })).toContain('amount');
  });

  it('requires notes for cash_out', async () => {
    expect(await errorsFor({ type: 'cash_out', amount: 10 })).toContain('notes');
    expect(await errorsFor({ type: 'cash_out', amount: 10, notes: '  ' })).toContain('notes');
    expect(await errorsFor({ type: 'cash_out', amount: 10, notes: 'pago proveedor' })).toEqual([]);
  });

  it('does not require notes for cash_in', async () => {
    expect(await errorsFor({ type: 'cash_in', amount: 10 })).toEqual([]);
  });
});
