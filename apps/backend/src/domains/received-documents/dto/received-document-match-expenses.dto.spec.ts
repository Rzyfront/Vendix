import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReceivedDocumentMatchExpensesQueryDto } from './received-document-match-expenses.dto';

describe('ReceivedDocumentMatchExpensesQueryDto', () => {
  it('normalizes text and strictly coerces bounded page, limit, and store IDs', async () => {
    const dto = plainToInstance(ReceivedDocumentMatchExpensesQueryDto, {
      search: '  compra   de café ', page: '2', limit: '15', store_id: '31',
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto).toMatchObject({ search: 'compra de café', page: 2, limit: 15, store_id: 31 });
  });

  it.each([true, false, '1e2', [2]])('does not coerce ambiguous page/limit/store values %p', async (value) => {
    for (const field of ['page', 'limit', 'store_id'] as const) {
      const dto = plainToInstance(ReceivedDocumentMatchExpensesQueryDto, { [field]: value });
      expect(await validate(dto)).not.toEqual([]);
    }
  });

  it.each([0, 21])('rejects out-of-range limit %s', async (limit) => {
    const dto = plainToInstance(ReceivedDocumentMatchExpensesQueryDto, { limit });
    expect(await validate(dto)).not.toEqual([]);
  });

  it.each([0, 1001])('rejects out-of-range page %s', async (page) => {
    const dto = plainToInstance(ReceivedDocumentMatchExpensesQueryDto, { page });
    expect(await validate(dto)).not.toEqual([]);
  });

  it('rejects blank or overlong search strings', async () => {
    for (const search of ['   ', 'x'.repeat(101)]) {
      const dto = plainToInstance(ReceivedDocumentMatchExpensesQueryDto, { search });
      expect(await validate(dto)).not.toEqual([]);
    }
  });
});
