import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiceSessionDepositDto, SettleServiceSessionDto } from './service-session.dto';
import { RentalQuoteQueryDto } from '../../service-stations/dto/station-rates.dto';
import { DepositDecisionDto } from '../../reservations/dto/deposit-decision.dto';

const errorsOf = async <T extends object>(cls: new () => T, body: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('station money DTOs — payment method and bounds', () => {
  const deposit = { amount: 100000, request_id: 'req-12345678' };

  it('a deposit with a canonical method type is valid', async () => {
    expect(await errorsOf(ServiceSessionDepositDto, { ...deposit, method: 'cash' })).toEqual([]);
    expect(await errorsOf(ServiceSessionDepositDto, { ...deposit, method: 'bank_transfer' })).toEqual([]);
  });

  it('a deposit with a free-text method is rejected (it would be booked to the bank instead of the drawer)', async () => {
    expect(await errorsOf(ServiceSessionDepositDto, { ...deposit, method: 'Efectivo' })).toContain('method');
  });

  it('the settle refund method accepts a canonical type, is optional, and rejects free text', async () => {
    const settle = { request_id: 'req-12345678' };
    expect(await errorsOf(SettleServiceSessionDto, settle)).not.toContain('refund_method');
    expect(await errorsOf(SettleServiceSessionDto, { ...settle, refund_method: 'cash' })).not.toContain('refund_method');
    expect(await errorsOf(SettleServiceSessionDto, { ...settle, refund_method: 'efectivo' })).toContain('refund_method');
  });

  it('the deposit decision refund method rejects free text', async () => {
    const decision = { action: 'refund', request_id: 'req-12345678' };
    expect(await errorsOf(DepositDecisionDto, { ...decision, refund_method: 'cash' })).toEqual([]);
    expect(await errorsOf(DepositDecisionDto, { ...decision, refund_method: 'caja' })).toContain('refund_method');
  });

  it('the admin rental quote rejects a start_at that is not a date (it used to reach new Date() as Invalid Date)', async () => {
    expect(await errorsOf(RentalQuoteQueryDto, { product_id: 1, start_at: '2026-11-08T22:00:00-05:00' })).toEqual([]);
    expect(await errorsOf(RentalQuoteQueryDto, { product_id: 1, start_at: 'mañana' })).toContain('start_at');
  });
});
